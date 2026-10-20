import { useMemo, useState } from 'react';
import { num, signedUsd } from '../format';

/**
 * Calendario de dias operados, con el resultado de cada uno pintado al fondo.
 *
 * Sustituye a la fila de botones: con tres dias aquella funcionaba, con sesenta
 * era un muro de fichas en una columna de 300 px. El calendario ocupa lo mismo
 * tenga tres dias o seis meses.
 *
 * El color codifica POLARIDAD, no magnitud suelta: dos brazos (perdida / ganancia)
 * desde un punto neutro gris. Los dos tonos estan validados contra el fondo real
 * del panel y se distinguen tambien en deuteranopia. Aun asi, cada celda lleva su
 * cifra escrita: el color nunca es el unico portador del dato.
 */

export interface DayStat {
  date: string; // YYYY-MM-DD, fecha de MERCADO
  count: number;
  pnl: number;
}

/** Brazo positivo y negativo del ramp divergente. */
const WIN = '22, 164, 124'; // #16a47c
const LOSS = '209, 72, 58'; // #d1483a

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/**
 * Las fechas vienen como texto YYYY-MM-DD y son fechas de MERCADO, no instantes.
 * Se trocean a mano en vez de pasarlas por `new Date(texto)`, que las interpreta
 * como medianoche UTC y en un navegador al oeste las corre un dia hacia atras.
 */
function parts(date: string) {
  return {
    y: Number(date.slice(0, 4)),
    m: Number(date.slice(5, 7)),
    d: Number(date.slice(8, 10)),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Dia de la semana con lunes = 0. Date.UTC evita la zona horaria local. */
function weekdayMondayFirst(y: number, m: number, d: number) {
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i]!;
}

export function DayCalendar({
  days,
  selected,
  onToggle,
  onClear,
}: {
  days: DayStat[];
  selected: string[];
  onToggle: (date: string) => void;
  onClear: () => void;
}) {
  const index = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  // La escala se ancla en el percentil 85 y no en el maximo: un solo dia
  // extraordinario aplastaria el color de todos los demas hasta dejarlos
  // indistinguibles, que es justo lo contrario de lo que se viene a ver.
  const scale = useMemo(() => {
    const abs = days.map((d) => Math.abs(d.pnl)).sort((a, b) => a - b);
    return Math.max(1, percentile(abs, 85));
  }, [days]);

  const months = useMemo(() => {
    const set = new Set(days.map((d) => d.date.slice(0, 7)));
    return [...set].sort();
  }, [days]);

  const [monthIndex, setMonthIndex] = useState(() => Math.max(0, months.length - 1));
  const current = months[Math.min(monthIndex, months.length - 1)] ?? null;

  if (!current) return null;

  const y = Number(current.slice(0, 4));
  const m = Number(current.slice(5, 7));

  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const leading = weekdayMondayFirst(y, m, 1);

  const cells: Array<{ day: number | null; stat: DayStat | undefined }> = [];
  for (let i = 0; i < leading; i++) cells.push({ day: null, stat: undefined });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, stat: index.get(key(y, m, d)) });
  while (cells.length % 7 !== 0) cells.push({ day: null, stat: undefined });

  const monthTotal = days
    .filter((d) => d.date.startsWith(current))
    .reduce((a, d) => a + d.pnl, 0);

  return (
    <div className="calendar">
      <div className="cal-head">
        <button disabled={monthIndex <= 0} onClick={() => setMonthIndex((i) => i - 1)} title="Mes anterior">‹</button>
        <span className="cal-title">
          {MONTHS[m - 1]} {y}
          {/* Etiquetado: una cifra suelta al lado del mes no se sabe si es el
              neto, el bruto, los ticks o cuantas operaciones hubo. */}
          <b
            className={monthTotal > 0 ? 'pos' : monthTotal < 0 ? 'neg' : ''}
            title="Resultado neto del mes, con las comisiones ya descontadas"
          >
            <i>neto</i> {signedUsd(monthTotal, 0)} <span className="note">USD</span>
          </b>
        </span>
        <button
          disabled={monthIndex >= months.length - 1}
          onClick={() => setMonthIndex((i) => i + 1)}
          title="Mes siguiente"
        >
          ›
        </button>
      </div>

      <div className="cal-grid cal-weekdays">
        {WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}
      </div>

      <div className="cal-grid">
        {cells.map((c, i) => {
          if (c.day === null) return <span key={i} className="cal-cell empty" />;

          const stat = c.stat;
          const date = key(y, m, c.day);

          if (!stat) {
            return <span key={i} className="cal-cell off">{c.day}</span>;
          }

          const on = selected.includes(date);
          const strength = Math.min(1, Math.abs(stat.pnl) / scale);
          const arm = stat.pnl >= 0 ? WIN : LOSS;

          return (
            <button
              key={i}
              className={`cal-cell day ${on ? 'on' : ''}`}
              style={{ background: `rgba(${arm}, ${(0.16 + strength * 0.62).toFixed(2)})` }}
              title={`${date} · ${stat.count} operacion${stat.count === 1 ? '' : 'es'} · ${signedUsd(stat.pnl)} USD`}
              onClick={() => onToggle(date)}
            >
              <span className="n">{c.day}</span>
              <span className="v">{signedUsd(stat.pnl, 0)}</span>
            </button>
          );
        })}
      </div>

      {selected.length > 0 && (
        <button className="cal-clear" onClick={onClear}>
          {selected.length} dia{selected.length === 1 ? '' : 's'} seleccionado
          {selected.length === 1 ? '' : 's'} · limpiar
        </button>
      )}
    </div>
  );
}
