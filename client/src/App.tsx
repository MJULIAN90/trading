import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, qs, type Dashboard, type Filters } from './api';
import { Breakdown } from './components/Breakdown';
import { BarsChart, EquityChart, RecentBarsChart } from './components/Charts';
import { DayTable } from './components/DayTable';
import { OpeningsPanel } from './components/OpeningsPanel';

/**
 * Indices de Date.getUTCDay(): 0 es domingo. El servidor manda ese numero y no
 * el nombre para que el orden sea el de la semana y no el alfabetico, que
 * pondria el jueves antes que el lunes.
 */
const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
import { CalendarPanel } from './components/CalendarPanel';
import { CostPanel } from './components/CostPanel';
import { MarketPanel } from './components/MarketPanel';
import { Operations } from './components/Operations';
import { PatternPanel } from './components/PatternPanel';
import { ScratchPanel } from './components/ScratchPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { date, dateTime, num, pct, sessionLabel, setClock, setMarketOffset, signClass, signedUsd, ticks, usd } from './format';
import { TodayBand } from './components/TodayBand';
import { useSort } from './sortable';
import { AlignmentPanel } from './components/AlignmentPanel';
import { Boundary } from './components/Boundary';
import { EarningsStrip } from './components/EarningsStrip';
import { ScalperPanel } from './components/ScalperPanel';
import { ReportPanel } from './components/ReportPanel';
import { SessionDrawdownPanel } from './components/SessionDrawdownPanel';
import { GlobalPanel } from './components/GlobalPanel';

function Tiles({ s, costs }: { s: Dashboard['summary']; costs: Dashboard['costs'] }) {
  const profitable = s.payoff >= s.breakevenPayoff;
  const netTicks = costs.ticksWon + costs.ticksLost;

  const tiles: Array<[string, React.ReactNode, string]> = [
    ['Net P&L (USD)', <span className={signClass(costs.netPnl)}>{signedUsd(costs.netPnl)}</span>, `${signedUsd(costs.grossPnl)} bruto − ${usd(costs.commission)} comisiones`],
    ['Ticks', <span className={signClass(netTicks)}>{ticks(netTicks)}</span>, `${ticks(costs.ticksWon)} / ${ticks(costs.ticksLost)}`],
    ['Win rate', pct(s.winRate), `${s.wins} ganadas / ${s.losses} perdidas`],
    ['Avg win (USD)', <span className="pos">{usd(s.avgWin)}</span>, `${num(s.avgWinMinutes, 1)} min de media`],
    ['Avg loss (USD)', <span className="neg">{usd(s.avgLoss)}</span>, `${num(s.avgLossMinutes, 1)} min de media`],
    ['Payoff', <span className={profitable ? 'pos' : 'neg'}>{num(s.payoff)}</span>, `veces lo que pierdes · necesita ${num(s.breakevenPayoff)} para no perder`],
    ['Expectancy (USD)', <span className={signClass(s.expectancy)}>{signedUsd(s.expectancy)}</span>, 'por operacion'],
    ['Loss streak', String(s.maxLossStreak), `mejor racha: ${s.maxWinStreak}`],

    // El drawdown no sale de ninguna otra tarjeta: se puede tener esperanza
    // positiva y aun asi quebrar por el camino si el drawdown es mas hondo que lo
    // que tienes depositado.
    [
      'Max drawdown (USD)',
      <span className={s.maxDrawdown > 0 ? 'neg' : ''}>{usd(s.maxDrawdown)}</span>,
      s.drawdownFrom
        ? `desde ${s.drawdownFrom} hasta ${s.drawdownTo}, cayendo de ${usd(s.drawdownPeak)}`
        : 'medido desde el inicio: la curva nunca subio del punto de partida',
    ],
    [
      'Profit factor',
      s.profitFactor === null
        ? <span className="note">—</span>
        : <span className={s.profitFactor >= 1 ? 'pos' : 'neg'}>{num(s.profitFactor)}</span>,
      s.profitFactor === null
        ? 'todavia no hay ninguna operacion perdedora'
        : 'ganancias entre perdidas · por encima de 1 se gana',
    ],
    [
      'Day win %',
      <span className={s.dayWinRate >= 0.5 ? 'pos' : 'neg'}>{pct(s.dayWinRate)}</span>,
      `${s.greenDays} de ${s.tradedDays} · mejor ${signedUsd(s.bestDayPnl)}, peor ${signedUsd(s.worstDayPnl)}`,
    ],
  ];

  return (
    <div className="tiles">
      {tiles.map(([k, v, n]) => (
        <div className="tile" key={k}>
          <div className="k">{k}</div>
          <div className="v">{v}</div>
          <div className="n">{n}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Ajuste de la comision, en la cabecera y no escondido en un fichero de
 * configuracion: ese numero cambia las metricas de toda la aplicacion, asi que
 * tiene que estar a la vista mientras las miras.
 */
function CommissionSetting({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => { setDraft(String(value)); }, [value]);

  return (
    <label title="Comision mas tasas por contrato, ida y vuelta completa">
      Comision
      <input
        type="number"
        step="0.05"
        min="0"
        value={draft}
        style={{ width: 70 }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (Number.isFinite(n) && n >= 0 && n !== value) onChange(n);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      $/contrato
    </label>
  );
}

/**
 * El selector de cuentas de la barra de arriba, con casillas.
 *
 * Era un desplegable de una sola cuenta. Con dos cuentas daba igual -o una, o
 * la otra, o todas- pero con tres ya no: "las dos de verdad y la de pruebas
 * no" no se puede pedir con un desplegable. El dominio ya lo admitia desde el
 * cambio anterior (`Filter.accounts` es una lista y la consulta usa
 * `account_id IN (...)`); lo unico que faltaba era el mando.
 *
 * Los tres estados son los mismos que entiende el servidor, y conviene no
 * perderlos de vista porque el del medio es el que no es obvio:
 *
 *   no se manda `accounts`  ->  decide la marca de Ajustes
 *   se manda la lista vacia ->  TODAS, y le gana al ajuste
 *   se manda una lista      ->  esas cuentas
 *
 * Por eso "todas" manda `[]` y no `undefined`: con `undefined` el servidor
 * volveria a aplicar el ajuste y el mando pareceria no hacer nada.
 *
 * Esto es el filtro de ahora mismo, de usar y tirar. La marca permanente -la
 * que se aplica sola cada vez que abres la app- sigue estando en
 * Ajustes -> Grafico, justo debajo del Reloj; son dos cosas distintas a
 * proposito: aqui se prueba, alli se decide.
 */
function SelectorCuentas({
  cuentas,
  elegidas,
  porDefecto,
  onChange,
}: {
  cuentas: Dashboard['accounts'];
  elegidas: string[] | undefined;
  porDefecto: string[];
  onChange: (v: string[]) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  // Lo que el servidor esta aplicando AHORA. Si el filtro no se ha tocado,
  // eso es lo que diga Ajustes, no "todas": el rotulo tiene que decir la
  // verdad desde el primer render o el usuario lee mal todas las cifras.
  const activas = elegidas ?? porDefecto;
  const todas = activas.length === 0 || activas.length === cuentas.length;

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current !== null && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);

  const marcar = (id: string) => {
    // Partiendo de "todas", desmarcar una significa "las demas": hay que
    // materializar la lista completa antes de quitar nada, porque `[]` no
    // es "ninguna" sino justamente "todas".
    const base = todas ? cuentas.map((c) => c.id) : activas;
    const nueva = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    // Quedarse sin ninguna marcada no es un filtro que devuelva cero
    // operaciones: es lo que uno hace para volver a empezar. Se entiende
    // como "todas", igual que marcarlas todas.
    onChange(nueva.length === cuentas.length ? [] : nueva);
  };

  const total = cuentas.reduce((a, c) => a + c.operations, 0);
  const ops = todas
    ? total
    : cuentas.filter((c) => activas.includes(c.id)).reduce((a, c) => a + c.operations, 0);
  const rotulo = todas
    ? `todas (${total})`
    : activas.length === 1
      ? `${activas[0]} (${ops})`
      : `${activas.length} cuentas (${ops})`;

  return (
    <div className="selector-cuentas" ref={caja}>
      <span className="k">Cuenta</span>
      <button type="button" className="abrir" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        {rotulo} <span className="flecha">▾</span>
      </button>

      {abierto && (
        <div className="lista">
          <label className="cuenta-todas">
            <input type="checkbox" checked={todas} onChange={() => onChange([])} />
            <span>todas</span>
            <span className="n">{total} ops</span>
          </label>
          {cuentas.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={todas || activas.includes(c.id)}
                onChange={() => marcar(c.id)}
              />
              <span>{c.id}</span>
              <span className="n">{c.operations} ops · desde {date(c.from)}</span>
            </label>
          ))}
          <div className="pie">
            La marca permanente esta en <b>Ajustes → Grafico</b>. Esto es solo
            para esta sesion.
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Las secciones del lateral, agrupadas por la PREGUNTA que contestan.
 *
 * La agrupacion no es nueva -la fila de pestanas ya estaba ordenada asi- pero
 * vivia en el orden de los botones y no se veia. El lateral la hace explicita.
 *
 * El corte que importa es el de los dos ultimos grupos:
 *
 *   MI OPERATIVA  lo que PASO. Informe y Operaciones.
 *   ANALISIS      que habria pasado SI. Horarios, Disciplina, Scalper, Costes.
 *
 * Scalper y Costes son simulaciones sobre las mismas entradas, no resultados.
 * Mezclarlas con el informe invita a leer una simulacion como si fuera lo que
 * ocurrio, y todo el metodo del proyecto va de mantener eso separado.
 *
 * "Mercado" pasa a llamarse ESTUDIO y se va con News y Calendario: ese panel
 * no mira tus operaciones, es estudio de mercado puro. Estaba entre Scalper y
 * Costes, donde nadie podia adivinarlo.
 */
type Tab =
  | 'resumen'
  | 'global'
  | 'calendario'
  | 'mercado'
  | 'informe'
  | 'operaciones'
  | 'cuando'
  | 'conducta'
  | 'scalper'
  | 'costes'
  | 'ajustes';

interface Seccion {
  /** null = va suelta, sin titulo de grupo. */
  grupo: string | null;
  items: Array<{ id: Tab; label: string }>;
}

const SECCIONES: Seccion[] = [
  { grupo: null, items: [{ id: 'resumen', label: 'Resumen' }] },
  {
    grupo: 'Mercado',
    items: [
      { id: 'global', label: 'News' },
      { id: 'calendario', label: 'Calendario' },
      { id: 'mercado', label: 'Estudio' },
    ],
  },
  {
    grupo: 'Mi operativa',
    items: [
      { id: 'informe', label: 'Informe' },
      { id: 'operaciones', label: 'Operaciones' },
    ],
  },
  {
    grupo: 'Analisis',
    items: [
      { id: 'cuando', label: 'Horarios' },
      { id: 'conducta', label: 'Disciplina' },
      { id: 'scalper', label: 'Scalper' },
      { id: 'costes', label: 'Costes y recorrido' },
    ],
  },
  { grupo: null, items: [{ id: 'ajustes', label: 'Ajustes' }] },
];

const TABS: Tab[] = SECCIONES.flatMap((s) => s.items.map((i) => i.id));

/**
 * Secciones donde la barra de filtros tiene sentido.
 *
 * News, Calendario y Estudio no miran tus operaciones, y Ajustes tampoco: la
 * barra estaba ahi igualmente, invitando a poner un filtro que no hacia nada.
 */
const CON_FILTROS = new Set<Tab>([
  'resumen', 'informe', 'operaciones', 'cuando', 'conducta', 'scalper', 'costes',
]);

/** La seccion que pide la URL (`#informe`), si es una de las que existen. */
function tabDeLaUrl(): Tab | null {
  const h = location.hash.replace(/^#\/?/, '');
  return (TABS as string[]).includes(h) ? (h as Tab) : null;
}

/** "Que cuesta dinero", ordenable. Componente aparte porque lleva un hook y
 *  dentro del JSX de App no cabe. Arranca por P&L de menor a mayor: lo que mas
 *  te cuesta, arriba. */
function FlagTable({ rows }: { rows: Array<{ code: string; title: string; count: number; pnl: number }> }) {
  const t = useSort(
    rows,
    { observacion: (f) => f.title, veces: (f) => f.count, pnl: (f) => f.pnl },
    { key: 'pnl', dir: 'asc' },
  );

  return (
    <table>
      <thead>
        <tr>
          <t.Th k="observacion">Observacion</t.Th>
          <t.Th k="veces">Veces</t.Th>
          <t.Th k="pnl">P&amp;L acumulado</t.Th>
        </tr>
      </thead>
      <tbody>
        {t.rows.map((f) => (
          <tr key={f.code}>
            <td>{f.title}</td>
            <td>{f.count}</td>
            <td className={signClass(f.pnl)}>{signedUsd(f.pnl)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function App() {
  // Misma BASE que ensena Quantower en la cuenta: bruto. El selector de Base
  // sigue ahi para mirar el neto cuando haga falta.
  //
  // El CORTE, en cambio, es el de mercado -18:00 de Nueva York- en todas
  // partes, calendario incluido. Con el corte a medianoche aparecian domingos
  // sueltos en el calendario, y ninguna mesa de fondeo cuenta asi: lo que abre
  // el domingo por la tarde y cierra el lunes es la sesion del lunes.
  const [filters, setFilters] = useState<Filters>({ basis: 'gross' });
  // La seccion vive tambien en la URL (`#informe`): recargar devuelve donde
  // estabas en vez de a Resumen, y se puede guardar un marcador.
  const [tab, setTab] = useState<Tab>(() => tabDeLaUrl() ?? 'resumen');
  const [data, setData] = useState<Dashboard | null>(null);
  const [live, setLive] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  /**
   * Contador que sube SOLO al pulsar "Actualizar" a mano.
   *
   * El boton recargaba el dashboard, que es lo que alimenta a casi toda la
   * aplicacion, pero el listado de operaciones pide sus datos por su cuenta y
   * no se enteraba: para refrescarlo habia que irse a Resumen y volver, que
   * es lo que lo desmonta y lo vuelve a montar.
   *
   * No lo sube el refresco automatico de cada medio minuto a proposito:
   * recargar el listado por debajo mientras estas leyendo una operacion mueve
   * el suelo sin que lo hayas pedido.
   */
  const [refresco, setRefresco] = useState(0);

  const load = useCallback(() => {
    api
      .dashboard(filters)
      .then((d) => {
        // El reloj ANTES de guardar los datos: si se hiciera despues, el
        // primer pintado usaria el reloj anterior y las horas darian un salto
        // visible al llegar el siguiente render.
        setMarketOffset(d.marketOffsetHours);
        setClock(d.chartPrefs.clock);
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

    api
      .status()
      .then((s) => {
        if (!s.autoIngest) { setLive('ingesta automatica apagada'); return; }
        setLive(s.lastIngest ? `ultima novedad ${dateTime(s.lastIngest.at)}` : 'sin novedades aun');
      })
      .catch(() => { /* el servidor puede estar reiniciando */ });
  }, [filters]);

  /**
   * Refresco automatico, pero NO en las pestanas donde estorba.
   *
   * En Resumen y Noticias interesa que se actualice solo: son numeros que
   * cambian al cerrar una operacion, y el aviso de "no operar" tiene que
   * aparecer sin que nadie pulse nada.
   *
   * En Operaciones y Ajustes hace dano. Las dos tienen estado propio que el
   * usuario acaba de poner con la mano —la temporalidad del grafico, un color a
   * medio elegir— y recargar debajo lo pisa. Perder lo que estabas mirando cada
   * treinta segundos convierte la pantalla en inutilizable.
   */
  const autoRefresh =
    tab === 'resumen' || tab === 'cuando' || tab === 'conducta' || tab === 'calendario';

  useEffect(() => {
    load();
    if (!autoRefresh) return;

    // El servidor mantiene la base al dia solo; basta con volver a pedir.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load, autoRefresh]);

  /**
   * Preferencias con identidad estable.
   *
   * Cada recarga trae un objeto NUEVO aunque el contenido sea identico, y abajo
   * hay efectos que reaccionan a ese objeto para aplicar los ajustes recien
   * guardados. Sin esto, el refresco automatico le devolvia el grafico a su
   * temporalidad por defecto cada treinta segundos mientras lo estabas mirando.
   *
   * Comparar por contenido serializado y no por identidad hace que esos efectos
   * salten solo cuando los ajustes cambian de verdad.
   */
  const prefsKey = data ? JSON.stringify(data.chartPrefs) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chartPrefs = useMemo(() => data?.chartPrefs ?? null, [prefsKey]);

  // Los dos sentidos: al cambiar de seccion se escribe en la URL, y al usar
  // las flechas del navegador se lee de ella.
  useEffect(() => {
    if (location.hash.replace(/^#\/?/, '') !== tab) history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  useEffect(() => {
    const alCambiar = () => setTab(tabDeLaUrl() ?? 'resumen');
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  function saveCommission(v: number) {
    api.saveSettings({ commissionPerContract: v }).then(load);
  }

  return (
    <div className="app">
      <aside className="barra-lateral">
        {/* El logo es la cabecera: ocupa el sitio del antiguo h1 "Diario de
            trading". Lleva `alt` con el nombre por si la imagen no carga. */}
        <img className="logo" src="/greenspot.png" alt="Greenspot" />

        <nav>
          {SECCIONES.map((sec, i) => (
            <div className="grupo" key={sec.grupo ?? `suelto-${i}`}>
              {sec.grupo && <div className="grupo-k">{sec.grupo}</div>}
              {sec.items.map((item) => (
                <button
                  key={item.id}
                  className={tab === item.id ? 'on' : ''}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                  {item.id === 'operaciones' && data && <span className="n">{data.count}</span>}
                  {item.id === 'calendario' && data && data.calendar.activeNow.length > 0 && (
                    <span className="aviso" title="Hay una noticia activa ahora mismo">●</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main>
      {/* Solo queda el aviso de carga.
          Aqui habia una linea de resumen —numero de operaciones, hasta que
          fecha, bruto o neto, el corte de las 18:00 y el reloj— y se quito a
          peticion suya: las dos cosas que mas se miraban ya las dice la barra
          de filtros, que esta justo debajo. El recuento esta en el selector de
          cuentas y la base, en el desplegable "Base". Repetirlas arriba era
          una fila de texto que ya nadie leia.

          Lo que si desaparecio de la pantalla es el corte de jornada y que
          reloj se esta usando. El reloj se cambia en Ajustes -> Grafico; si
          alguna vez una hora no cuadra con Quantower, ahi es donde mirar. */}
      {data === null && <div className="sub">cargando...</div>}

      {/* `principal` distingue esta barra de las que usan los paneles por
          dentro: la clase `filters` esta en catorce sitios mas. */}
      {CON_FILTROS.has(tab) && (
      <div className="filters principal">
        <label>Desde <input type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} /></label>
        <label>Hasta <input type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} /></label>
        <label>
          Sesion
          <select value={filters.session ?? ''} onChange={(e) => set({ session: e.target.value || undefined })}>
            <option value="">todas</option>
            {['ASIA', 'LONDON', 'NY_AM', 'NY_LUNCH', 'NY_PM', 'OUTSIDE'].map((s) => (
              <option key={s} value={s}>{sessionLabel(s)}</option>
            ))}
          </select>
        </label>
        {/* El selector de cuenta va el primero de la fila: es el filtro que mas
            cambia lo que ves, porque dos cuentas distintas son dos historiales
            distintos y mezclarlos no tiene ningun sentido. */}
        {data && data.accounts.length > 0 && (
          <SelectorCuentas
            cuentas={data.accounts}
            elegidas={filters.accounts}
            porDefecto={data.chartPrefs.metricAccounts}
            onChange={(v) => set({ accounts: v })}
          />
        )}
        <label>
          Base
          <select value={filters.basis ?? 'net'} onChange={(e) => set({ basis: e.target.value as 'net' | 'gross' })}>
            <option value="net">neto</option>
            <option value="gross">bruto</option>
          </select>
        </label>
        {data && <CommissionSetting value={data.costSettings.commissionPerContract} onChange={saveCommission} />}
        <button onClick={() => { load(); setRefresco((r) => r + 1); }}>Actualizar</button>
        <span className="live"><b>en vivo</b> · {live}</span>
      </div>
      )}

      {/* Pegada a la barra y FUERA de las secciones: un informe que sale dentro
          de catorce minutos tiene que verse estes donde estes, y las alarmas
          con sonido no pueden depender de que tengas abierta la pestana News.
          Con su propio limite de errores, porque es lo ultimo que puede
          permitirse tumbar la pantalla entera. */}
      <Boundary nombre="resultados">
        <EarningsStrip />
      </Boundary>

      {error && <div className="error">No se pudo cargar: {error}</div>}

      {/* Elegir una cuenta y ver cero operaciones solo puede pasar ya por el
          filtro de fechas o el de sesion, no por el de pruebas: la cuenta
          siempre se ensena entera. */}
      {data && data.count === 0 && filters.accounts?.length && (filters.from || filters.to || filters.session) && (
        <div className="news-alert">
          <b>Nada que mostrar</b>
          <span>
            Esa cuenta no tiene operaciones dentro del filtro de fecha o sesion que tienes puesto.{' '}
            <button onClick={() => set({ from: undefined, to: undefined, session: undefined })}>
              Quitar esos filtros
            </button>
          </span>
        </div>
      )}

      {data && (
        <>
          {/* Lo que llevas hoy contra tu limite. Por el mismo motivo que el
              aviso de noticias: si hay que parar, tiene que verse estes donde
              estes. Se pinta sola solo cuando hay limite puesto y operaciones
              en la jornada. */}
          <TodayBand />

          {/* El aviso de noticia se ensena en TODAS las pestanas, no solo en la
              suya: si hay que no operar, tiene que verse estes donde estes. */}
          {data.calendar.activeNow.length > 0 && tab !== 'calendario' && (
            <div className="news-alert">
              <b>No operar</b>
              {data.calendar.activeNow.map((b) => (
                <span key={b.event.id}>
                  {b.event.title} · {b.minutesTo > 0 ? `en ${b.minutesTo} min` : b.minutesTo === 0 ? 'ahora' : `hace ${Math.abs(b.minutesTo)} min`}
                </span>
              ))}
            </div>
          )}

          {/* Un panel que revienta al pintar ya no deja la pagina en blanco.
              La barra de pestañas se queda FUERA a proposito: si el error se
              la llevara, no habria forma de irse a otra pestaña.
              `key={tab}` limpia el error al cambiar de pestaña. */}
          <Boundary key={tab} nombre={tab}>

          {tab === 'mercado' && (
            <>
              <MarketPanel />

              {/* Estudio de mercado puro: no miran una sola operacion tuya.
                  Estaban en Resumen y ese no era su sitio. */}
              <div className="panel">
                <h2>Aperturas de killzone</h2>
                <OpeningsPanel />
              </div>

              <div className="panel">
                <h2>Patron de la vela de 15 minutos</h2>
                <PatternPanel data={data.patterns} />
              </div>
            </>
          )}

          {tab === 'calendario' && <CalendarPanel data={data.calendar} news={data.news} />}

          {tab === 'global' && (
            <div className="panel">
              <h2>News · contexto de mercado</h2>
              <GlobalPanel />
            </div>
          )}

          {tab === 'ajustes' && (
            <SettingsPanel
              prefs={chartPrefs ?? data.chartPrefs}
              accounts={data.accounts}
              commission={data.costSettings.commissionPerContract}
              dailyLimit={data.costSettings.dailyLossLimit}
              onSaved={load}
            />
          )}

          {tab === 'resumen' && (
            <>
              <Tiles s={data.summary} costs={data.costs} />

              <div className="panel">
                <h2>Curva de capital ({data.basis === 'net' ? 'neta' : 'bruta'})</h2>
                <EquityChart points={data.equity} />
              </div>

              <div className="panel">
                <h2>P&amp;L por fecha</h2>
                <RecentBarsChart
                  rows={data.byDay}
                  label={(k) => String(k).slice(8) + '/' + String(k).slice(5, 7)}
                />
              </div>
            </>
          )}

          {tab === 'cuando' && (
            <>
              <div className="grid2">
                <div className="panel">
                  <h2>P&amp;L por sesion</h2>
                  <BarsChart rows={data.bySession} label={(k) => sessionLabel(String(k))} />
                </div>
                <div className="panel">
                  <h2>P&amp;L por hora de mercado</h2>
                  <BarsChart rows={data.byHour} label={(k) => `${String(k).padStart(2, '0')}:00`} />
                </div>
              </div>

              {/* El drawdown va justo detras del P&L por sesion porque es la misma
                  pregunta un nivel mas abajo: una dice que franja deja dinero y
                  la otra cuanto hay que aguantar para cobrarlo. Separadas, la
                  primera parece una recomendacion de donde operar. */}
              <SessionDrawdownPanel data={data.sessionDrawdown} />

              <div className="panel">
                <h2>P&amp;L por dia de la semana</h2>
                <BarsChart rows={data.byWeekday} label={(k) => WEEKDAYS[Number(k)] ?? String(k)} />
              </div>

              <div className="panel">
                <h2>Resumen por dia</h2>
                <div className="note" style={{ marginBottom: 8 }}>
                  Cuantas operaciones hubo cada dia, como se repartieron entre compras y
                  ventas, y cuanto dejo cada dia. Las cifras de dinero son{' '}
                  <b>dolares por contrato</b>, en bruto: sin comisiones.
                </div>
                <DayTable
                  rows={data.byDay}
                  label={(k) => String(k).slice(8) + '/' + String(k).slice(5, 7)}
                />
              </div>
            </>
          )}

          {tab === 'conducta' && (
            <>
              {/* El cruce entre el mercado y tu: lo unico que contesta "¿me va
                  mejor cuando entro alineado?". Va el primero porque es la
                  pregunta mas grande que se puede hacer esta pantalla. */}
              <div className="panel">
                <h2>Alineacion con las medias al entrar</h2>
                <AlignmentPanel query={qs(filters)} />
              </div>

              <div className="panel">
                <h2>Que cuesta dinero</h2>
                <FlagTable rows={data.flagImpact} />
                <div className="note">
                  Suma del resultado de todas las operaciones que llevan cada observacion. Una misma
                  operacion puede aparecer en varias filas, asi que los totales no se suman entre si.
                </div>
              </div>

              <div className="panel">
                <h2>Metricas por grupo</h2>
                <Breakdown data={data} />
              </div>
            </>
          )}

          {tab === 'operaciones' && (
            <Operations
              filters={filters}
              offsetHours={data.marketOffsetHours}
              prefs={chartPrefs ?? data.chartPrefs}
              refreshKey={refresco}
            />
          )}

          {/* El informe se refresca solo al cambiar de periodo o de filtro: no
              entra en el auto-refresco porque tiene su propio selector y
              recargarlo debajo mientras se lee no aporta nada. */}
          {tab === 'informe' && <ReportPanel query={qs(filters)} />}

          {tab === 'scalper' && <ScalperPanel filters={filters} />}

          {tab === 'costes' && (
            <>
              <CostPanel costs={data.costs} excursion={data.excursion} settings={data.costSettings} />
              <ScratchPanel data={data.scratch} operations={data.count} />
            </>
          )}

          </Boundary>
        </>
      )}
      </main>
    </div>
  );
}
