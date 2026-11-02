import reaccionMedida from './reaccion.json';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DayCalendar } from '../src/components/DayCalendar';
import { EarningsStrip } from '../src/components/EarningsStrip';
import { GlobalPanel } from '../src/components/GlobalPanel';
import { Operations } from '../src/components/Operations';
import { EquityChart } from '../src/components/Charts';
import { AlignmentPanel } from '../src/components/AlignmentPanel';
import { ScalperPanel } from '../src/components/ScalperPanel';
import dashboardJson from './dashboard.json';
import informesJson from './informes.json';
import App from '../src/App';
import { BarsChart } from '../src/components/Charts';
import { ReportPanel } from '../src/components/ReportPanel';
import { SessionDrawdownPanel } from '../src/components/SessionDrawdownPanel';
import { setClock } from '../src/format';
import '../src/styles.css';

/**
 * Banco de pruebas de la pantalla, sin servidor y sin base.
 *
 * Tres bloques, elegidos por la URL con `?v=`:
 *
 *   ?v=resultados  las tres franjas de la barra -informes, calendario
 *                  economico y resultados ya publicados- y sus alarmas. La distancia del
 *                  primer informe se elige con `&min=`:
 *                    &min=20        debe sonar el aviso de 1 HORA, uno solo
 *                    &min=10        el de 15 minutos
 *                    &min=2880      todavia ninguno
 *                    &min=20&dos=1  dos empresas: el segundo modal sale al
 *                                   cerrar el primero
 *   ?v=calendario  el calendario de jornadas, con octubre de 2026 real. Tiene
 *                  que salir de LUNES A VIERNES y sin domingos.
 *   ?v=operaciones el listado, para comprobar que las notas salen DEBAJO del
 *                  grafico y no en una pestana aparte.
 *   ?v=news        la pestana News con sus datos reales del 30 de octubre, para
 *                  ver la tabla de acciones con la hora de los informes.
 *   ?v=alineacion  la alineacion con las medias, con sus cifras reales.
 *   ?v=scalper     el simulador de salida fija, con el resultado REAL de sus
 *                  573 operaciones medido sobre sus velas.
 *   ?v=curva       la curva de capital, con el caso que pisaba las etiquetas:
 *                  acaba en +158 y toca suelo en -2949.
 *   ?v=app         LA APLICACION ENTERA con datos reales: el lateral, el logo
 *                  y las secciones. Es lo unico que comprueba la maquetacion.
 *   ?v=globo       el grafico de barras EMPUJADO AL FONDO de una pagina larga,
 *                  que es donde el globo se salia de la ventana. Pasar el raton
 *                  por la ultima barra tiene que dejarlo entero dentro.
 *   ?v=informe     el informe diario y semanal, con el selector de periodo
 *                  funcionando y las cifras reales de sus 573 operaciones.
 *   ?v=drawdown        el drawdown por killzone, con el informe REAL de sus 573
 *                  operaciones: las 30 celdas probadas, cero supervivientes al
 *                  Benjamini-Hochberg, y el hueco de 11:00-12:00 a -501.
 *
 * Y en cualquiera de ellos, `&reloj=mercado` pinta las horas en hora de Nueva
 * York en vez de en la de este ordenador, que es el ajuste de Ajustes >
 * Grafico > Reloj.
 */

const q = new URLSearchParams(location.search);
const vista = q.get('v') ?? 'resultados';
setClock(q.get('reloj') === 'mercado' ? 'mercado' : 'local');

// ---------------------------------------------------------------- resultados

const ahora = Date.now();
const MIN = Number(q.get('min') ?? 14);
const DOS = q.has('dos');
const dia = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const cita = (symbol: string, name: string, enMs: number) => ({
  symbol,
  name,
  date: dia(ahora + enMs),
  when: 'amc',
  at: ahora + enMs,
  hhmm: '16:30',
  medido: symbol === 'GOOGL' ? { hhmm: '16:01', n: 6, rango: '16:01-16:01' } : null,
  faltaMs: enMs,
  epsEstimate: 2.02,
});

// Calendario economico: sus eventos T1 reales, movidos al reloj de ahora.
// El primero cae dentro del horizonte de alarma; el segundo, a seis dias, es
// el que tiene que salir APAGADO por estar a mas de tres dias.
const economicos = [
  {
    id: 't1-nominas', titulo: 'T1 · U.S. Employment Report',
    at: ahora + MIN * 60_000 + 90_000, faltaMs: MIN * 60_000 + 90_000,
    impact: 'high', currency: 'USD', forecast: 165, previous: 142,
    source: 't1-2026.csv', silencioAntes: 2, silencioDespues: 3,
  },
  {
    id: 't1-cpi', titulo: 'T1 · CPI',
    at: ahora + 6 * 86_400_000, faltaMs: 6 * 86_400_000,
    impact: 'high', currency: 'USD', forecast: null, previous: null,
    source: 't1-2026.csv', silencioAntes: 2, silencioDespues: 3,
  },
];

// GOOGL con hora medida (16:01) junto a una sin medir, para ver las dos
// etiquetas -"medida · 6" y "convencion"- en la misma franja.
const earnings = {
  now: ahora,
  agenda: [
    cita('AAPL', 'Apple', MIN * 60_000),
    ...(DOS ? [cita('NVDA', 'NVIDIA', MIN * 60_000)] : []),
    cita('GOOGL', 'Alphabet (A)', 2.9 * 86_400_000),
  ],
  sorpresas: [
    { symbol: 'GOOGL', name: 'Alphabet (A)', date: dia(ahora - 2 * 86_400_000), epsEstimate: 3.1095, epsActual: 2.12, desvioPct: -31.8, fallo: true },
    { symbol: 'AMZN', name: 'Amazon', date: dia(ahora - 86_400_000), epsEstimate: 2.001, epsActual: 1.89, desvioPct: -5.5, fallo: true },
    { symbol: 'MSFT', name: 'Microsoft', date: dia(ahora - 2 * 86_400_000), epsEstimate: 4.8165, epsActual: 4.89, desvioPct: 1.5, fallo: false },
  ],
  settings: { amcHour: '16:30', bmoHour: '08:30' },
};

// --------------------------------------------------------------- calendario
//
// Octubre de 2026 tal cual, de su diario. El 25 es DOMINGO y antes salia con
// +119: ese es justo el caso que no debe volver a aparecer.
const jornadas = [
  ['2026-10-12', -58], ['2026-10-13', -340], ['2026-10-14', 834], ['2026-10-15', -478],
  ['2026-10-19', 13], ['2026-10-20', 537], ['2026-10-21', 35], ['2026-10-22', 99],
  ['2026-10-23', -138], ['2026-10-26', 173], ['2026-10-27', 248], ['2026-10-28', -204],
  ['2026-10-29', 367], ['2026-10-30', 284],
] as Array<[string, number]>;

const dias = jornadas.map(([date, pnl]) => ({ date, count: 3, pnl }));

// --------------------------------------------------------------------- news
//
// Cotizaciones y calendario de resultados tal como estaban el 30 oct 2026.

const PESOS: Record<string, number> = {
  AAPL: 7.4, AMD: 4.2, AMZN: 4.1, GOOG: 2.8, GOOGL: 3.1,
  META: 3.3, MSFT: 5.8, MU: 5.0, NVDA: 8.3, TSLA: 2.8,
};

// La hora a la que cotizo cada uno, para ver los cinco estados a la vez:
// sesion regular, pre-mercado, after, fuera de horario y cierre diario.
const JUE = Date.parse('2026-10-29T00:00:00Z');
const nyA = (dia: number, hh: number, mm: number) =>
  JUE + dia * 86_400_000 + (hh + 4) * 3_600_000 + mm * 60_000;

const CUANDO: Record<string, number | null> = {
  AAPL: nyA(1, 11, 42),
  AMD: nyA(1, 11, 41),
  AMZN: nyA(1, 7, 12),
  GOOG: nyA(1, 17, 40),
  GOOGL: nyA(1, 17, 40),
  META: nyA(1, 2, 10),
  MSFT: nyA(1, 11, 42),
  MU: nyA(1, 11, 42),
  NVDA: nyA(1, 11, 42),
  TSLA: nyA(0, 15, 59),
};

const COTIZACIONES: Array<[string, string, number, number, number | null]> = [
  ['AAPL', 'Apple', 344.63, -1.23, -0.89],
  ['AMD', 'Advanced Micro Devices', 504.8, -10.88, -2.32],
  ['AMZN', 'Amazon', 240.35, -1.41, -3.08],
  ['GOOG', 'Alphabet (C)', 278.22, -1.45, -12.31],
  ['GOOGL', 'Alphabet (A)', 279.84, -1.4, -12.61],
  ['META', 'Meta Platforms', 614.99, -1.53, -4.3],
  ['MSFT', 'Microsoft', 521.91, -1.55, -0.5],
  ['MU', 'Micron', 884.74, -5.3, 0.82],
  ['NVDA', 'NVIDIA', 204.64, -4.22, -3.0],
  ['TSLA', 'Tesla', 399.81, -0.87, 7.41],
];

const RESULTADOS: Array<[string, string, string, number]> = [
  ['AAPL', 'Apple', '2026-11-02', 3],
  ['AMD', 'Advanced Micro Devices', '2026-11-03', 4],
  ['AMZN', 'Amazon', '2026-10-29', -1],
  ['GOOGL', 'Alphabet (A)', '2026-10-28', -2],
  ['MSFT', 'Microsoft', '2026-10-28', -2],
  ['MU', 'Micron', '2026-12-15', 46],
  ['NVDA', 'NVIDIA', '2026-11-25', 26],
];

const globalReport = {
  quotes: [
    ...COTIZACIONES.map(([symbol, name, price, changePct, changePct5d]) => ({
      symbol, label: symbol, kind: 'accion', price, changePct, ts: ahora,
      quoteTs: CUANDO[symbol] ?? null, prevClose: price * 1.01,
      name, weight: PESOS[symbol] ?? null, changePct5d,
      change1d: null, change5d: null, dias: 6,
    })),
    {
      symbol: 'WTI', label: 'WTI · crudo de EE.UU.', kind: 'materia', price: 103.37, changePct: null,
      ts: ahora, quoteTs: null, prevClose: null,
      name: 'WTI', weight: null, changePct5d: -4.19,
      change1d: -1.12, change5d: -4.52, dias: 6,
    },
    {
      // Sin historico suficiente: la columna 5d tiene que salir rayada y decir
      // cuantas jornadas faltan, no inventar un numero.
      symbol: 'BRENT', label: 'Brent · crudo de referencia', kind: 'materia', price: 123.1, changePct: null,
      ts: ahora, quoteTs: null, prevClose: null,
      name: 'Brent', weight: null, changePct5d: null,
      change1d: 0.84, change5d: null, dias: 3,
    },
    {
      symbol: 'US5Y', label: 'EE.UU. 5 anios', kind: 'bono', price: 4.61, changePct: null,
      ts: ahora, quoteTs: null, prevClose: null,
      name: 'EE.UU. 5 anios', weight: null, changePct5d: null,
      change1d: 0.04, change5d: 0.12, dias: 6,
    },
    {
      symbol: 'US10Y', label: 'EE.UU. 10 anios', kind: 'bono', price: 5.05, changePct: null,
      ts: ahora, quoteTs: null, prevClose: null,
      name: 'EE.UU. 10 anios', weight: null, changePct5d: null,
      change1d: 0.07, change5d: 0.09, dias: 6,
    },
    {
      symbol: 'US30Y', label: 'EE.UU. 30 anios', kind: 'bono', price: 5.42, changePct: null,
      ts: ahora, quoteTs: null, prevClose: null,
      name: 'EE.UU. 30 anios', weight: null, changePct5d: null,
      change1d: -0.03, change5d: 0.02, dias: 6,
    },
    {
      symbol: 'QQQ', label: 'QQQ · ETF del Nasdaq 100', kind: 'indice', price: 690.49,
      changePct: -3.47, ts: ahora, quoteTs: CUANDO.AAPL ?? null, prevClose: null,
      name: 'QQQ', weight: null, changePct5d: null,
      change1d: null, change5d: null, dias: 6,
    },
  ],
  earnings: RESULTADOS.map(([symbol, name, date, daysTo]) => ({
    symbol, name, date, when: 'amc',
    epsEstimate: 2.02, epsActual: null, revenueEstimate: null, revenueActual: null,
    daysTo, at: Date.parse(`${date}T21:30:00Z`), hhmm: '16:30',
  })),
  news: [], updatedAt: ahora, error: null, alerts: [],
  alpha: { day: dia(ahora), used: 16, budget: 20 },
  phase: 'abierto', nextAt: ahora + 300_000, newsWindowDays: 3,
  blocks: [{ name: 'cotizaciones', okAt: ahora, rows: 11, failAt: null, error: null, stale: false }],
};

// -------------------------------------------------------------------- curva
//
// La forma real de su curva: arranca en 0, se hunde hasta unos -900, se
// recupera, y el 28 de octubre cae a -2949 en dos operaciones antes de acabar
// en +158. Ese final tan cerca del cero es lo que pisaba las etiquetas.
const curva = (() => {
  const pts: Array<{ ts: number; pnl: number; equity: number }> = [];
  let eq = 0;
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5);
  for (let i = 0; i < 573; i += 1) {
    let pnl: number;
    if (i === 531) pnl = -589;
    else if (i === 532) pnl = -1079;
    else if (i === 533) pnl = 1400;
    else pnl = azar() * 120 + (i < 120 ? -8 : i < 420 ? 3 : 6);
    eq += pnl;
    pts.push({ ts: Date.parse('2026-10-05T12:00:00Z') + i * 45 * 60_000, pnl, equity: eq });
  }
  // Se estira con una transformacion afin para que el SUELO caiga en -2949 y
  // el FINAL en +158, que son sus dos cifras. Asi la escala del grafico es la
  // suya, que es lo que hacia que "+158" y "$0" quedaran a diez pixeles.
  const suelo = Math.min(...pts.map((x) => x.equity));
  const fin = pts[pts.length - 1]!.equity;
  const a = (158 - -2949) / (fin - suelo);
  const bb = 158 - a * fin;
  return pts.map((x) => ({ ...x, pnl: x.pnl * a, equity: a * x.equity + bb }));
})();

// --------------------------------------------------------------- alineacion
//
// Sus cifras reales del 31 de octubre, para comprobar sobre todo que la
// columna nueva -"sin pila"- cuadra con las cabeceras.
const caj = (favor: number, operations: number, conPila: number, hitRate: number,
             netPnl: number, avgNet: number, ticksTot: number,
             porMarco = { m1: 0, m15: 0, h1: 0, h4: 0 }) => ({
  favor, operations, conPila, porMarco, wins: Math.round(operations * hitRate), hitRate,
  netPnl, avgNet, ticks: ticksTot,
});

const alineacion = {
  symbol: 'F.US.MNQZ26',
  analyzed: 573,
  skipped: 0,
  buckets: [
    caj(0, 287, 154, 0.289, -2631, -9.17, -3045, { m1: 0, m15: 0, h1: 0, h4: 0 }),
    caj(1, 135, 42, 0.370, 148, 1.10, 812, { m1: 61, m15: 24, h1: 30, h4: 20 }),
    caj(2, 82, 1, 0.390, 1290, 15.73, 457, { m1: 55, m15: 44, h1: 35, h4: 30 }),
    caj(3, 50, 0, 0.320, 135, 2.70, -381, { m1: 41, m15: 45, h1: 40, h4: 24 }),
    caj(4, 19, 0, 0.421, 39, 2.05, -132, { m1: 19, m15: 19, h1: 19, h4: 19 }),
  ],
  byFrame: [
    { frame: 'm1', favor: caj(1, 157, 157, 0.36, 363, 2.31, 0), contra: caj(0, 85, 85, 0.31, -203, -2.39, 0) },
    { frame: 'm15', favor: caj(1, 138, 138, 0.39, 1132, 8.20, 0), contra: caj(0, 82, 82, 0.28, -1615, -19.69, 0) },
    { frame: 'h1', favor: caj(1, 134, 134, 0.37, 738, 5.51, 0), contra: caj(0, 88, 88, 0.30, -835, -9.49, 0) },
    { frame: 'h4', favor: caj(1, 96, 96, 0.40, 1058, 11.02, 0), contra: caj(0, 72, 72, 0.32, -74, -1.03, 0) },
  ],
};

// ------------------------------------------------------------------ scalper
//
// Numeros REALES, sacados de simular sus 573 operaciones sobre sus propias
// velas con objetivo 20 y stop 60. No son inventados: si la pantalla los
// pinta mal, se nota.
const f = (session: string, n: number, aciertos: number, ticksPorOp: number,
           ambiguas: number, real: number, mediana: number) => ({
  session, n, aciertos,
  hitPct: n ? aciertos / n : null,
  ticksPorOp, usdPorOp: Number((ticksPorOp * 0.5).toFixed(2)),
  ambiguas, ambiguasPct: n ? ambiguas / n : null,
  sinResolver: 0, sinVelas: 0,
  realTicksPorOp: real, realMediana: mediana,
});

const scalper = {
  config: { target: 20, stop: 60, horizonMin: 180 },
  total: f('TOTAL', 573, 355, -10.4, 37, -4.0, -26.0),
  porSesion: [
    f('OUTSIDE', 193, 124, -8.6, 8, -2.5, -24),
    f('ASIA', 184, 123, -6.5, 5, -6.2, -28),
    f('NY_AM', 96, 40, -26.7, 20, -0.6, -20),
    f('NY_LUNCH', 53, 37, -4.2, 0, -10.1, -30),
    f('NY_PM', 43, 27, -9.8, 4, -3.7, -22),
    f('LONDON', 4, 4, 20.0, 0, 18.0, 18),
  ],
  barrido: [
    [5, 0.716, -13.5, 0.122], [10, 0.682, -12.2, 0.103], [15, 0.646, -11.6, 0.077],
    [20, 0.620, -10.4, 0.065], [25, 0.583, -10.5, 0.051], [30, 0.551, -10.4, 0.044],
    [35, 0.520, -10.6, 0.037], [40, 0.490, -11.0, 0.033], [45, 0.466, -11.1, 0.024],
    [50, 0.452, -10.3, 0.019], [55, 0.433, -10.2, 0.019], [60, 0.408, -11.0, 0.017],
    [80, 0.351, -10.9, 0.009], [100, 0.314, -9.7, 0.005],
  ].map(([target, hitPct, ticksPorOp, ambiguasPct]) => ({ target, hitPct, ticksPorOp, ambiguasPct })),
};

// -------------------------------------------------------------- operaciones

const base = (id: number, extra: Record<string, unknown>) => ({
  id, symbol: 'MNQZ26', max_quantity: 2, entry_price: 28744.5, exit_price: 28683.5,
  tickValue: 0.5, points: null, review: { operationId: id, flags: [], decisionAlerts: 0 },
  note: '', tags: [], ...extra,
});

const items = [
  base(1, { direction: 'SHORT', opened_at: Date.parse('2026-10-30T14:11:23Z'),
            closed_at: Date.parse('2026-10-30T14:15:04Z'), duration_sec: 221,
            session: 'NY_AM', netPnl: 243, rawGrossPnl: 245, commission: 2, ticks: 122.5 }),
  base(2, { direction: 'LONG', opened_at: Date.parse('2026-10-29T13:30:00Z'),
            closed_at: Date.parse('2026-10-29T14:12:30Z'), duration_sec: 2550,
            session: 'LONDON', netPnl: -61, rawGrossPnl: -59, commission: 2, ticks: -61 }),
];

// Un replay minimo pero COMPLETO: sin el, el grafico, la franja de tendencia y
// el diagnostico no se montan, y justo lo que hay que comprobar es el ORDEN en
// que salen esos tres y las notas.
const velas = Array.from({ length: 120 }, (_, i) => {
  const base = 28700 + Math.sin(i / 7) * 40;
  return {
    ts: Date.parse('2026-10-30T13:30:00Z') + i * 60_000,
    o: base, h: base + 8, l: base - 8, c: base + (i % 3 === 0 ? 4 : -3),
  };
});

const replay = {
  operation: items[0],
  excursion: { mae: 34, mfe: 269, capture: 0.91, givenBack: 24, bars: 4 },
  narrative: { lines: ['Entraste a favor de la tendencia de 4h.'], takeaway: null },
  symbol: 'MNQZ26',
  bars: velas,
  fills: [
    { ts: Date.parse('2026-10-30T14:11:23Z'), price: 28744.5, quantity: 2, side: 1 },
    { ts: Date.parse('2026-10-30T14:15:04Z'), price: 28683.5, quantity: 2, side: 0 },
  ],
  sessions: [{ name: 'NY_AM', from: velas[0]!.ts, to: velas[119]!.ts, fullFrom: velas[0]!.ts, fullTo: velas[119]!.ts }],
  trend: { weekly: null, daily: null, h4: null },
  pattern: null,
  timeframe: 1,
  sessionStat: null,
  minutesIntoSession: 41,
  coverage: { before: 40, after: 76, found: 120, expected: 120, aroundEntry: 120, entryWindowMin: 60 },
};

/**
 * El informe periodico, calculado de verdad sobre sus 573 operaciones.
 *
 * Los datos viven en `informes.json` y no aqui porque son 100 KB generados:
 * dentro de este fichero lo volvian ilegible y convertian cualquier diff en
 * un muro. Se regeneran corriendo `informe()` contra la base.
 *
 * Van LAS CUATRO SEMANAS, indexadas por su LUNES, y cinco jornadas seguidas.
 * Dos cosas que costaron un rato y conviene dejar escritas:
 *
 *   - Con solo dos semanas, la segunda flecha caia en un ancla que no estaba
 *     aqui y parecia que el boton no hacia nada, con el dominio bien.
 *   - `prev` y `next` devuelven dias DISTINTOS de la misma semana -el ultimo
 *     hacia atras, el primero hacia delante-, asi que indexar por un dia
 *     suelto dejaba la mitad de los saltos sin ancla. Por eso el stub
 *     normaliza al lunes antes de buscar.
 *
 * Un banco de pruebas con huecos miente igual que un dato con huecos.
 */
const informes = informesJson as Record<string, unknown>;

/** El lunes de la semana de una fecha, igual que hace `report.ts`. */
function lunesDelBanco(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1)));
  return d.toISOString().slice(0, 10);
}

window.fetch = (async (url: string) => {
  const u = String(url);
  const ok = (d: unknown) => ({ ok: true, status: 200, json: async () => d });
  if (u.includes('/api/earnings')) return ok(earnings);
  if (u.includes('/api/calendar/agenda')) return ok({ now: ahora, agenda: economicos });
  if (u.includes('/api/global')) return ok(globalReport);
  if (u.includes('/api/scalper')) return ok(scalper);
  if (u.includes('/api/reaction')) return ok(reaccionMedida);
  if (u.includes('/api/alignment')) return ok(alineacion);
  // La APLICACION ENTERA, para ver el lateral y la cabecera. Es el unico
  // sitio donde se puede comprobar la maquetacion: los demas `?v=` montan un
  // panel suelto y el lateral no existe ahi.
  if (u.includes('/api/dashboard')) return ok(dashboardJson);
  if (u.includes('/api/status')) return ok({ autoIngest: true, lastIngest: { at: ahora } });
  if (u.includes('/api/today')) return ok({ state: 'sin-limite', date: '2026-10-30', netPnl: 262, operations: 18, contracts: 27, limit: 0, remaining: null });
  if (u.includes('/api/report')) {
    const periodo = u.includes('periodo=semanal') ? 'semanal' : 'diario';
    const ancla = /ancla=(\d{4}-\d{2}-\d{2})/.exec(u)?.[1] ?? '';
    const clave = `${periodo}|${ancla && periodo === 'semanal' ? lunesDelBanco(ancla) : ancla}`;
    if (ancla && !(clave in informes)) console.warn(`[banco] falta el informe ${clave}, sirvo el ultimo`);
    return ok(informes[clave] ?? informes[`${periodo}|`]);
  }
  if (u.includes('/replay')) return ok(replay);
  if (u.includes('/reading')) return ok({ lines: [] });
  if (u.includes('/notes')) return ok({ operationId: 1, note: 'la mecha de las 10:05 no la vi venir', tags: ['scalper'] });
  if (u.includes('/api/tags')) return ok({ impact: [], all: ['scalper', 'impulsivo', 'dentro del plan'] });
  if (u.includes('/api/operations?'))
    return ok({ items, total: 2, page: 1, pageSize: 15, totalPages: 1, tags: ['scalper', 'impulsivo'], days: dias });
  return ok({});
}) as unknown as typeof fetch;

const prefs = {
  timeframe: 'm1', candles: 500,
  emas: [
    { period: 8, color: '#3fbf6f', on: true },
    { period: 21, color: '#5aaaff', on: true },
    { period: 55, color: '#f1c40f', on: true },
    { period: 200, color: '#e03e3e', on: true },
  ],
  beforeShare: 0.5, entryShare: 0.45, rightOffset: 6, marginTop: 0.12, deltaShare: 0.22,
  showSessions: true,
  noteTags: ['scalper', 'impulsivo', 'dentro del plan'],
  tagPolarity: { impulsivo: 'mala', 'dentro del plan': 'buena' },
  tagKind: { scalper: 'estrategia' },
} as never;

/**
 * El informe de drawdown por franja, calculado de verdad sobre sus 573 operaciones
 * y pegado aqui tal cual. No es inventado: es lo que devuelve
 * `sessionDrawdown()` con la base del 30 de octubre. Asi la comprobacion de
 * pantalla mira los casos que de verdad se dan — celdas sin muestra, celdas
 * sin cruce, y la tabla de huecos con el de 11:00 en rojo.
 */
const drawdown = {
  "rows": [
    {
      "session": "ASIA",
      "days": 12,
      "trades": 184,
      "total": 24.5,
      "perTrade": 0.13,
      "drawdownMedian": 132.25,
      "drawdownP75": 222.5,
      "drawdownWorst": 2192,
      "drawdownWorstDay": "2026-10-29",
      "chainedDrawdown": 2508,
      "greenDays": 6,
      "worstStreak": 13,
      "overLimit": null
    },
    {
      "session": "LONDON",
      "days": 2,
      "trades": 4,
      "total": 36,
      "perTrade": 9,
      "drawdownMedian": 0.75,
      "drawdownP75": 1.5,
      "drawdownWorst": 1.5,
      "drawdownWorstDay": "2026-10-05",
      "chainedDrawdown": 1.5,
      "greenDays": 1,
      "worstStreak": 1,
      "overLimit": null
    },
    {
      "session": "NY_AM",
      "days": 14,
      "trades": 96,
      "total": -194.5,
      "perTrade": -2.03,
      "drawdownMedian": 80.75,
      "drawdownP75": 214,
      "drawdownWorst": 786.5,
      "drawdownWorstDay": "2026-10-15",
      "chainedDrawdown": 1119.5,
      "greenDays": 8,
      "worstStreak": 8,
      "overLimit": null
    },
    {
      "session": "NY_LUNCH",
      "days": 11,
      "trades": 53,
      "total": -260,
      "perTrade": -4.91,
      "drawdownMedian": 68,
      "drawdownP75": 154.5,
      "drawdownWorst": 761.5,
      "drawdownWorstDay": "2026-10-09",
      "chainedDrawdown": 816.5,
      "greenDays": 5,
      "worstStreak": 7,
      "overLimit": null
    },
    {
      "session": "NY_PM",
      "days": 7,
      "trades": 43,
      "total": -81.5,
      "perTrade": -1.9,
      "drawdownMedian": 85.5,
      "drawdownP75": 294.5,
      "drawdownWorst": 374,
      "drawdownWorstDay": "2026-10-28",
      "chainedDrawdown": 750.5,
      "greenDays": 3,
      "worstStreak": 6,
      "overLimit": null
    },
    {
      "session": "OUTSIDE",
      "days": 16,
      "trades": 193,
      "total": 633,
      "perTrade": 3.28,
      "drawdownMedian": 166,
      "drawdownP75": 224.5,
      "drawdownWorst": 650.5,
      "drawdownWorstDay": "2026-10-14",
      "chainedDrawdown": 824.5,
      "greenDays": 9,
      "worstStreak": 10,
      "overLimit": null
    }
  ],
  "gaps": [
    {
      "from": 0,
      "to": 2,
      "label": "tras cerrar Asia",
      "days": 7,
      "trades": 37,
      "total": 502,
      "perTrade": 13.57,
      "drawdownWorst": 236,
      "greenDays": 4
    },
    {
      "from": 5,
      "to": 9.5,
      "label": "entre Londres y NY AM",
      "days": 6,
      "trades": 27,
      "total": 141,
      "perTrade": 5.22,
      "drawdownWorst": 170.5,
      "greenDays": 5
    },
    {
      "from": 11,
      "to": 12,
      "label": "entre NY AM y el almuerzo",
      "days": 11,
      "trades": 50,
      "total": -501,
      "perTrade": -10.02,
      "drawdownWorst": 358,
      "greenDays": 3
    },
    {
      "from": 13,
      "to": 13.5,
      "label": "entre el almuerzo y NY PM",
      "days": 10,
      "trades": 30,
      "total": 77.5,
      "perTrade": 2.58,
      "drawdownWorst": 292.5,
      "greenDays": 4
    },
    {
      "from": 16,
      "to": 20,
      "label": "entre NY PM y Asia",
      "days": 9,
      "trades": 49,
      "total": 413.5,
      "perTrade": 8.44,
      "drawdownWorst": 184,
      "greenDays": 8
    }
  ],
  "thresholds": [
    25,
    50,
    75,
    100,
    150,
    200,
    300
  ],
  "cells": [
    {
      "session": "ASIA",
      "threshold": 25,
      "days": 11,
      "daysWithRest": 11,
      "tradesAfter": 155,
      "perTradeAfter": 1.73,
      "baseline": 0.13,
      "diff": 1.6,
      "medianAfter": 17,
      "p": 0.7156,
      "survives": false,
      "enough": true
    },
    {
      "session": "ASIA",
      "threshold": 50,
      "days": 10,
      "daysWithRest": 10,
      "tradesAfter": 135,
      "perTradeAfter": 3.1,
      "baseline": 0.13,
      "diff": 2.97,
      "medianAfter": 19.75,
      "p": 0.8286,
      "survives": false,
      "enough": true
    },
    {
      "session": "ASIA",
      "threshold": 75,
      "days": 9,
      "daysWithRest": 8,
      "tradesAfter": 118,
      "perTradeAfter": 4.88,
      "baseline": 0.13,
      "diff": 4.74,
      "medianAfter": 63.25,
      "p": 0.8471,
      "survives": false,
      "enough": true
    },
    {
      "session": "ASIA",
      "threshold": 100,
      "days": 7,
      "daysWithRest": 7,
      "tradesAfter": 109,
      "perTradeAfter": 6.5,
      "baseline": 0.13,
      "diff": 6.37,
      "medianAfter": 81,
      "p": 0.7836,
      "survives": false,
      "enough": true
    },
    {
      "session": "ASIA",
      "threshold": 150,
      "days": 5,
      "daysWithRest": 5,
      "tradesAfter": 70,
      "perTradeAfter": 10.16,
      "baseline": 0.13,
      "diff": 10.03,
      "medianAfter": 131,
      "p": 0.7161,
      "survives": false,
      "enough": true
    },
    {
      "session": "ASIA",
      "threshold": 200,
      "days": 4,
      "daysWithRest": 4,
      "tradesAfter": 53,
      "perTradeAfter": 17.49,
      "baseline": 0.13,
      "diff": 17.36,
      "medianAfter": 239.5,
      "p": 0.6937,
      "survives": false,
      "enough": true
    },
    {
      "session": "ASIA",
      "threshold": 300,
      "days": 2,
      "daysWithRest": 2,
      "tradesAfter": 21,
      "perTradeAfter": 35.33,
      "baseline": 0.13,
      "diff": 35.2,
      "medianAfter": 371,
      "p": 0.674,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_AM",
      "threshold": 25,
      "days": 10,
      "daysWithRest": 9,
      "tradesAfter": 75,
      "perTradeAfter": -1.7,
      "baseline": -2.03,
      "diff": 0.33,
      "medianAfter": 7,
      "p": 0.9895,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_AM",
      "threshold": 50,
      "days": 9,
      "daysWithRest": 7,
      "tradesAfter": 67,
      "perTradeAfter": -0.71,
      "baseline": -2.03,
      "diff": 1.32,
      "medianAfter": 44.5,
      "p": 0.969,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_AM",
      "threshold": 75,
      "days": 7,
      "daysWithRest": 7,
      "tradesAfter": 58,
      "perTradeAfter": -0.8,
      "baseline": -2.03,
      "diff": 1.22,
      "medianAfter": 44.5,
      "p": 0.9315,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_AM",
      "threshold": 100,
      "days": 6,
      "daysWithRest": 6,
      "tradesAfter": 48,
      "perTradeAfter": -3.11,
      "baseline": -2.03,
      "diff": -1.09,
      "medianAfter": 21.5,
      "p": 0.8031,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_AM",
      "threshold": 150,
      "days": 6,
      "daysWithRest": 6,
      "tradesAfter": 39,
      "perTradeAfter": 4.12,
      "baseline": -2.03,
      "diff": 6.14,
      "medianAfter": 69.25,
      "p": 0.974,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_AM",
      "threshold": 200,
      "days": 4,
      "daysWithRest": 4,
      "tradesAfter": 31,
      "perTradeAfter": -4.63,
      "baseline": -2.03,
      "diff": -2.6,
      "medianAfter": 29.25,
      "p": 0.8546,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_AM",
      "threshold": 300,
      "days": 1,
      "daysWithRest": 1,
      "tradesAfter": 13,
      "perTradeAfter": -30.31,
      "baseline": -2.03,
      "diff": -28.28,
      "medianAfter": -394,
      "p": 0.1798,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_LUNCH",
      "threshold": 25,
      "days": 9,
      "daysWithRest": 7,
      "tradesAfter": 38,
      "perTradeAfter": 1.53,
      "baseline": -4.91,
      "diff": 6.43,
      "medianAfter": -27,
      "p": 0.8361,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_LUNCH",
      "threshold": 50,
      "days": 7,
      "daysWithRest": 7,
      "tradesAfter": 33,
      "perTradeAfter": 5.11,
      "baseline": -4.91,
      "diff": 10.01,
      "medianAfter": 5,
      "p": 0.9175,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_LUNCH",
      "threshold": 75,
      "days": 5,
      "daysWithRest": 5,
      "tradesAfter": 24,
      "perTradeAfter": 0.92,
      "baseline": -4.91,
      "diff": 5.82,
      "medianAfter": 10,
      "p": 0.6653,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_LUNCH",
      "threshold": 100,
      "days": 5,
      "daysWithRest": 5,
      "tradesAfter": 22,
      "perTradeAfter": 2.45,
      "baseline": -4.91,
      "diff": 7.36,
      "medianAfter": 18,
      "p": 0.6748,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_LUNCH",
      "threshold": 150,
      "days": 3,
      "daysWithRest": 3,
      "tradesAfter": 11,
      "perTradeAfter": -43.23,
      "baseline": -4.91,
      "diff": -38.32,
      "medianAfter": -61.5,
      "p": 0.4012,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_LUNCH",
      "threshold": 200,
      "days": 2,
      "daysWithRest": 2,
      "tradesAfter": 6,
      "perTradeAfter": -48.5,
      "baseline": -4.91,
      "diff": -43.59,
      "medianAfter": -145.5,
      "p": null,
      "survives": false,
      "enough": false
    },
    {
      "session": "NY_LUNCH",
      "threshold": 300,
      "days": 2,
      "daysWithRest": 2,
      "tradesAfter": 4,
      "perTradeAfter": -43.38,
      "baseline": -4.91,
      "diff": -38.47,
      "medianAfter": -86.75,
      "p": null,
      "survives": false,
      "enough": false
    },
    {
      "session": "NY_PM",
      "threshold": 25,
      "days": 6,
      "daysWithRest": 5,
      "tradesAfter": 23,
      "perTradeAfter": 9.11,
      "baseline": -1.9,
      "diff": 11,
      "medianAfter": 0,
      "p": 0.6462,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_PM",
      "threshold": 50,
      "days": 4,
      "daysWithRest": 2,
      "tradesAfter": 17,
      "perTradeAfter": -16.88,
      "baseline": -1.9,
      "diff": -14.99,
      "medianAfter": -143.5,
      "p": 0.1564,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_PM",
      "threshold": 75,
      "days": 4,
      "daysWithRest": 2,
      "tradesAfter": 13,
      "perTradeAfter": -16.73,
      "baseline": -1.9,
      "diff": -14.84,
      "medianAfter": -108.75,
      "p": 0.1854,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_PM",
      "threshold": 100,
      "days": 3,
      "daysWithRest": 2,
      "tradesAfter": 13,
      "perTradeAfter": -16.73,
      "baseline": -1.9,
      "diff": -14.84,
      "medianAfter": -108.75,
      "p": 0.2035,
      "survives": false,
      "enough": true
    },
    {
      "session": "NY_PM",
      "threshold": 150,
      "days": 2,
      "daysWithRest": 1,
      "tradesAfter": 8,
      "perTradeAfter": -26.19,
      "baseline": -1.9,
      "diff": -24.29,
      "medianAfter": -209.5,
      "p": null,
      "survives": false,
      "enough": false
    },
    {
      "session": "NY_PM",
      "threshold": 200,
      "days": 2,
      "daysWithRest": 1,
      "tradesAfter": 5,
      "perTradeAfter": -29.6,
      "baseline": -1.9,
      "diff": -27.7,
      "medianAfter": -148,
      "p": null,
      "survives": false,
      "enough": false
    },
    {
      "session": "NY_PM",
      "threshold": 300,
      "days": 1,
      "daysWithRest": 0,
      "tradesAfter": 0,
      "perTradeAfter": null,
      "baseline": -1.9,
      "diff": null,
      "medianAfter": null,
      "p": null,
      "survives": false,
      "enough": false
    },
    {
      "session": "OUTSIDE",
      "threshold": 25,
      "days": 16,
      "daysWithRest": 15,
      "tradesAfter": 150,
      "perTradeAfter": 5.92,
      "baseline": 3.28,
      "diff": 2.64,
      "medianAfter": -37,
      "p": 0.5942,
      "survives": false,
      "enough": true
    },
    {
      "session": "OUTSIDE",
      "threshold": 50,
      "days": 16,
      "daysWithRest": 14,
      "tradesAfter": 97,
      "perTradeAfter": -4.15,
      "baseline": 3.28,
      "diff": -7.43,
      "medianAfter": -20,
      "p": 0.013,
      "survives": false,
      "enough": true
    },
    {
      "session": "OUTSIDE",
      "threshold": 75,
      "days": 13,
      "daysWithRest": 12,
      "tradesAfter": 74,
      "perTradeAfter": 1.77,
      "baseline": 3.28,
      "diff": -1.51,
      "medianAfter": 4.75,
      "p": 0.1969,
      "survives": false,
      "enough": true
    },
    {
      "session": "OUTSIDE",
      "threshold": 100,
      "days": 11,
      "daysWithRest": 10,
      "tradesAfter": 69,
      "perTradeAfter": 5.46,
      "baseline": 3.28,
      "diff": 2.18,
      "medianAfter": 20.5,
      "p": 0.5272,
      "survives": false,
      "enough": true
    },
    {
      "session": "OUTSIDE",
      "threshold": 150,
      "days": 9,
      "daysWithRest": 8,
      "tradesAfter": 47,
      "perTradeAfter": 17.13,
      "baseline": 3.28,
      "diff": 13.85,
      "medianAfter": 90.25,
      "p": 0.9815,
      "survives": false,
      "enough": true
    },
    {
      "session": "OUTSIDE",
      "threshold": 200,
      "days": 5,
      "daysWithRest": 5,
      "tradesAfter": 24,
      "perTradeAfter": 5.27,
      "baseline": 3.28,
      "diff": 1.99,
      "medianAfter": 13,
      "p": 0.4257,
      "survives": false,
      "enough": true
    },
    {
      "session": "OUTSIDE",
      "threshold": 300,
      "days": 3,
      "daysWithRest": 3,
      "tradesAfter": 15,
      "perTradeAfter": 17.5,
      "baseline": 3.28,
      "diff": 14.22,
      "medianAfter": 36,
      "p": 0.4159,
      "survives": false,
      "enough": true
    }
  ],
  "permutations": 2000,
  "minTradesAfter": 10,
  "tested": 30,
  "survivors": 0,
  "fdr": 0.1,
  "dailyLossLimit": 0
} as unknown as Parameters<typeof SessionDrawdownPanel>[0]['data'];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="wrap">
      {vista === 'resultados' && (
        <>
          <div className="filters">
            <label>Desde <input type="date" /></label>
            <span className="live"><b>en vivo</b> · sin novedades aun</span>
          </div>
          <EarningsStrip />
        </>
      )}

      {vista === 'calendario' && (
        <div style={{ width: 320 }}>
          <DayCalendar days={dias} selected={['2026-10-30']} onToggle={() => {}} onClear={() => {}} />
        </div>
      )}

      {vista === 'operaciones' && <Operations filters={{}} offsetHours={-4} prefs={prefs} />}

      {vista === 'news' && <GlobalPanel />}

      {vista === 'scalper' && <ScalperPanel filters={{}} />}

      {vista === 'alineacion' && <AlignmentPanel filters={{}} />}

      {vista === 'app' && <App />}

      {vista === 'globo' && (
        <>
          {/* El hueco es el caso: el grafico tiene que quedar pegado al borde
              de abajo, que es donde el globo no cabia debajo del cursor. */}
          <div style={{ height: '78vh' }} className="note">
            Espacio a proposito: el grafico de abajo esta donde estaba el fallo.
          </div>
          <div className="panel">
            <h2>P&amp;L por fecha</h2>
            <BarsChart
              rows={[
                {
                  "key": "2026-10-27",
                  "summary": {
                    "operations": 62,
                    "wins": 27,
                    "losses": 35,
                    "winRate": 0.4355,
                    "longs": 31,
                    "shorts": 31,
                    "grossPnl": 405.0,
                    "avgWin": 40.0,
                    "avgLoss": -30.0,
                    "payoff": 1.33,
                    "breakevenPayoff": 1.0,
                    "expectancy": 6.53,
                    "avgWinMinutes": 3.1,
                    "avgLossMinutes": 2.4
                  }
                },
                {
                  "key": "2026-10-28",
                  "summary": {
                    "operations": 55,
                    "wins": 19,
                    "losses": 36,
                    "winRate": 0.3455,
                    "longs": 27,
                    "shorts": 28,
                    "grossPnl": -747.5,
                    "avgWin": 40.0,
                    "avgLoss": -30.0,
                    "payoff": 1.33,
                    "breakevenPayoff": 1.0,
                    "expectancy": -13.59,
                    "avgWinMinutes": 3.1,
                    "avgLossMinutes": 2.4
                  }
                },
                {
                  "key": "2026-10-29",
                  "summary": {
                    "operations": 41,
                    "wins": 17,
                    "losses": 24,
                    "winRate": 0.4146,
                    "longs": 20,
                    "shorts": 21,
                    "grossPnl": 788.0,
                    "avgWin": 40.0,
                    "avgLoss": -30.0,
                    "payoff": 1.33,
                    "breakevenPayoff": 1.0,
                    "expectancy": 19.22,
                    "avgWinMinutes": 3.1,
                    "avgLossMinutes": 2.4
                  }
                },
                {
                  "key": "2026-10-30",
                  "summary": {
                    "operations": 18,
                    "wins": 11,
                    "losses": 7,
                    "winRate": 0.6111,
                    "longs": 9,
                    "shorts": 9,
                    "grossPnl": 288.5,
                    "avgWin": 40.0,
                    "avgLoss": -30.0,
                    "payoff": 1.33,
                    "breakevenPayoff": 1.0,
                    "expectancy": 16.03,
                    "avgWinMinutes": 3.1,
                    "avgLossMinutes": 2.4
                  }
                }
              ] as never}
              label={(k) => String(k).slice(8) + '/' + String(k).slice(5, 7)}
            />
          </div>
        </>
      )}

      {vista === 'informe' && <ReportPanel query="" />}

      {vista === 'drawdown' && <SessionDrawdownPanel data={drawdown} />}

      {vista === 'curva' && (
        <div className="panel">
          <h2>Curva de capital (bruta)</h2>
          <EquityChart points={curva} />
        </div>
      )}
    </div>
  </StrictMode>,
);
