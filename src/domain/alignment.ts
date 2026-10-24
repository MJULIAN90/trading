import { db } from '../db/index.js';
import type { EnrichedOperation } from './costs.js';
import { normalizeSymbol } from './bars.js';

/**
 * Alineacion con la pila de medias en VARIOS marcos a la vez.
 *
 * El puente entre las dos mitades del diario. Hasta ahora habia dos mundos sin
 * contacto: los estudios de mercado -que miran miles de velas y no saben nada
 * de ti- y tus operaciones -que saben todo de ti y nada del mercado en el
 * momento de entrar-. Con esto se pueden cruzar: "el doji acierta un 61%"
 * deja de ser un dato suelto y pasa a poder preguntarse "el doji acierta un
 * 61% CUANDO ADEMAS estoy alineado en los cuatro marcos".
 *
 * NO HACE FALTA TOCAR NINGUN INDICADOR. Todo sale de las velas de un minuto
 * que ya estan guardadas: se agrupan a 15m, 1h y 4h y se calculan las medias
 * sobre cada marco. Eso quiere decir que se puede sellar HACIA ATRAS, sobre
 * las operaciones que ya existen, en vez de empezar a medir desde cero.
 *
 * LA PILA, no el cruce suelto. "A favor" es 8 > 21 > 55 > 200 y el precio
 * arriba, que es como el describe su operativa: estar por encima de las
 * cuatro. Dos medias cruzadas sin las otras no cuenta.
 *
 * SIN MIRAR AL FUTURO. Para una entrada a las 13:07, la vela de 15m que la
 * contiene NO ha cerrado todavia: usarla seria leer informacion que no tenias.
 * Se evalua sobre la ultima vela CERRADA de cada marco.
 */

export type FrameName = 'm1' | 'm15' | 'h1' | 'h4';

/** Minutos de cada marco. El orden importa: se reporta de menor a mayor. */
const FRAMES: Array<{ name: FrameName; minutes: number }> = [
  { name: 'm1', minutes: 1 },
  { name: 'm15', minutes: 15 },
  { name: 'h1', minutes: 60 },
  { name: 'h4', minutes: 240 },
];

const PERIODS = [8, 21, 55, 200] as const;

/**
 * 'favor'  la pila va en el sentido de la operacion
 * 'contra' la pila va en el sentido opuesto
 * 'plana'  no hay pila: las medias estan enredadas (el "se esta volteando")
 * null     no hay velas suficientes en ese marco todavia
 */
export type FrameState = 'favor' | 'contra' | 'plana' | null;

export interface AlignmentRead {
  m1: FrameState;
  m15: FrameState;
  h1: FrameState;
  h4: FrameState;
  /** Cuantos de los cuatro marcos van a favor. 0 a 4. */
  favor: number;
  /** Cuantos van explicitamente en contra. */
  contra: number;
  /** Marcos con datos suficientes para opinar. Normalmente 4. */
  conDatos: number;
}

interface Frame {
  /** Instante de APERTURA de cada vela del marco, ordenado. */
  opens: number[];
  closes: number[];
  emas: Array<Array<number | null>>;
}

type Series = Record<FrameName, Frame> & { stamp: string };

const cache = new Map<string, Series>();

/** Media exponencial sobre los cierres del marco. Igual que en study.ts. */
function emaSeries(closes: number[], period: number): Array<number | null> {
  const k = 2 / (period + 1);
  const out: Array<number | null> = new Array(closes.length).fill(null);

  let acc: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    const px = closes[i]!;
    acc = acc === null ? px : px * k + acc * (1 - k);
    // Antes de `period` velas la media arrastra el valor inicial y no
    // describe nada. En null, para no juzgar tendencias inventadas.
    if (i >= period - 1) out[i] = acc;
  }

  return out;
}

function buildFrame(rows: Array<{ ts: number; c: number }>, minutes: number): Frame {
  const step = minutes * 60_000;

  const opens: number[] = [];
  const closes: number[] = [];
  let key = NaN;

  for (const r of rows) {
    const k = Math.floor(r.ts / step);
    if (k !== key) {
      opens.push(k * step);
      closes.push(r.c);
      key = k;
    } else {
      // El cierre del marco es el ultimo cierre de un minuto que cae dentro.
      closes[closes.length - 1] = r.c;
    }
  }

  return { opens, closes, emas: PERIODS.map((p) => emaSeries(closes, p)) };
}

function seriesFor(symbol: string): Series {
  const sym = normalizeSymbol(symbol);

  const s = db()
    .prepare('SELECT COUNT(*) AS n, MAX(ts) AS m FROM bars WHERE symbol = ?')
    .get(sym) as { n: number; m: number | null };

  const stamp = `${s.n}:${s.m ?? 0}`;
  const hit = cache.get(sym);
  if (hit && hit.stamp === stamp) return hit;

  const rows = db()
    .prepare('SELECT ts, c FROM bars WHERE symbol = ? ORDER BY ts')
    .all(sym) as Array<{ ts: number; c: number }>;

  const built = { stamp } as Series;
  for (const f of FRAMES) built[f.name] = buildFrame(rows, f.minutes);

  // Una entrada por simbolo y la huella dentro: se sobreescribe sola cuando
  // entran velas nuevas, asi que no crece.
  cache.set(sym, built);
  return built;
}

/**
 * Indice de la ultima vela CERRADA estrictamente antes de `ts`.
 *
 * Busqueda binaria sobre las aperturas. Una vela que abre en `o` con paso
 * `step` cierra en `o + step`, asi que vale si `o + step <= ts`.
 */
function lastClosed(frame: Frame, ts: number, step: number): number {
  let lo = 0;
  let hi = frame.opens.length - 1;
  let res = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frame.opens[mid]! + step <= ts) {
      res = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return res;
}

/** 1 alcista, -1 bajista, 0 sin pila. */
function stackDir(frame: Frame, i: number): 1 | -1 | 0 {
  const v = frame.emas.map((e) => e[i]);
  if (v.some((x) => x == null)) return 0;

  const px = frame.closes[i]!;
  const [e8, e21, e55, e200] = v as [number, number, number, number];

  // El precio TAMBIEN tiene que estar del lado correcto. Sin eso, una pila
  // perfecta con el precio metido por debajo contaria como "a favor" justo
  // cuando el movimiento se esta dando la vuelta.
  if (e8 > e21 && e21 > e55 && e55 > e200 && px > e8) return 1;
  if (e8 < e21 && e21 < e55 && e55 < e200 && px < e8) return -1;
  return 0;
}

export function alignmentAt(symbol: string, ts: number, direction: string): AlignmentRead {
  const series = seriesFor(symbol);
  const quiere = direction === 'LONG' ? 1 : -1;

  const out = { m1: null, m15: null, h1: null, h4: null, favor: 0, contra: 0, conDatos: 0 } as AlignmentRead;

  for (const f of FRAMES) {
    const frame = series[f.name];
    const i = lastClosed(frame, ts, f.minutes * 60_000);

    // Sin vela cerrada, o con las medias aun sin calcular, no se opina.
    if (i < 0 || frame.emas[3]![i] == null) {
      out[f.name] = null;
      continue;
    }

    out.conDatos++;
    const dir = stackDir(frame, i);
    const estado: FrameState = dir === 0 ? 'plana' : dir === quiere ? 'favor' : 'contra';
    out[f.name] = estado;

    if (estado === 'favor') out.favor++;
    if (estado === 'contra') out.contra++;
  }

  return out;
}

// ------------------------------------------------------------------ reparto

export interface AlignmentBucket {
  /** Cuantos marcos iban a favor: 0, 1, 2, 3 o 4. */
  favor: number;
  operations: number;
  wins: number;
  hitRate: number;
  netPnl: number;
  /** Resultado medio por operacion. Es lo unico comparable entre cajones. */
  avgNet: number;
  ticks: number;
}

export interface AlignmentReport {
  symbol: string;
  analyzed: number;
  /** Operaciones que no se pudieron evaluar por falta de velas guardadas. */
  skipped: number;
  buckets: AlignmentBucket[];
  /** Reparto por marco suelto, para ver cual de los cuatro pesa de verdad. */
  byFrame: Array<{ frame: FrameName; favor: AlignmentBucket; contra: AlignmentBucket }>;
}

function vacio(favor: number): AlignmentBucket {
  return { favor, operations: 0, wins: 0, hitRate: 0, netPnl: 0, avgNet: 0, ticks: 0 };
}

function suma(b: AlignmentBucket, op: EnrichedOperation): void {
  b.operations++;
  if (op.netPnl > 0) b.wins++;
  b.netPnl += op.netPnl;
  b.ticks += op.ticks ?? 0;
}

function cierra(b: AlignmentBucket): AlignmentBucket {
  return {
    ...b,
    hitRate: b.operations > 0 ? Number((b.wins / b.operations).toFixed(4)) : 0,
    netPnl: Number(b.netPnl.toFixed(2)),
    avgNet: b.operations > 0 ? Number((b.netPnl / b.operations).toFixed(2)) : 0,
    ticks: Number(b.ticks.toFixed(1)),
  };
}

/**
 * Como le fue a el segun con cuantos marcos estaba alineado.
 *
 * Es la pregunta que no se podia hacer hasta ahora, y conviene leerla con la
 * misma desconfianza que el resto: con 359 operaciones repartidas en cinco
 * cajones, los extremos van a tener muy pocos casos. El numero de operaciones
 * de cada fila manda sobre el porcentaje.
 */
export function alignmentBreakdown(ops: EnrichedOperation[]): AlignmentReport {
  const buckets = [0, 1, 2, 3, 4].map(vacio);
  const porMarco = FRAMES.map((f) => ({ frame: f.name, favor: vacio(1), contra: vacio(0) }));

  let analyzed = 0;
  let skipped = 0;
  let symbol = '';

  for (const op of ops) {
    const read = alignmentAt(op.symbol, op.opened_at, op.direction);
    if (read.conDatos === 0) { skipped++; continue; }

    analyzed++;
    symbol = op.symbol;
    suma(buckets[read.favor]!, op);

    for (const m of porMarco) {
      const estado = read[m.frame];
      if (estado === 'favor') suma(m.favor, op);
      if (estado === 'contra') suma(m.contra, op);
    }
  }

  return {
    symbol,
    analyzed,
    skipped,
    buckets: buckets.map(cierra),
    byFrame: porMarco.map((m) => ({ frame: m.frame, favor: cierra(m.favor), contra: cierra(m.contra) })),
  };
}
