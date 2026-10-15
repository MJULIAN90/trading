import { NEWS_BLACKOUT_AFTER_MIN, NEWS_BLACKOUT_BEFORE_MIN } from '../config.js';
import { db } from '../db/index.js';

/**
 * Consulta del calendario economico y la ventana de silencio alrededor de cada
 * evento.
 *
 * La ventana no es simetrica por defecto: antes del dato el libro se vacia y los
 * diferenciales se abren, y despues llega el movimiento de verdad. Son dos
 * problemas distintos y no tienen por que durar lo mismo.
 */

export interface EconomicEvent {
  id: string;
  ts: number;
  title: string;
  impact: string | null;
  currency: string | null;
  source: string | null;
  detail: string | null;
}

export interface Blackout {
  event: EconomicEvent;
  /** Minutos hasta el evento. Negativo si ya paso. */
  minutesTo: number;
}

export function eventsBetween(from: number, to: number, onlyHigh = false): EconomicEvent[] {
  const where = ['ts BETWEEN ? AND ?'];
  const params: unknown[] = [from, to];

  if (onlyHigh) {
    where.push("impact = 'high'");
  }

  return db()
    .prepare(`SELECT * FROM economic_events WHERE ${where.join(' AND ')} ORDER BY ts`)
    .all(...params) as EconomicEvent[];
}

/** Los proximos eventos a partir de ahora. */
export function upcoming(limit = 10, from: number = Date.now()): EconomicEvent[] {
  return db()
    .prepare('SELECT * FROM economic_events WHERE ts >= ? ORDER BY ts LIMIT ?')
    .all(from, limit) as EconomicEvent[];
}

/**
 * Eventos cuya ventana de silencio cubre ese instante.
 *
 * Sirve para dos cosas distintas con el mismo codigo: avisar en vivo de que no
 * toca operar, y marcar despues las operaciones que se abrieron dentro de una.
 */
export function blackoutAt(
  ts: number,
  options: { onlyHigh?: boolean; beforeMin?: number; afterMin?: number } = {},
): Blackout[] {
  const before = options.beforeMin ?? NEWS_BLACKOUT_BEFORE_MIN;
  const after = options.afterMin ?? NEWS_BLACKOUT_AFTER_MIN;

  const rows = eventsBetween(ts - after * 60_000, ts + before * 60_000, options.onlyHigh ?? false);

  return rows.map((event) => ({
    event,
    minutesTo: Math.round((event.ts - ts) / 60_000),
  }));
}

export interface CalendarStatus {
  /** Cuantos eventos hay guardados en total. */
  total: number;
  /** Hasta que fecha llega el calendario importado. */
  coverTo: number | null;
  upcoming: EconomicEvent[];
  /** Ventana de silencio activa AHORA, si la hay. */
  activeNow: Blackout[];
  blackout: { beforeMin: number; afterMin: number };
}

export function calendarStatus(now: number = Date.now()): CalendarStatus {
  const row = db()
    .prepare('SELECT COUNT(*) AS n, MAX(ts) AS last FROM economic_events')
    .get() as { n: number; last: number | null };

  return {
    total: row.n,
    coverTo: row.last,
    upcoming: upcoming(8, now),
    activeNow: blackoutAt(now, { onlyHigh: true }),
    blackout: { beforeMin: NEWS_BLACKOUT_BEFORE_MIN, afterMin: NEWS_BLACKOUT_AFTER_MIN },
  };
}

/**
 * Cuanto costaron las operaciones abiertas dentro de una ventana de noticia.
 *
 * Es la unica forma de saber si la regla "no operar con noticia" te aplica a TI:
 * puede que te cueste dinero, puede que no. Sin medirlo es una norma prestada.
 */
export function newsImpact(ops: Array<{ id: number; opened_at: number; gross_pnl: number }>) {
  const inside: number[] = [];
  const outside: number[] = [];

  for (const op of ops) {
    const hits = blackoutAt(op.opened_at, { onlyHigh: true });
    (hits.length > 0 ? inside : outside).push(op.gross_pnl);
  }

  const sum = (xs: number[]) => Number(xs.reduce((a, b) => a + b, 0).toFixed(2));
  const median = (xs: number[]) => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    return Number(s[Math.floor(s.length / 2)]!.toFixed(2));
  };

  return {
    inside: { count: inside.length, pnl: sum(inside), median: median(inside) },
    outside: { count: outside.length, pnl: sum(outside), median: median(outside) },
  };
}
