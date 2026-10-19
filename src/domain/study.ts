import { db } from '../db/index.js';
import { normalizeSymbol } from './bars.js';
import { marketOffsetAt } from './clock.js';
import { instrumentOf } from './instruments.js';
import { PATTERN_LABEL, type PatternCode } from './pattern.js';

/**
 * ¿Sirve de algo entrar a favor de la 4h cuando la vela pequeña hace un patron?
 *
 * Esto no mira tus operaciones. Recorre TODAS las velas del historico, apunta
 * que patron hizo cada una y que estaba haciendo la 4h en ese momento, y mide
 * que paso despues. Son miles de casos en vez de los pocos en que tu entraste,
 * y sobre todo incluye los que NO operaste: sin ellos no hay forma de saber si
 * un patron funciona o si simplemente lo cogiste en buenos dias.
 *
 * LA LINEA BASE ES LA CIFRA QUE IMPORTA. Si "barrido de minimos" acierta el 52%
 * y entrar en CUALQUIER vela acierta el 51%, el patron no aporta nada: lo que
 * manda es la tendencia, no el dibujo. Por eso se calcula siempre y se ensena
 * al lado.
 */

export type TrendMode = 'rango' | 'emas';
export type Retest = 'ninguno' | 'ema8' | 'ema21' | 'cualquiera';
export type StopMode = 'fijo' | 'estructural';

export interface StudyRow {
  code: PatternCode | 'TODOS';
  label: string;
  /** Casos con la 4h en tendencia y entrada a su favor. */
  samples: number;
  /** Cuantos tocaron el objetivo antes que el stop. */
  wins: number;
  hitRate: number;
  /** Puntos porcentuales por encima o por debajo de la linea base. */
  edge: number;
  /**
   * Probabilidad de ver una diferencia asi de grande por pura casualidad, si el
   * patron no sirviera de nada. Por encima de 0,05 no hay nada que mirar.
   */
  pValue: number;
}

export interface StudyReport {
  symbol: string;
  timeframe: number;
  /** 'rango' = avance neto del marco de referencia. 'emas' = pila de medias. */
  trendMode: TrendMode;
  retest: Retest;
  requireStack: boolean;
  stopMode: StopMode;
  /** Objetivo en multiplos del riesgo. Solo se usa con stop estructural. */
  targetR: number;
  /** Riesgo mediano de los casos, en ticks. Con stop fijo es targetTicks. */
  medianRisk: number;
  /**
   * Lo que da entrar AL AZAR con el mismo riesgo y medido igual.
   *
   * Es la unica cifra con la que tiene sentido comparar el acierto. El punto
   * de equilibrio teorico (1/(1+R)) no vale como vara: no tiene en cuenta ni
   * el horizonte, ni los casos que no se resuelven, ni la deriva del periodo.
   */
  randomBaseline: number;
  randomSamples: number;
  /** Minutos de la vela que define la tendencia de referencia. */
  trendMinutes: number;
  /** Cuantas de esas velas se miran para decidir la tendencia. */
  trendLookback: number;
  /** Objetivo y stop, simetricos, en ticks. */
  targetTicks: number;
  horizonMin: number;
  /** Casos descartados porque la 4h estaba en rango. */
  skippedRange: number;
  /** Casos sin recorrido suficiente por delante para resolverse. */
  unresolved: number;
  baseline: StudyRow;
  rows: StudyRow[];
}

interface Bar {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

function aggregate(bars: Bar[], minutes: number): Bar[] {
  if (minutes <= 1) return bars;

  const size = minutes * 60_000;
  const out: Bar[] = [];
  let cur: Bar | null = null;
  let key = NaN;

  for (const b of bars) {
    const k = Math.floor((b.ts + marketOffsetAt(b.ts) * 3600_000) / size);
    if (k !== key) {
      if (cur) out.push(cur);
      cur = { ...b };
      key = k;
    } else if (cur) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
    }
  }

  if (cur) out.push(cur);
  return out;
}

/** La misma clasificacion que `pattern.ts`, sobre velas de cualquier tamano. */
function classify(cs: Bar[], i: number): PatternCode {
  const k = cs[i]!;
  const prev = i > 0 ? cs[i - 1] : undefined;

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
    if (
      body > prevBody &&
      ((bullish && prev.c < prev.o && k.c >= prev.o && k.o <= prev.c) ||
        (!bullish && prev.c > prev.o && k.c <= prev.o && k.o >= prev.c))
    ) {
      return 'envolvente';
    }
  }

  if (lower >= 0.5 * range && body <= 0.35 * range && upper <= 0.2 * range) return 'martillo';
  if (upper >= 0.5 * range && body <= 0.35 * range && lower <= 0.2 * range) return 'estrella';
  if (prev && k.h <= prev.h && k.l >= prev.l) return 'interior';
  if (body >= 0.7 * range) return 'cuerpo_completo';
  if (body <= 0.15 * range) return 'doji';

  return 'normal';
}

/**
 * Tendencia de las ultimas `lookback` velas CERRADAS del marco de referencia.
 *
 * Misma definicion que en el resto del diario: avance neto dividido entre el
 * rango recorrido. Por debajo de 0,30 se considera rango y el caso se descarta,
 * porque "a favor de la tendencia" no significa nada cuando no hay tendencia.
 */
function trendDirection(h4: Bar[], ends: number[], ts: number, lookback: number): 1 | -1 | 0 {
  let lo = 0;
  let hi = ends.length - 1;
  let last = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ends[mid]! < ts) { last = mid; lo = mid + 1; } else hi = mid - 1;
  }

  if (last < lookback - 1) return 0;

  const win = h4.slice(last - lookback + 1, last + 1);
  let high = -Infinity;
  let low = Infinity;
  for (const c of win) {
    if (c.h > high) high = c.h;
    if (c.l < low) low = c.l;
  }

  const span = high - low;
  if (!(span > 0)) return 0;

  const ratio = (win[win.length - 1]!.c - win[0]!.o) / span;

  // El mismo corte que usa el resto del diario: por debajo de 0,30 es rango y
  // no hay direccion que seguir.
  if (Math.abs(ratio) < 0.3) return 0;
  return ratio > 0 ? 1 : -1;
}

/**
 * Error estandar de una proporcion y su p-valor contra la linea base.
 *
 * Sin esto, una fila que dice "+2,9 puntos de ventaja" se lee como un hallazgo
 * cuando con 869 casos el ruido normal ya son casi 2 puntos. La prueba es la de
 * dos proporciones con aproximacion normal: con cientos de casos por cubo es
 * exacta de sobra, y evita montar una tabla de la t.
 */
function twoProportionP(wins: number, n: number, baseRate: number): number {
  if (n < 2) return 1;

  const p = wins / n;
  const se = Math.sqrt((baseRate * (1 - baseRate)) / n);
  if (!(se > 0)) return 1;

  const z = Math.abs(p - baseRate) / se;

  // Funcion de error por aproximacion de Abramowitz y Stegun, suficiente aqui.
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const tail =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));

  return Number(Math.min(1, 2 * tail).toFixed(4));
}

/**
 * Media exponencial sobre los cierres.
 *
 * Se calcula sobre las velas DEL ESTUDIO, no sobre las de un minuto: una EMA
 * de 200 en velas de 15m no es la misma linea que una de 200 en velas de 1m,
 * y mezclarlas daria una tendencia que no existe en ningun grafico.
 */
function emaSeries(candles: Bar[], period: number): Array<number | null> {
  const k = 2 / (period + 1);
  const out: Array<number | null> = new Array(candles.length).fill(null);

  let acc: number | null = null;
  for (let i = 0; i < candles.length; i++) {
    const px = candles[i]!.c;
    acc = acc === null ? px : px * k + acc * (1 - k);
    // Antes de `period` velas la media todavia arrastra el valor inicial y no
    // describe nada. Dejarla en null evita juzgar tendencias inventadas.
    if (i >= period - 1) out[i] = acc;
  }

  return out;
}

interface Emas {
  e8: Array<number | null>;
  e21: Array<number | null>;
  e55: Array<number | null>;
  e200: Array<number | null>;
}

/**
 * Regimen por pila de medias: la 55 por encima de la 200 y el precio por
 * encima de la 55. Es "el precio respeta la tendencia" escrito como condicion.
 */
function emaDirection(candles: Bar[], e: Emas, i: number): 1 | -1 | 0 {
  // `== null` y no `=== null` a proposito: con noUncheckedIndexedAccess el
  // acceso por indice tambien puede devolver undefined, y la media aun no
  // calculada tiene que descartarse igual en los dos casos.
  const a = e.e55[i];
  const b = e.e200[i];
  if (a == null || b == null) return 0;

  const px = candles[i]!.c;
  if (a > b && px > a) return 1;
  if (a < b && px < a) return -1;
  return 0;
}

/** Las cuatro medias ordenadas: 8 > 21 > 55 > 200, o al reves. */
function stacked(e: Emas, i: number, dir: 1 | -1): boolean {
  const v = [e.e8[i], e.e21[i], e.e55[i], e.e200[i]];
  if (v.some((x) => x == null)) return false;

  for (let k = 0; k < 3; k++) {
    const a = v[k] as number;
    const b = v[k + 1] as number;
    if (dir === 1 ? !(a > b) : !(a < b)) return false;
  }

  return true;
}

/**
 * La vela retestea una media: la toca por dentro y CIERRA del lado bueno.
 *
 * Las dos condiciones importan. Tocarla sin cerrar al otro lado es el retest
 * que se busca; cerrar al otro lado ya no es un retest, es una perdida del
 * nivel, y meterlo en el mismo saco emborrona justo lo que se quiere medir.
 */
function touches(candles: Bar[], line: Array<number | null>, i: number, dir: 1 | -1): boolean {
  const e = line[i];
  if (e == null) return false;

  const k = candles[i]!;
  return dir === 1 ? k.l <= e && k.c > e : k.h >= e && k.c < e;
}

/** Generador reproducible: la linea base tiene que salir igual en cada recarga. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, StudyReport>();

export function patternStudy(
  symbol: string,
  options: {
    timeframe?: number;
    targetTicks?: number;
    horizonMin?: number;
    trendMinutes?: number;
    trendLookback?: number;
    trendMode?: TrendMode;
    retest?: Retest;
    requireStack?: boolean;
    stopMode?: StopMode;
    targetR?: number;
  } = {},
): StudyReport {
  const sym = normalizeSymbol(symbol);
  const timeframe = options.timeframe ?? 15;
  const targetTicks = options.targetTicks ?? 40;
  const horizonMin = options.horizonMin ?? 60;
  const trendMinutes = options.trendMinutes ?? 240;
  const trendLookback = options.trendLookback ?? 6;

  const trendMode: TrendMode = options.trendMode ?? 'rango';
  const retest: Retest = options.retest ?? 'ninguno';
  const requireStack = options.requireStack ?? false;
  const stopMode: StopMode = options.stopMode ?? 'fijo';
  const targetR = Math.max(0.25, Math.min(10, options.targetR ?? 2));

  const s = db()
    .prepare('SELECT COUNT(*) AS n, MAX(ts) AS m FROM bars WHERE symbol = ?')
    .get(sym) as { n: number; m: number | null };

  const key = `${sym}:${s.n}:${s.m ?? 0}:${timeframe}:${targetTicks}:${horizonMin}:${trendMinutes}:${trendLookback}:${trendMode}:${retest}:${requireStack}:${stopMode}:${targetR}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const raw = db()
    .prepare('SELECT ts, o, h, l, c FROM bars WHERE symbol = ? ORDER BY ts')
    .all(sym) as Bar[];

  const tickSize = instrumentOf(sym)?.tickSize ?? 0.25;
  const target = targetTicks * tickSize;

  const candles = aggregate(raw, timeframe);
  const ref = aggregate(raw, trendMinutes);

  // Las medias solo se calculan si hacen falta: con 76.000 velas son cuatro
  // recorridos completos que no vale la pena pagar en el modo de rango.
  const emas: Emas | null =
    trendMode === 'emas' || retest !== 'ninguno'
      ? {
          e8: emaSeries(candles, 8),
          e21: emaSeries(candles, 21),
          e55: emaSeries(candles, 55),
          e200: emaSeries(candles, 200),
        }
      : null;

  /**
   * Resuelve una entrada: devuelve 1 si toco el objetivo antes que el stop,
   * -1 si al reves, y 0 si no se puede saber.
   *
   * Comparte codigo con la linea base a proposito. Si el azar se midiera con
   * otra funcion, cualquier diferencia entre los dos numeros podria venir del
   * metodo y no del mercado, que es la forma mas facil de creerse una ventaja.
   */
  function resolve(entryTs: number, entry: number, dir: 1 | -1, stopPx: number, targetPx: number): number {
    const limit = entryTs + horizonMin * 60_000;

    let j = 0;
    let lo = 0;
    let hi = raw.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (raw[mid]!.ts < entryTs) { j = mid + 1; lo = mid + 1; } else hi = mid - 1;
    }

    for (; j < raw.length; j++) {
      const b = raw[j]!;
      if (b.ts > limit) break;

      const hitTarget = dir === 1 ? b.h >= targetPx : b.l <= targetPx;
      const hitStop = dir === 1 ? b.l <= stopPx : b.h >= stopPx;

      if (hitTarget && hitStop) return 0;
      if (hitTarget) return 1;
      if (hitStop) return -1;
    }

    return 0;
  }

  // El final de cada vela de referencia: la ultima de un minuto que la compone.
  // Se reconstruye a partir del tamano porque `aggregate` solo guarda la apertura.
  const refEnds = ref.map((c, i) =>
    i + 1 < ref.length ? ref[i + 1]!.ts - 1 : c.ts + trendMinutes * 60_000,
  );

  const buckets = new Map<PatternCode, { n: number; wins: number }>();
  let skippedRange = 0;
  let unresolved = 0;
  let totalN = 0;
  let totalWins = 0;

  // Puntero sobre las velas de un minuto, para no buscar desde cero en cada
  // caso: las entradas van en orden, asi que el puntero solo avanza.
  const risks: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const entryTs = c.ts + timeframe * 60_000;

    // --- direccion ---------------------------------------------------------
    let dir: 1 | -1 | 0;
    if (trendMode === 'emas' && emas) {
      dir = emaDirection(candles, emas, i);
    } else {
      dir = trendDirection(ref, refEnds, entryTs, trendLookback);
    }

    if (dir === 0) { skippedRange++; continue; }

    // --- filtros opcionales ------------------------------------------------
    if (requireStack && emas && !stacked(emas, i, dir)) { skippedRange++; continue; }

    if (retest !== 'ninguno' && emas) {
      const t8 = touches(candles, emas.e8, i, dir);
      const t21 = touches(candles, emas.e21, i, dir);

      const ok =
        retest === 'ema8' ? t8 : retest === 'ema21' ? t21 : t8 || t21;

      if (!ok) { skippedRange++; continue; }
    }

    // --- stop y objetivo ---------------------------------------------------
    const entry = c.c;

    let stopPx: number;
    let targetPx: number;

    if (stopMode === 'estructural') {
      // Al otro lado de la vela que acaba de tocar la media, mas un colchon de
      // dos ticks. Es donde lo pone quien opera un retest: si el precio vuelve
      // a pasar por ahi, la lectura era falsa.
      stopPx = dir === 1 ? c.l - 2 * tickSize : c.h + 2 * tickSize;

      const risk = Math.abs(entry - stopPx);

      // Velas absurdas fuera: menos de 4 ticks es ruido de una mecha y mas de
      // 200 es un dato economico, no un retest. Dejarlas dentro desplazaria la
      // mediana del riesgo y con ella la linea base.
      if (risk < 4 * tickSize || risk > 200 * tickSize) { skippedRange++; continue; }

      targetPx = entry + dir * targetR * risk;
      risks.push(risk / tickSize);
    } else {
      stopPx = entry - dir * target;
      targetPx = entry + dir * target;
      risks.push(targetTicks);
    }

    const outcome = resolve(entryTs, entry, dir, stopPx, targetPx);
    if (outcome === 0) { unresolved++; continue; }

    const code = classify(candles, i);
    const b = buckets.get(code) ?? { n: 0, wins: 0 };
    b.n++;
    if (outcome === 1) b.wins++;
    buckets.set(code, b);

    totalN++;
    if (outcome === 1) totalWins++;
  }

  // --- la vara de medir ----------------------------------------------------
  //
  // Entradas al azar con el MISMO riesgo tipico y resueltas con la MISMA
  // funcion. Sin esto, un 34% no se sabe si es bueno o malo: el punto de
  // equilibrio teorico ignora el horizonte y los casos sin resolver, y suele
  // quedar varios puntos por debajo de lo que de verdad da el azar.
  risks.sort((a, b) => a - b);
  const medianRisk = risks.length > 0 ? risks[Math.floor(risks.length / 2)]! : targetTicks;

  const rnd = mulberry32(0x5eed);
  let randomWins = 0;
  let randomN = 0;

  // 25.000 y no 4.000. Con 4.000 la linea base oscilaba entre 35,3% y 37,4%
  // solo por el sorteo — justo el tamano de las diferencias que esta tabla
  // quiere medir. Una vara de medir que se mueve dos puntos no sirve para
  // juzgar una ventaja de dos puntos. Comprobada la convergencia: a partir de
  // 20.000 se estabiliza, y cuesta decimas de segundo.
  const RANDOM_TRIES = 25000;
  const riskPx = medianRisk * tickSize;
  const rMultiple = stopMode === 'estructural' ? targetR : 1;

  for (let k = 0; k < RANDOM_TRIES && candles.length > 300; k++) {
    const i = 200 + Math.floor(rnd() * Math.max(1, candles.length - 400));
    const d: 1 | -1 = rnd() < 0.5 ? 1 : -1;

    const c = candles[i]!;
    const entry = c.c;
    const entryTs = c.ts + timeframe * 60_000;

    const o = resolve(entryTs, entry, d, entry - d * riskPx, entry + d * rMultiple * riskPx);
    if (o === 0) continue;

    randomN++;
    if (o === 1) randomWins++;
  }

  const randomBaseline = randomN > 0 ? randomWins / randomN : 0;

  const baseRate = totalN > 0 ? totalWins / totalN : 0;

  const baseline: StudyRow = {
    code: 'TODOS',
    label: 'Cualquier vela (linea base)',
    samples: totalN,
    wins: totalWins,
    hitRate: Number(baseRate.toFixed(4)),
    edge: 0,
    pValue: 1,
  };

  const rows: StudyRow[] = [...buckets.entries()]
    .map(([code, b]) => ({
      code,
      label: PATTERN_LABEL[code],
      samples: b.n,
      wins: b.wins,
      hitRate: Number((b.wins / b.n).toFixed(4)),
      edge: Number(((b.wins / b.n - baseRate) * 100).toFixed(1)),
      pValue: twoProportionP(b.wins, b.n, baseRate),
    }))
    .sort((a, b) => b.samples - a.samples);

  const report: StudyReport = {
    symbol: sym,
    timeframe,
    trendMinutes,
    trendLookback,
    targetTicks,
    horizonMin,
    skippedRange,
    unresolved,
    trendMode,
    retest,
    requireStack,
    stopMode,
    targetR,
    medianRisk: Number(medianRisk.toFixed(1)),
    randomBaseline: Number(randomBaseline.toFixed(4)),
    randomSamples: randomN,
    baseline,
    rows,
  };

  cache.set(key, report);
  return report;
}
