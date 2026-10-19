import { useState } from 'react';
import type { Dashboard, Group, Summary } from '../api';
import { num, pct, sessionLabel, signClass } from '../format';

type Dim = 'session' | 'weekday' | 'day' | 'hour' | 'direction';

const DIMS: Array<{ key: Dim; label: string; title: string }> = [
  { key: 'session', label: 'Por sesion', title: 'Sesion' },
  // "Por dia de la semana" va antes que "Por fecha" porque es la que se mira:
  // la de fechas sirve para repasar una jornada suelta, no para ver un habito.
  { key: 'weekday', label: 'Por dia de la semana', title: 'Dia' },
  { key: 'day', label: 'Por fecha', title: 'Fecha' },
  { key: 'hour', label: 'Por hora', title: 'Hora' },
  { key: 'direction', label: 'Por direccion', title: 'Direccion' },
];

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

function labelFor(dim: Dim, key: string | number): string {
  if (dim === 'session') return sessionLabel(String(key));
  if (dim === 'weekday') return WEEKDAYS[Number(key)] ?? String(key);
  if (dim === 'hour') return `${String(key).padStart(2, '0')}:00`;
  if (dim === 'direction') return key === 'LONG' ? 'Largo' : 'Corto';
  return String(key);
}

/**
 * Una fila por grupo con las metricas que de verdad deciden si algo funciona.
 *
 * El payoff se compara contra el que haria falta para no perder con ese acierto
 * concreto: 45% de aciertos necesita ganar 1,22 veces lo que pierde, y 60%
 * necesita 0,67. Sin esa referencia al lado, un payoff de 0,8 no se sabe si es
 * bueno o malo.
 */
function Row({ name, s }: { name: string; s: Summary }) {
  const profitable = s.payoff >= s.breakevenPayoff && s.breakevenPayoff > 0;

  return (
    <tr>
      <td>{name}</td>
      <td>{s.operations}</td>
      <td>{pct(s.winRate)}</td>
      <td className={signClass(s.grossPnl)}>{num(s.grossPnl)}</td>
      <td className={signClass(s.expectancy)}>{num(s.expectancy)}</td>
      <td className="pos">{num(s.avgWin)}</td>
      <td className="neg">{num(s.avgLoss)}</td>
      <td className={s.operations >= 5 ? (profitable ? 'pos' : 'neg') : ''}>
        {num(s.payoff)}
        <span style={{ color: 'var(--ink-muted)', fontSize: 11 }}> / {num(s.breakevenPayoff)}</span>
      </td>
      <td>{num(s.avgWinMinutes, 1)} / {num(s.avgLossMinutes, 1)}</td>
    </tr>
  );
}

export function Breakdown({ data }: { data: Dashboard }) {
  const [dim, setDim] = useState<Dim>('session');

  const groups: Record<Dim, Group[]> = {
    session: data.bySession,
    weekday: data.byWeekday,
    day: data.byDay,
    hour: data.byHour,
    direction: data.byDirection,
  };

  const rows = groups[dim];
  const total = rows.reduce(
    (acc, r) => ({
      ops: acc.ops + r.summary.operations,
      wins: acc.wins + r.summary.wins,
      pnl: acc.pnl + r.summary.grossPnl,
    }),
    { ops: 0, wins: 0, pnl: 0 },
  );

  return (
    <>
      <div className="filters" style={{ marginBottom: 12 }}>
        {DIMS.map((d) => (
          <button
            key={d.key}
            onClick={() => setDim(d.key)}
            style={dim === d.key ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
          >
            {d.label}
          </button>
        ))}
      </div>

      <table>
        <thead>
          <tr>
            <th>{DIMS.find((d) => d.key === dim)?.title}</th>
            <th>Ops</th>
            <th>Acierto</th>
            <th>P&amp;L</th>
            <th>Por op.</th>
            <th>Gan. media</th>
            <th>Perd. media</th>
            <th title="Cuanto ganas por cada unidad que pierdes, y al lado el minimo que necesitas con ese acierto">
              Payoff / necesario
            </th>
            <th title="Duracion media en minutos: ganadoras / perdedoras">Minutos gan/perd</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={String(r.key)} name={labelFor(dim, r.key)} s={r.summary} />
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 600 }}>
            <td>Total</td>
            <td>{total.ops}</td>
            <td>{total.ops ? pct(total.wins / total.ops) : '-'}</td>
            <td className={signClass(total.pnl)}>{num(total.pnl)}</td>
            <td colSpan={5} />
          </tr>
        </tfoot>
      </table>

      <div className="note">
        <b>Payoff / necesario</b>: lo que ganas por cada unidad que pierdes, y al lado el mínimo que
        haría falta para no perder dinero con ese porcentaje de acierto. En verde cuando lo supera,
        y sin color cuando hay menos de cinco operaciones, que es cuando el dato todavía no dice nada.
        <br />
        <b>Minutos gan/perd</b>: cuánto duran de media las ganadoras y cuánto las perdedoras. Si las
        perdedoras duran más, las estás dejando correr más que las buenas.
      </div>
    </>
  );
}
