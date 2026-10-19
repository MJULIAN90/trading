import { db } from '../db/index.js';
import { marketDate, marketHour } from './sessions.js';

export interface Operation {
  id: number;
  symbol: string;
  opened_at: number;
  closed_at: number;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  exit_price: number;
  max_quantity: number;
  fills_count: number;
  gross_pnl: number;
  duration_sec: number;
  session: string;
  market_hour: number;
  is_real: number;
  account_id: string | null;
}

export interface Filter {
  /**
   * Dejar fuera las operaciones marcadas como prueba por la fecha de corte.
   * Por defecto entran TODAS: quien separa ahora el material es el selector de
   * cuenta, que dice lo que dijo el broker en vez de una fecha elegida a mano.
   */
  excludeTests?: boolean;
  from?: string;
  to?: string;
  session?: string;
  /** Cuenta del broker. Vacio = todas. */
  account?: string;
}

export function listOperations(f: Filter = {}): Operation[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (f.excludeTests) where.push('is_real = 1');
  if (f.session) {
    where.push('session = ?');
    params.push(f.session);
  }
  if (f.account) {
    where.push('account_id = ?');
    params.push(f.account);
  }


  const rows = db()
    .prepare(
      `SELECT * FROM operations
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY opened_at ASC`,
    )
    .all(...params) as Operation[];

  // El filtro por fecha va sobre la fecha de MERCADO, no la del calendario UTC:
  // una sesion de Asia que arranca a las 20:00 de Nueva York pertenece al dia
  // de mercado siguiente, y filtrar por UTC la partiria en dos.
  return rows.filter((o) => {
    const d = marketDate(o.opened_at);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    return true;
  });
}

export interface Summary {
  operations: number;
  wins: number;
  losses: number;
  winRate: number;
  grossPnl: number;
  avgWin: number;
  avgLoss: number;
  payoff: number;
  /** Payoff minimo que haria rentable este win rate. Si payoff < este, se pierde. */
  breakevenPayoff: number;
  expectancy: number;
  best: number;
  worst: number;
  avgWinMinutes: number;
  avgLossMinutes: number;
}

export function summarize(ops: Operation[]): Summary {
  const wins = ops.filter((o) => o.gross_pnl > 0);
  const losses = ops.filter((o) => o.gross_pnl <= 0);
  const n = ops.length || 1;

  const avgWin = wins.length ? wins.reduce((a, o) => a + o.gross_pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, o) => a + o.gross_pnl, 0) / losses.length : 0;
  const winRate = wins.length / n;

  const mean = (xs: Operation[]) => (xs.length ? xs.reduce((a, o) => a + o.duration_sec, 0) / xs.length / 60 : 0);

  return {
    operations: ops.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    grossPnl: ops.reduce((a, o) => a + o.gross_pnl, 0),
    avgWin,
    avgLoss,
    payoff: avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0,
    breakevenPayoff: winRate > 0 && winRate < 1 ? (1 - winRate) / winRate : 0,
    expectancy: ops.length ? ops.reduce((a, o) => a + o.gross_pnl, 0) / ops.length : 0,
    best: ops.length ? Math.max(...ops.map((o) => o.gross_pnl)) : 0,
    worst: ops.length ? Math.min(...ops.map((o) => o.gross_pnl)) : 0,
    avgWinMinutes: mean(wins),
    avgLossMinutes: mean(losses),
  };
}

export function groupBy<K extends string | number>(
  ops: Operation[],
  key: (o: Operation) => K,
): Array<{ key: K; summary: Summary }> {
  const map = new Map<K, Operation[]>();
  for (const o of ops) {
    const k = key(o);
    const list = map.get(k);
    if (list) list.push(o);
    else map.set(k, [o]);
  }
  return [...map.entries()].map(([k, list]) => ({ key: k, summary: summarize(list) }));
}

export function bySession(ops: Operation[]) {
  return groupBy(ops, (o) => o.session).sort((a, b) => a.summary.grossPnl - b.summary.grossPnl);
}

export function byDay(ops: Operation[]) {
  return groupBy(ops, (o) => marketDate(o.opened_at)).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

/**
 * Por dia de la SEMANA, no por fecha.
 *
 * `byDay` ya agrupa por fecha, que sirve para repasar una jornada concreta
 * pero no para ver un habito: con 128 operaciones repartidas en 7 fechas no
 * hay nada que comparar. Agrupando por lunes, martes... se ve si hay un dia
 * que sistematicamente va peor, igual que `byHour` enseña la hora mala.
 *
 * El dia se saca en HORA DE MERCADO, no en la del navegador: una operacion de
 * las once de la noche de un lunes en Colombia es martes en el grafico, y
 * contarla en el dia equivocado es justo el error que esta tabla buscaria.
 */
export function byWeekday(ops: Operation[]) {
  return groupBy(ops, (o) => {
    const d = marketDate(o.opened_at);
    // marketDate devuelve YYYY-MM-DD ya desplazado; se interpreta a mediodia
    // UTC para que ningun desfase lo mueva de dia al construir la fecha.
    const [y, m, day] = d.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 1, day!, 12)).getUTCDay();
  }).sort((a, b) => Number(a.key) - Number(b.key));
}

export function byHour(ops: Operation[]) {
  return groupBy(ops, (o) => Math.floor(marketHour(o.opened_at))).sort((a, b) => Number(a.key) - Number(b.key));
}

export function byDirection(ops: Operation[]) {
  return groupBy(ops, (o) => o.direction);
}

/** Curva de capital acumulada, en orden cronologico. */
export function equityCurve(ops: Operation[]) {
  let acc = 0;
  return ops.map((o) => {
    acc += o.gross_pnl;
    return { ts: o.closed_at, pnl: o.gross_pnl, equity: Number(acc.toFixed(2)) };
  });
}

export interface ReentryAnalysis {
  /** Minutos que se dejaron pasar desde el cierre de la operacion anterior. */
  gapMinutes: number | null;
  operation: Operation;
  afterLoss: boolean;
}

/**
 * Cuanto se espera entre una operacion y la siguiente, y si la anterior fue
 * perdedora. Reentrar a los pocos segundos de perder es una reaccion, no una
 * decision, y suele venir en rachas: por eso se mide aparte.
 */
export function reentries(ops: Operation[]): ReentryAnalysis[] {
  return ops.map((o, i) => {
    const prev = i > 0 ? ops[i - 1] : undefined;
    return {
      operation: o,
      gapMinutes: prev ? (o.opened_at - prev.closed_at) / 60_000 : null,
      afterLoss: prev ? prev.gross_pnl <= 0 : false,
    };
  });
}

/**
 * Compara las entradas rapidas tras una perdida contra todas las demas. Es la
 * pregunta concreta que dejaron los datos del 13 de octubre: ocho perdidas
 * seguidas en veintidos minutos, varias reentrando en menos de un minuto.
 */
export function revengeSplit(ops: Operation[], maxGapMinutes = 2) {
  const list = reentries(ops);
  const revenge = list.filter((r) => r.afterLoss && r.gapMinutes !== null && r.gapMinutes <= maxGapMinutes);
  const rest = list.filter((r) => !(r.afterLoss && r.gapMinutes !== null && r.gapMinutes <= maxGapMinutes));
  return {
    maxGapMinutes,
    revenge: summarize(revenge.map((r) => r.operation)),
    rest: summarize(rest.map((r) => r.operation)),
  };
}

/** Racha mas larga de perdidas y de ganancias consecutivas. */
export function streaks(ops: Operation[]) {
  let maxLoss = 0;
  let maxWin = 0;
  let curLoss = 0;
  let curWin = 0;

  for (const o of ops) {
    if (o.gross_pnl > 0) {
      curWin++;
      curLoss = 0;
    } else {
      curLoss++;
      curWin = 0;
    }
    maxWin = Math.max(maxWin, curWin);
    maxLoss = Math.max(maxLoss, curLoss);
  }

  return { maxWinStreak: maxWin, maxLossStreak: maxLoss };
}

export interface AccountInfo {
  id: string;
  operations: number;
  /** Primera y ultima operacion de la cuenta, en epoch ms. */
  from: number;
  to: number;
}

/**
 * Cuentas presentes en la base, para poder elegir una en el panel.
 *
 * Se listan SIEMPRE todas, tambien las que solo tienen operaciones marcadas
 * como prueba: si el selector escondiera una cuenta entera porque su fecha cae
 * antes del corte, no habria forma de llegar a ella para mirarla.
 */
export function accounts(): AccountInfo[] {
  return db()
    .prepare(
      `SELECT account_id AS id, COUNT(*) AS operations,
              MIN(opened_at) AS "from", MAX(opened_at) AS "to"
         FROM operations
        WHERE account_id IS NOT NULL
        GROUP BY account_id
        ORDER BY MAX(opened_at) DESC`,
    )
    .all() as AccountInfo[];
}
