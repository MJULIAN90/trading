import { db } from '../db/index.js';
import { normalizeSymbol } from './bars.js';
import { marketOffsetAt } from './clock.js';
import { excursionOf } from './excursion.js';
import type { Operation } from './metrics.js';

/**
 * Patron de accion del precio en la vela de 15 minutos que estaba CERRADA
 * cuando abriste.
 *
 * Por que la cerrada y no la que estaba formandose: la que esta en curso
 * todavia puede acabar en cualquier sitio. Clasificarla con su cierre
 * definitivo seria mirar el futuro, y cualquier patron pareceria funcionar.
 * Esto tiene un limite honesto: si tu entrada reacciona a lo que esta pasando
 * DENTRO de la vela en curso, esta columna no describe lo que viste.
 *
 * Las definiciones son geometricas y estan todas medidas sobre el rango de la
 * propia vela, no sobre numeros absolutos: asi valen igual en un dia tranquilo
 * y en uno volatil, y no hay que recalibrarlas por instrumento.
 */

export type PatternCode =
  | 'barrido_alcista'
  | 'barrido_bajista'
  | 'envolvente'
  | 'martillo'
  | 'estrella'
  | 'interior'
  | 'cuerpo_completo'
  | 'doji'
  | 'normal'
  | 'plana';

export const PATTERN_LABEL: Record<PatternCode, string> = {
  barrido_alcista: 'Barrido de minimos',
  barrido_bajista: 'Barrido de maximos',
  envolvente: 'Envolvente',
  martillo: 'Martillo',
  estrella: 'Estrella fugaz',
  interior: 'Vela interior',
  cuerpo_completo: 'Cuerpo completo',
  doji: 'Doji',
  normal: 'Sin patron',
  plana: 'Sin rango',
};

export const PATTERN_HELP: Record<PatternCode, string> = {
  barrido_alcista:
    'Perforo el minimo de la vela anterior y cerro por encima de el: busco liquidez abajo y no se quedo.',
  barrido_bajista:
    'Perforo el maximo de la vela anterior y cerro por debajo: busco liquidez arriba y no se quedo.',
  envolvente: 'Su cuerpo se come entero el de la vela anterior, en direccion contraria.',
  martillo: 'Mecha inferior larga y cuerpo pequeno arriba: rechazo de precios bajos.',
  estrella: 'Mecha superior larga y cuerpo pequeno abajo: rechazo de precios altos.',
  interior: 'Entera dentro del rango de la anterior: el mercado se comprimio.',
  cuerpo_completo: 'Cuerpo que ocupa casi todo el rango, sin apenas mechas: impulso limpio.',
  doji: 'Abre y cierra casi en el mismo sitio: indecision.',
  normal: 'Nada destacable en la geometria de la vela.',
  plana: 'Maximo y minimo iguales; no se puede clasificar.',
};

export interface PatternRead {
  code: PatternCode;
  label: string;
  help: string;
  /** Instante de apertura de la vela clasificada. */
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Minutos de los que se compone: 15 es completa, menos significa huecos. */
  minutes: number;
  /** Cuerpo como fraccion del rango, de 0 a 1. */
  bodyShare: number;
  /** True si la vela cerro al alza. */
  bullish: boolean;
}

interface Candle {
  ts: number;
  end: number;
  o: number;
  h: number;
  l: number;
  c: number;
  minutes: number;
}

const FRAME_MS = 15 * 60_000;

/** Velas de 15 minutos ancladas a :00, :15, :30 y :45 de la hora de mercado. */
function frameKey(ts: number): number {
  return Math.floor((ts + marketOffsetAt(ts) * 3600_000) / FRAME_MS);
}

interface Series {
  candles: Candle[];
  ends: number[];
  stamp: string;
}

const cache = new Map<string, Series>();

function seriesFor(symbol: string): Series {
  const sym = normalizeSymbol(symbol);

  const s = db()
    .prepare('SELECT COUNT(*) AS n, MAX(ts) AS m FROM bars WHERE symbol = ?')
    .get(sym) as { n: number; m: number | null };

  const stamp = `${s.n}:${s.m ?? 0}`;
  const hit = cache.get(sym);
  if (hit && hit.stamp === stamp) return hit;

  const rows = db()
    .prepare('SELECT ts, o, h, l, c FROM bars WHERE symbol = ? ORDER BY ts')
    .all(sym) as Array<{ ts: number; o: number; h: number; l: number; c: number }>;

  const candles: Candle[] = [];
  let current: Candle | null = null;
  let key = NaN;

  for (const r of rows) {
    const k = frameKey(r.ts);
    if (k !== key) {
      if (current) candles.push(current);
      current = { ts: r.ts, end: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, minutes: 1 };
      key = k;
    } else if (current) {
      current.h = Math.max(current.h, r.h);
      current.l = Math.min(current.l, r.l);
      current.c = r.c;
      current.end = r.ts;
      current.minutes++;
    }
  }

  if (current) candles.push(current);

  const built: Series = { candles, ends: candles.map((c) => c.end), stamp };
  cache.set(sym, built);
  return built;
}

/**
 * Clasifica la vela `i` mirando tambien la anterior.
 *
 * El orden de las comprobaciones ES la definicion: una vela puede cumplir
 * varias cosas a la vez (un barrido suele tener mecha larga, o sea tambien es
 * martillo) y hay que quedarse con una. Primero van los patrones que dicen algo
 * sobre lo que HIZO el precio respecto a la vela anterior —barrer liquidez,
 * envolver— y despues los que solo describen la forma de la vela suelta. Un
 * barrido de minimos es informacion mas concreta que "tiene mecha larga
 * abajo", que es la misma vela contada de forma mas pobre.
 */
function classify(candles: Candle[], i: number): PatternCode {
  const k = candles[i]!;
  const prev = i > 0 ? candles[i - 1] : undefined;

  const range = k.h - k.l;
  if (!(range > 0)) return 'plana';

  const body = Math.abs(k.c - k.o);
  const top = Math.max(k.o, k.c);
  const bottom = Math.min(k.o, k.c);
  const upper = k.h - top;
  const lower = bottom - k.l;
  const bullish = k.c > k.o;

  if (prev) {
    if (k.l < prev.l && k.c > prev.l) return 'barrido_alcista';
    if (k.h > prev.h && k.c < prev.h) return 'barrido_bajista';

    const prevBody = Math.abs(prev.c - prev.o);
    const engulfs =
      body > prevBody &&
      ((bullish && prev.c < prev.o && k.c >= prev.o && k.o <= prev.c) ||
        (!bullish && prev.c > prev.o && k.c <= prev.o && k.o >= prev.c));
    if (engulfs) return 'envolvente';
  }

  if (lower >= 0.5 * range && body <= 0.35 * range && upper <= 0.2 * range) return 'martillo';
  if (upper >= 0.5 * range && body <= 0.35 * range && lower <= 0.2 * range) return 'estrella';
  if (prev && k.h <= prev.h && k.l >= prev.l) return 'interior';
  if (body >= 0.7 * range) return 'cuerpo_completo';
  if (body <= 0.15 * range) return 'doji';

  return 'normal';
}

/** Indice de la ultima vela de 15m cerrada antes de `ts`. */
function lastClosedIndex(ends: number[], ts: number): number {
  let lo = 0;
  let hi = ends.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    // La vela se da por cerrada cuando su ultimo minuto ya quedo atras.
    if (ends[mid]! + 60_000 <= ts) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function patternAt(symbol: string, ts: number): PatternRead | null {
  const { candles, ends } = seriesFor(symbol);
  const i = lastClosedIndex(ends, ts);
  if (i < 1) return null;

  const k = candles[i]!;
  const code = classify(candles, i);
  const range = k.h - k.l;

  return {
    code,
    label: PATTERN_LABEL[code],
    help: PATTERN_HELP[code],
    ts: k.ts,
    open: k.o,
    high: k.h,
    low: k.l,
    close: k.c,
    minutes: k.minutes,
    bodyShare: range > 0 ? Number((Math.abs(k.c - k.o) / range).toFixed(2)) : 0,
    bullish: k.c > k.o,
  };
}

// ---------------------------------------------------------------- agregado

export interface PatternRow {
  code: PatternCode;
  label: string;
  help: string;
  operations: number;
  wins: number;
  pnl: number;
  /** Mediana de lo que llego a ir a favor, en ticks. */
  medianMfe: number | null;
  /**
   * Mediana de los ticks que llegaste a tener y no te llevaste.
   *
   * OJO: sale de un grupo MAS PEQUEÑO que `medianMfe`, porque solo existe
   * cuando la operacion llego a ir a favor. No se puede restar del MFE.
   */
  medianGivenBack: number | null;
  /**
   * Mediana del resultado en ticks, con signo. ESTA si es comparable con
   * `medianMfe`: las dos salen del mismo grupo de operaciones.
   *
   * Es la columna que faltaba. Sin ella, una fila podia enseñar un P&L total
   * en verde -que es una SUMA, y la levantan dos operaciones grandes- al lado
   * de una operacion tipica que pierde, y no habia forma de verlo.
   */
  medianResult: number | null;
}

export interface PatternReport {
  rows: PatternRow[];
  /** Operaciones que no se pudieron clasificar por falta de velas. */
  skipped: number;
  /** Velas usadas que no tenian los 15 minutos completos. */
  incomplete: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Number(((s[mid - 1]! + s[mid]!) / 2).toFixed(1));
}

/**
 * Reparto de resultados por patron de la vela de 15m.
 *
 * AVISO sobre como leerlo, que importa mas que la tabla: con un centenar de
 * operaciones repartidas en nueve patrones, los cubos quedan de cinco o diez.
 * A ese tamano, una sola operacion grande mueve la media entera y cualquier
 * diferencia entre filas cabe dentro del azar. Esto sirve para ABRIR las
 * operaciones de un patron y mirarlas una a una, no para decidir que patron
 * funciona.
 */
export function patternReport(ops: Operation[]): PatternReport {
  const buckets = new Map<
    PatternCode,
    { n: number; wins: number; pnl: number; mfe: number[]; given: number[]; res: number[] }
  >();

  let skipped = 0;
  let incomplete = 0;

  for (const op of ops) {
    const read = patternAt(op.symbol, op.opened_at);
    if (!read) {
      skipped++;
      continue;
    }

    if (read.minutes < 14) incomplete++;

    const b =
      buckets.get(read.code) ??
      { n: 0, wins: 0, pnl: 0, mfe: [] as number[], given: [] as number[], res: [] as number[] };

    b.n++;
    b.pnl += op.gross_pnl;
    if (op.gross_pnl > 0) b.wins++;

    const ex = excursionOf(op);
    if (ex.mfe !== null) b.mfe.push(ex.mfe);
    if (ex.givenBack !== null) b.given.push(ex.givenBack);
    // Mismo `if` que el MFE a proposito: las dos medianas tienen que salir
    // del mismo grupo para poder leerse una al lado de la otra.
    if (ex.mfe !== null && ex.resultTicks !== null) b.res.push(ex.resultTicks);

    buckets.set(read.code, b);
  }

  const rows: PatternRow[] = [...buckets.entries()]
    .map(([code, b]) => ({
      code,
      label: PATTERN_LABEL[code],
      help: PATTERN_HELP[code],
      operations: b.n,
      wins: b.wins,
      pnl: Number(b.pnl.toFixed(2)),
      medianMfe: median(b.mfe),
      medianGivenBack: median(b.given),
      medianResult: median(b.res),
    }))
    .sort((a, b) => b.operations - a.operations);

  return { rows, skipped, incomplete };
}
