import { NEWS_BLACKOUT_AFTER_MIN, NEWS_BLACKOUT_BEFORE_MIN } from '../config.js';
import { db } from '../db/index.js';
import { marketDate } from './sessions.js';

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

  // Lo que anade el JSON de Investing y un ICS no puede dar. La prevision es
  // la pieza que faltaba: el precio no reacciona al dato, reacciona a la
  // diferencia entre el dato y lo que se esperaba.
  forecast: number | null;
  previous: number | null;
  actual: number | null;
  unit: string | null;
  precision_digits: number | null;
  /** 1 si es una lectura preliminar, que luego se revisa. */
  preliminary: number | null;
  reference_period: string | null;
  previous_revised_from: number | null;
  /** 'positive' | 'negative' si revisaron el dato anterior. */
  revision: string | null;
  event_key: string | null;
}

export interface MarketHoliday {
  id: string;
  exchange: string;
  name: string;
  /** YYYY-MM-DD en hora de mercado. */
  day: string;
  from_ts: number;
  to_ts: number;
  /** 1 = cerrado todo el dia. 0 = media sesion. */
  full_day: number;
  source: string | null;
}

/**
 * Festivos y medias sesiones que aun no han pasado.
 *
 * Las medias sesiones son la parte util de verdad: el mercado abre, asi que
 * nada te impide operar, pero la liquidez se desploma a partir del cierre
 * anticipado. Una operacion de las dos de la tarde de un 24 de diciembre no se
 * puede comparar con una de un martes cualquiera, y sin esta tabla el diario
 * las mezclaba sin decir nada.
 */
export function upcomingHolidays(limit = 12): MarketHoliday[] {
  return db()
    .prepare(
      `SELECT * FROM market_holidays
        WHERE to_ts >= ?
        GROUP BY day, full_day
        ORDER BY from_ts
        LIMIT ?`,
    )
    .all(Date.now(), limit) as MarketHoliday[];
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

export interface EventQuery {
  /** Texto libre sobre el titulo. */
  q?: string;
  /** 'high' | 'medium' | 'low'. Vacio = todos. */
  impact?: string;
  /** Fechas YYYY-MM-DD, inclusive, en hora de mercado. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  /** Incluir los eventos que ya han ocurrido. Por defecto no. */
  includePast?: boolean;
}

export interface EventPage {
  items: EconomicEvent[];
  total: number;
  page: number;
  pages: number;
  /** Cuantos eventos hay en total sin filtrar, para saber si el filtro vacio algo. */
  grandTotal: number;
}

/**
 * Busqueda sobre el calendario entero.
 *
 * Hasta ahora la pantalla solo recibia los ocho proximos eventos, asi que no
 * habia nada que filtrar: con doscientos importados y meses por delante, hace
 * falta poder buscar "CPI" o quedarse solo con los de impacto alto.
 *
 * El filtro de fechas va sobre la hora de MERCADO y no sobre UTC, igual que el
 * resto del diario: un dato de las 20:00 de Nueva York pertenece a ese dia, no
 * al siguiente.
 */
export function searchEvents(query: EventQuery = {}): EventPage {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.q) {
    // LIKE con comodines a los dos lados. Es suficiente para doscientas filas y
    // evita montar un indice de texto completo para buscar "NFP".
    where.push('LOWER(title) LIKE ?');
    params.push(`%${query.q.toLowerCase()}%`);
  }

  if (query.impact) {
    where.push('impact = ?');
    params.push(query.impact);
  }

  const rows = db()
    .prepare(
      `SELECT * FROM economic_events
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY ts`,
    )
    .all(...params) as EconomicEvent[];

  // Por defecto, fuera lo que ya paso.
  //
  // Un calendario economico solo sirve para lo que viene: un dato de hace tres
  // semanas no cambia ninguna decision, y con un ano entero cargado lo pasado
  // tapa lo que importa. El interruptor existe porque para revisar una
  // operacion vieja si hace falta saber que habia ese dia.
  const ahora = Date.now();

  const filtered = rows.filter((e) => {
    if (!query.includePast && e.ts < ahora) return false;

    const d = marketDate(e.ts);
    if (query.from && d < query.from) return false;
    if (query.to && d > query.to) return false;
    return true;
  });

  const pageSize = Math.min(200, Math.max(5, query.pageSize ?? 25));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), pages);

  const grandTotal = (
    db().prepare('SELECT COUNT(*) AS n FROM economic_events').get() as { n: number }
  ).n;

  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pages,
    grandTotal,
  };
}

/**
 * Vacia el calendario entero.
 *
 * Es seguro: los eventos se vuelven a importar de los ficheros .ics o .csv, que
 * siguen en su carpeta. Existe porque importar dos ficheros con el mismo evento
 * escrito en zonas distintas deja pares duplicados separados por una hora, y
 * entonces la ventana de silencio salta dos veces y una de ellas a destiempo.
 * Limpiar y reimportar un solo fichero es mas rapido que cazar los duplicados.
 */
export function clearEvents(): { deleted: number } {
  const info = db().prepare('DELETE FROM economic_events').run();
  return { deleted: info.changes };
}
