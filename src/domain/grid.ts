import { db } from '../db/index.js';
import { normalizeSymbol } from './bars.js';
import { marketOffsetAt } from './clock.js';
import { instrumentOf } from './instruments.js';
import { PATTERN_LABEL, type PatternCode } from './pattern.js';
import { boundedCache } from './boundedCache.js';

/**
 * Todas las combinaciones de patron, temporalidad, tendencia de 4h y sentido
 * de entrada, a la vez.
 *
 * Y con el aviso por delante, porque es la razon de ser de este fichero: probar
 * ciento sesenta combinaciones y quedarse con las que salen bien NO es
 * investigar, es pescar. Con ciento sesenta pruebas sobre datos sin ninguna
 * senal, ocho van a dar p < 0,05 por pura casualidad. Si me limito a ensenar
 * las ocho, parecen hallazgos y son ruido.
 *
 * Por eso aqui no basta con el p-valor. Hay tres filtros encima:
 *
 * 1. Cada combinacion se compara con SU PROPIA linea base, no con una global.
 *    Entrar en contra de la tendencia tiene su propio acierto de partida, y
 *    medir un patron contra la base equivocada mide la tendencia otra vez.
 * 2. Correccion de Benjamini-Hochberg sobre todos los p-valores a la vez. El
 *    q-valor que sale ya tiene en cuenta cuantas pruebas se hicieron.
 * 3. La prueba que de verdad separa: partir el historico por la mitad y mirar
 *    si lo que funciona en la primera mitad sigue funcionando en la segunda.
 *    Un patron de verdad se repite; una casualidad, no.
 */

export type TrendState = 'ALCISTA' | 'BAJISTA' | 'RANGO';
export type EntrySide = 'LONG' | 'SHORT';

export interface GridRow {
  timeframe: number;
  pattern: PatternCode;
  patternLabel: string;
  trend: TrendState;
  side: EntrySide;
  /** Si el sentido de entrada coincide con la tendencia de 4h. */
  aligned: boolean | null;
  /** Si el sesgo del propio patron coincide con el sentido de entrada. */
  patternAgrees: boolean | null;

  samples: number;
  wins: number;
  hitRate: number;

  /** Acierto de ese mismo cajon sin mirar el patron. */
  baseline: number;
  baselineSamples: number;
  /** Puntos porcentuales sobre su linea base. */
  edge: number;

  pValue: number;
  /** p corregido por el numero de pruebas (Benjamini-Hochberg). */
  qValue: number;

  /** Acierto en la primera y la segunda mitad del historico. */
  firstHalf: number | null;
  secondHalf: number | null;
  firstHalfN: number;
  secondHalfN: number;
  /** Las dos mitades por encima de su base: lo unico que de verdad convence. */
  consistent: boolean;
}

export interface GridReport {
  symbol: string;
  targetTicks: number;
  horizonMin: number;
  timeframes: number[];
  /** Cuantas combinaciones se han probado. Es el numero que hace falta saber. */
  tested: number;
  /** Cuantas saldrian por azar con p < 0,05 si no hubiera nada. */
  expectedByChance: number;
  /** Cuantas pasan con p < 0,05 sin corregir. */
  rawHits: number;
  /** Cuantas sobreviven a la correccion. */
  survivors: number;
  /** Cuantas ademas se repiten en las dos mitades. */
  consistentSurvivors: number;
  rows: GridRow[];
}

interface Bar { ts: number; o: number; h: number; l: number; c: number }

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
    const pb = Math.abs(prev.c - prev.o);
    if (
      body > pb &&
      ((bullish && prev.c < prev.o && k.c >= prev.o && k.o <= prev.c) ||
        (!bullish && prev.c > prev.o && k.c <= prev.o && k.o >= prev.c))
    ) return 'envolvente';
  }

  if (lower >= 0.5 * range && body <= 0.35 * range && upper <= 0.2 * range) return 'martillo';
  if (upper >= 0.5 * range && body <= 0.35 * range && lower <= 0.2 * range) return 'estrella';
  if (prev && k.h <= prev.h && k.l >= prev.l) return 'interior';
  if (body >= 0.7 * range) return 'cuerpo_completo';
  if (body <= 0.15 * range) return 'doji';
  return 'normal';
}

/**
 * Hacia donde apunta el propio patron, independientemente de la tendencia.
 *
 * Un barrido de minimos es alcista: busco liquidez abajo y la rechazo. Un
 * cuerpo completo apunta a donde va su cuerpo. Los que no dicen nada —interior,
 * doji, sin patron— valen cero, y asi la columna "el patron coincide con tu
 * entrada" no se inventa una opinion donde la vela no la tiene.
 */
function bias(code: PatternCode, cs: Bar[], i: number): 1 | -1 | 0 {
  const k = cs[i]!;
  switch (code) {
    case 'barrido_alcista':
    case 'martillo':
      return 1;
    case 'barrido_bajista':
    case 'estrella':
      return -1;
    case 'envolvente':
    case 'cuerpo_completo':
      return k.c > k.o ? 1 : -1;
    default:
      return 0;
  }
}

function trendAt(h4: Bar[], ends: number[], ts: number, lookback: number): 1 | -1 | 0 {
  let lo = 0, hi = ends.length - 1, last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ends[mid]! < ts) { last = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (last < lookback - 1) return 0;

  const win = h4.slice(last - lookback + 1, last + 1);
  let high = -Infinity, low = Infinity;
  for (const c of win) { if (c.h > high) high = c.h; if (c.l < low) low = c.l; }

  const span = high - low;
  if (!(span > 0)) return 0;

  const ratio = (win[win.length - 1]!.c - win[0]!.o) / span;
  if (Math.abs(ratio) < 0.3) return 0;
  return ratio > 0 ? 1 : -1;
}

function normalP(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const tail = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return Math.min(1, 2 * tail);
}

interface Case {
  ts: number;
  pattern: PatternCode;
  bias: 1 | -1 | 0;
  trend: 1 | -1 | 0;
  /** 1 si subio el objetivo primero, -1 si bajo primero, 0 sin resolver. */
  outcome: 1 | -1 | 0;
}

const cache = boundedCache<GridReport>(12);

export function patternGrid(
  symbol: string,
  options: { targetTicks?: number; horizonMin?: number; minSamples?: number } = {},
): GridReport {
  const sym = normalizeSymbol(symbol);
  const targetTicks = options.targetTicks ?? 40;
  const horizonMin = options.horizonMin ?? 60;
  const minSamples = options.minSamples ?? 120;

  const meta = db()
    .prepare('SELECT COUNT(*) AS n, MAX(ts) AS m FROM bars WHERE symbol = ?')
    .get(sym) as { n: number; m: number | null };

  const key = `${sym}:${meta.n}:${meta.m ?? 0}:${targetTicks}:${horizonMin}:${minSamples}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const raw = db()
    .prepare('SELECT ts, o, h, l, c FROM bars WHERE symbol = ? ORDER BY ts')
    .all(sym) as Bar[];

  const tickSize = instrumentOf(sym)?.tickSize ?? 0.25;
  const target = targetTicks * tickSize;

  const h4 = aggregate(raw, 240);
  const h4Ends = h4.map((c, i) => (i + 1 < h4.length ? h4[i + 1]!.ts - 1 : c.ts + 240 * 60_000));

  const timeframes = [1, 5, 15, 60];
  const perTf = new Map<number, Case[]>();

  for (const tf of timeframes) {
    const cs = aggregate(raw, tf);
    const cases: Case[] = [];
    let cursor = 0;

    for (let i = 1; i < cs.length; i++) {
      const c = cs[i]!;
      const entryTs = c.ts + tf * 60_000;

      while (cursor < raw.length && raw[cursor]!.ts < entryTs) cursor++;

      const limit = entryTs + horizonMin * 60_000;
      const entry = c.c;
      let outcome: 1 | -1 | 0 = 0;

      for (let j = cursor; j < raw.length; j++) {
        const b = raw[j]!;
        if (b.ts > limit) break;

        const up = b.h >= entry + target;
        const down = b.l <= entry - target;

        // Los dos en la misma vela: sin ticks no se sabe cual fue primero. No
        // resuelto, en vez de elegir el que conviene.
        if (up && down) { outcome = 0; break; }
        if (up) { outcome = 1; break; }
        if (down) { outcome = -1; break; }
      }

      if (outcome === 0) continue;

      const code = classify(cs, i);
      cases.push({
        ts: entryTs,
        pattern: code,
        bias: bias(code, cs, i),
        trend: trendAt(h4, h4Ends, entryTs, 6),
        outcome,
      });
    }

    perTf.set(tf, cases);
  }

  // Mediana temporal para partir el historico en dos mitades comparables.
  const allTs = [...perTf.values()].flat().map((c) => c.ts).sort((a, b) => a - b);
  const splitTs = allTs.length ? allTs[Math.floor(allTs.length / 2)]! : 0;

  const trendName = (t: 1 | -1 | 0): TrendState =>
    t === 1 ? 'ALCISTA' : t === -1 ? 'BAJISTA' : 'RANGO';

  interface Bucket { n: number; wins: number; n1: number; w1: number; n2: number; w2: number }
  const mk = (): Bucket => ({ n: 0, wins: 0, n1: 0, w1: 0, n2: 0, w2: 0 });

  const cells = new Map<string, Bucket>();      // base: tf|trend|side
  const combos = new Map<string, Bucket>();     // tf|trend|side|pattern

  for (const tf of timeframes) {
    for (const c of perTf.get(tf) ?? []) {
      for (const side of ['LONG', 'SHORT'] as EntrySide[]) {
        const won = side === 'LONG' ? c.outcome === 1 : c.outcome === -1;
        const first = c.ts < splitTs;

        const cellKey = `${tf}|${trendName(c.trend)}|${side}`;
        const comboKey = `${cellKey}|${c.pattern}`;

        for (const [map, k] of [[cells, cellKey], [combos, comboKey]] as const) {
          let b = map.get(k);
          if (!b) { b = mk(); map.set(k, b); }
          b.n++;
          if (won) b.wins++;
          if (first) { b.n1++; if (won) b.w1++; } else { b.n2++; if (won) b.w2++; }
        }
      }
    }
  }

  const rows: GridRow[] = [];

  for (const [k, b] of combos) {
    if (b.n < minSamples) continue;

    const [tfStr, trend, side, pattern] = k.split('|') as [string, TrendState, EntrySide, PatternCode];
    const cell = cells.get(`${tfStr}|${trend}|${side}`);
    if (!cell || cell.n === 0) continue;

    const baseRate = cell.wins / cell.n;
    const rate = b.wins / b.n;

    const se = Math.sqrt((baseRate * (1 - baseRate)) / b.n);
    const p = se > 0 ? normalP((rate - baseRate) / se) : 1;

    const base1 = cell.n1 > 0 ? cell.w1 / cell.n1 : null;
    const base2 = cell.n2 > 0 ? cell.w2 / cell.n2 : null;
    const h1 = b.n1 >= 30 ? b.w1 / b.n1 : null;
    const h2 = b.n2 >= 30 ? b.w2 / b.n2 : null;

    // "Consistente" es deliberadamente estricto: las dos mitades tienen que ir
    // en el mismo sentido que el total. Si una mitad sube y la otra baja, el
    // resultado global lo esta decidiendo un tramo concreto del historico.
    const dir = Math.sign(rate - baseRate);
    const consistent =
      h1 !== null && h2 !== null && base1 !== null && base2 !== null && dir !== 0 &&
      Math.sign(h1 - base1) === dir && Math.sign(h2 - base2) === dir;

    const trendDir = trend === 'ALCISTA' ? 1 : trend === 'BAJISTA' ? -1 : 0;
    const sideDir = side === 'LONG' ? 1 : -1;
    const patternBias = bias(pattern, [{ ts: 0, o: 0, h: 1, l: 0, c: 1 }], 0);

    rows.push({
      timeframe: Number(tfStr),
      pattern,
      patternLabel: PATTERN_LABEL[pattern],
      trend,
      side,
      aligned: trendDir === 0 ? null : trendDir === sideDir,
      // Los patrones sin sesgo propio no opinan, y se marcan como tal.
      patternAgrees: patternBias === 0 ? null : patternBias === sideDir,
      samples: b.n,
      wins: b.wins,
      hitRate: Number(rate.toFixed(4)),
      baseline: Number(baseRate.toFixed(4)),
      baselineSamples: cell.n,
      edge: Number(((rate - baseRate) * 100).toFixed(1)),
      pValue: Number(p.toFixed(4)),
      qValue: 1,
      firstHalf: h1 === null ? null : Number(h1.toFixed(4)),
      secondHalf: h2 === null ? null : Number(h2.toFixed(4)),
      firstHalfN: b.n1,
      secondHalfN: b.n2,
      consistent,
    });
  }

  /**
   * Benjamini-Hochberg sobre las preguntas DISTINTAS, no sobre las filas.
   *
   * Cada combinacion aparece dos veces, una por lado, y las dos son la misma
   * pregunta: si comprar acierta el 60%, vender acierta el 40% por definicion.
   * Contarlas como dos pruebas infla el numero de pruebas al doble y hace la
   * correccion mas dura de lo que toca. Se corrige sobre una de cada par y la
   * otra hereda el mismo q.
   */
  const unique = new Map<string, GridRow[]>();
  for (const r of rows) {
    const k = `${r.timeframe}|${r.trend}|${r.pattern}`;
    const list = unique.get(k);
    if (list) list.push(r);
    else unique.set(k, [r]);
  }

  const questions = [...unique.values()];
  const m = questions.length;

  questions.sort((a, b) => a[0]!.pValue - b[0]!.pValue);

  let prev = 1;
  for (let i = questions.length - 1; i >= 0; i--) {
    const group = questions[i]!;
    const q = Math.min(prev, (group[0]!.pValue * m) / (i + 1));
    const value = Number(Math.min(1, q).toFixed(4));
    for (const r of group) r.qValue = value;
    prev = q;
  }

  rows.sort((a, b) => a.qValue - b.qValue || b.samples - a.samples);

  // Se cuentan preguntas, no filas, por lo mismo que arriba.
  const rawHits = questions.filter((g) => g[0]!.pValue < 0.05).length;
  const survivors = questions.filter((g) => g[0]!.qValue < 0.05).length;

  const report: GridReport = {
    symbol: sym,
    targetTicks,
    horizonMin,
    timeframes,
    tested: m,
    expectedByChance: Number((m * 0.05).toFixed(1)),
    rawHits,
    survivors,
    consistentSurvivors: questions.filter((g) => g[0]!.qValue < 0.05 && g.some((r) => r.consistent))
      .length,
    rows,
  };

  cache.set(key, report);
  return report;
}
