import { db } from '../db/index.js';
import { normalizeSymbol } from './bars.js';
import { marketOffsetAt } from './clock.js';

/**
 * Tendencia de los marcos grandes en el momento de entrar: semanal, diaria y 4h.
 *
 * No se guarda nada nuevo. Las velas de un minuto ya estan en `bars`, asi que
 * los marcos grandes se arman agrupandolas al vuelo y se cachean en memoria.
 * Guardar la tendencia junto a cada operacion seria congelar una decision que
 * todavia puede cambiar: si manana se ajusta el umbral o el numero de velas,
 * una columna guardada mentiria y habria que recalcular 128 filas a mano.
 *
 * LIMITE IMPORTANTE, medido sobre los datos reales del 14/10/2026: las 94
 * operaciones reales caen TODAS en 4h bajista, asi que "a favor de la 4h" y
 * "corto" son hoy la misma columna. La tendencia no aporta informacion
 * todavia; empezara a aportarla cuando haya operaciones en regimenes
 * distintos. Por eso se ensena el dato y no se saca ninguna conclusion de el.
 */

export type TrendLabel = 'ALCISTA' | 'BAJISTA' | 'RANGO';

export interface TrendRead {
  label: TrendLabel;
  /** 'clara' o 'debil' cuando hay direccion; null en rango. */
  strength: 'clara' | 'debil' | null;
  /** Avance neto dividido por el rango recorrido, de -1 a 1. */
  ratio: number;
  /** Donde cerro dentro del rango del periodo: 0 en el minimo, 1 en el maximo. */
  position: number;
  high: number;
  low: number;
  candles: number;
  /** Primera y ultima vela usadas, para poder comprobarlo en el grafico. */
  from: number;
  to: number;
}

export interface TrendSnapshot {
  weekly: TrendRead | null;
  daily: TrendRead | null;
  h4: TrendRead | null;
}

interface Candle {
  ts: number;
  end: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/**
 * Cuantas velas cerradas se miran en cada marco.
 *
 * Un mes de diarias, una semana de 4h y un mes de semanales. La semanal usa
 * solo 4 porque con el historico que hay (100 dias) no existen mas: pedir 10
 * dejaria la columna vacia en vez de dar una respuesta pobre pero honesta.
 */
const LOOKBACK = { weekly: 4, daily: 20, h4: 30 } as const;

/**
 * Umbrales del cociente avance/rango, sacados de las velas de MNQ, no de un
 * libro.
 *
 * Sobre 100 dias de MNQ el |cociente| tiene mediana 0,45 y cuartiles 0,26 y
 * 0,70. Un paseo aleatorio de la misma longitud da mediana 0,55: es decir, MNQ
 * es MENOS direccional que el puro azar en estos horizontes, que es otra forma
 * de decir que pasa mucho tiempo en rango. Por eso el corte de rango esta en
 * 0,30 (el cuartil bajo de su propia historia) y el de tendencia clara en 0,60.
 */
const RANGE_MAX = 0.3;
const CLEAR_MIN = 0.6;

/** Hora de mercado desplazada para que el dia empiece a las 18:00, como en CME. */
function sessionClock(ts: number): Date {
  return new Date(ts + marketOffsetAt(ts) * 3600_000 + 6 * 3600_000);
}

/**
 * El dia de futuros no es el dia natural: MNQ abre a las 18:00 de Nueva York y
 * cierra a las 17:00 del dia siguiente, con una hora de parada. Las velas de
 * las 22:00 UTC pertenecen a la sesion del dia SIGUIENTE, y agruparlas por
 * fecha natural partiria cada dia en dos trozos sin sentido. Se comprobo en los
 * datos: la hora 21 UTC tiene 21 velas frente a las 3.000 de las demas, que es
 * exactamente la parada diaria.
 */
function dayKey(ts: number): string {
  return sessionClock(ts).toISOString().slice(0, 10);
}

function h4Key(ts: number): string {
  const d = sessionClock(ts);
  return `${d.toISOString().slice(0, 10)}#${Math.floor(d.getUTCHours() / 4)}`;
}

function weekKey(ts: number): string {
  const d = sessionClock(ts);
  // Semana anclada al domingo, que es cuando abre el futuro.
  const sunday = new Date(d.getTime() - d.getUTCDay() * 86_400_000);
  return sunday.toISOString().slice(0, 10);
}

function aggregate(rows: Candle[], key: (ts: number) => string): Candle[] {
  const out: Candle[] = [];
  let current: Candle | null = null;
  let currentKey = '';

  for (const r of rows) {
    const k = key(r.ts);
    if (k !== currentKey) {
      if (current) out.push(current);
      current = { ts: r.ts, end: r.ts, o: r.o, h: r.h, l: r.l, c: r.c };
      currentKey = k;
    } else if (current) {
      current.h = Math.max(current.h, r.h);
      current.l = Math.min(current.l, r.l);
      current.c = r.c;
      current.end = r.ts;
    }
  }

  if (current) out.push(current);
  return out;
}

interface Series {
  weekly: Candle[];
  daily: Candle[];
  h4: Candle[];
  stamp: string;
}

const cache = new Map<string, Series>();

function seriesFor(symbol: string): Series {
  const sym = normalizeSymbol(symbol);

  // La huella evita rearmar los marcos en cada peticion y, a la vez, evita
  // servir velas viejas cuando la ingesta ha anadido minutos nuevos.
  const stampRow = db()
    .prepare('SELECT COUNT(*) AS n, MAX(ts) AS m FROM bars WHERE symbol = ?')
    .get(sym) as { n: number; m: number | null };

  const stamp = `${stampRow.n}:${stampRow.m ?? 0}`;
  const hit = cache.get(sym);
  if (hit && hit.stamp === stamp) return hit;

  const rows = db()
    .prepare('SELECT ts, o, h, l, c FROM bars WHERE symbol = ? ORDER BY ts')
    .all(sym) as Array<{ ts: number; o: number; h: number; l: number; c: number }>;

  const base: Candle[] = rows.map((r) => ({ ts: r.ts, end: r.ts, o: r.o, h: r.h, l: r.l, c: r.c }));

  const built: Series = {
    weekly: aggregate(base, weekKey),
    daily: aggregate(base, dayKey),
    h4: aggregate(base, h4Key),
    stamp,
  };

  cache.set(sym, built);
  return built;
}

/**
 * Lee un marco en un instante concreto.
 *
 * Solo entran velas YA CERRADAS antes de `ts`. Incluir la vela en curso seria
 * mirar el futuro: la diaria del dia de la operacion todavia no sabe como
 * acabo, y usarla haria que toda tendencia pareciera acertar.
 */
function readAt(candles: Candle[], ts: number, lookback: number): TrendRead | null {
  let last = -1;
  for (let i = 0; i < candles.length; i++) {
    if (candles[i]!.end < ts) last = i;
    else break;
  }

  if (last < lookback - 1) return null;

  const window = candles.slice(last - lookback + 1, last + 1);

  let high = -Infinity;
  let low = Infinity;
  for (const c of window) {
    if (c.h > high) high = c.h;
    if (c.l < low) low = c.l;
  }

  const span = high - low;
  if (!(span > 0)) return null;

  const ratio = (window[window.length - 1]!.c - window[0]!.o) / span;
  const abs = Math.abs(ratio);

  return {
    label: abs < RANGE_MAX ? 'RANGO' : ratio > 0 ? 'ALCISTA' : 'BAJISTA',
    strength: abs < RANGE_MAX ? null : abs >= CLEAR_MIN ? 'clara' : 'debil',
    ratio: Number(ratio.toFixed(3)),
    position: Number(((window[window.length - 1]!.c - low) / span).toFixed(3)),
    high,
    low,
    candles: lookback,
    from: window[0]!.ts,
    to: window[window.length - 1]!.end,
  };
}

export function trendAt(symbol: string, ts: number): TrendSnapshot {
  const s = seriesFor(symbol);
  return {
    weekly: readAt(s.weekly, ts, LOOKBACK.weekly),
    daily: readAt(s.daily, ts, LOOKBACK.daily),
    h4: readAt(s.h4, ts, LOOKBACK.h4),
  };
}

/**
 * Si la operacion iba a favor del marco, en contra, o el marco estaba en rango.
 * `null` cuando no hay velas suficientes para decidirlo.
 */
export function alignment(read: TrendRead | null, direction: string): 'favor' | 'contra' | 'rango' | null {
  if (!read) return null;
  if (read.label === 'RANGO') return 'rango';
  const expected = direction === 'LONG' ? 'ALCISTA' : 'BAJISTA';
  return read.label === expected ? 'favor' : 'contra';
}
