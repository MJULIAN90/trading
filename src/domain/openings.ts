import { db } from '../db/index.js';
import { normalizeSymbol } from './bars.js';
import { instrumentOf } from './instruments.js';
import { SESSIONS, marketDate, marketHour, type SessionName } from './sessions.js';

/**
 * Como se comporta el precio en la APERTURA de cada killzone.
 *
 * Mide tres cosas distintas, y la tercera es la que motivo todo esto:
 *
 *   1. EXPANSION DE RANGO. Cuanto se ensancha el rango en los primeros minutos
 *      comparado con lo que venia haciendo. Dice cuanto stop pide esa apertura.
 *   2. BARRIDO. Si se lleva por delante el maximo o el minimo de la hora previa,
 *      y si luego se da la vuelta.
 *   3. LATIGAZO. Si barre los DOS lados en la misma ventana. Es la firma mas
 *      limpia de lo que se suele llamar manipulacion: sube, caza stops, baja,
 *      caza los otros.
 *
 * ------------------------------------------------------------------------
 * POR QUE LA LINEA BASE VA EMPAREJADA POR VOLATILIDAD
 * ------------------------------------------------------------------------
 *
 * Esta es la decision que sostiene toda la tabla, y sin ella mentiria.
 *
 * Comparando las aperturas contra momentos AL AZAR, el latigazo de NY AM sale
 * 23,8% contra 0,9%: z = 8,63, un efecto espectacular.
 *
 * Pero NY AM abre con 3,14 veces el rango normal. Con esa amplitud, romper los
 * dos extremos de la hora previa es mas facil por pura aritmetica, sin que
 * nadie manipule nada. Comparando contra momentos con LA MISMA expansion de
 * rango (3,08x), el control sube al 15,9% y la diferencia cae a z = 1,40.
 *
 * Dos tercios del "hallazgo" eran volatilidad.
 *
 * Por eso cada killzone se compara contra momentos de fuera de las aperturas
 * que tuvieron una expansion de rango parecida (±15%). Lo que sobreviva a esa
 * comparacion es lo que no se explica por amplitud.
 */

/** Minutos de referencia antes de la apertura. */
const PREV_MIN = 60;

/** Ventana de apertura que se analiza. */
const OPEN_MIN = 15;

/** Minutos despues de la ventana, para ver si el barrido se dio la vuelta. */
const AFTER_MIN = 45;

/** Cuantos controles se buscan por cada apertura. */
const MATCHES_PER_OPEN = 3;

/** Margen de expansion para considerar que un control "se parece". */
const MATCH_TOLERANCE = 0.15;

export interface OpeningStat {
  session: SessionName;
  /** Aperturas analizadas. Crece una por dia. */
  samples: number;

  /** Rango de la apertura dividido entre el rango tipico previo. */
  expansion: number;
  expansionLow: number;
  expansionHigh: number;

  /** Barrio el maximo de la hora previa (y no el minimo). */
  sweepHigh: number;
  /** De esos, cuantos cerraron por debajo otra vez. */
  sweepHighReversed: number;

  sweepLow: number;
  sweepLowReversed: number;

  /** Barrio los dos lados en la misma ventana. */
  whipsaw: number;
  whipsawRate: number;

  /** Mismo porcentaje en momentos de IGUAL volatilidad fuera de aperturas. */
  controlRate: number;
  controlSamples: number;

  /** Diferencia en puntos porcentuales y su p. */
  edge: number;
  p: number;
  /** Sobrevive a la correccion por numero de pruebas. */
  survives: boolean;
}

export interface OpeningsReport {
  symbol: string;
  prevMin: number;
  openMin: number;
  afterMin: number;
  rows: OpeningStat[];
}

interface Bar {
  ts: number;
  h: number;
  l: number;
  c: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/** Error complementario de Abramowitz-Stegun. El mismo que usa el resto del diario. */
function pValue(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 1 - y;
}

/** Perfil de una ventana que empieza en el indice `i`. Null si no hay sitio o faltan velas. */
function profile(bars: Bar[], i: number): {
  expansion: number;
  sweepHigh: boolean;
  sweepLow: boolean;
  reversedHigh: boolean;
  reversedLow: boolean;
} | null {
  const total = PREV_MIN + OPEN_MIN + AFTER_MIN;
  if (i < PREV_MIN || i + OPEN_MIN + AFTER_MIN >= bars.length) return null;

  const start = bars[i - PREV_MIN];
  const end = bars[i + OPEN_MIN + AFTER_MIN];
  if (!start || !end) return null;

  // Huecos: se tolera un 20% porque faltan minutos sueltos sin negociar, pero
  // una ventana que cruza el cierre diario no describe nada.
  if (end.ts - start.ts > total * 60_000 * 1.2) return null;

  let prevHigh = -Infinity;
  let prevLow = Infinity;
  for (let j = i - PREV_MIN; j < i; j++) {
    const b = bars[j];
    if (!b) continue;
    if (b.h > prevHigh) prevHigh = b.h;
    if (b.l < prevLow) prevLow = b.l;
  }

  let openHigh = -Infinity;
  let openLow = Infinity;
  for (let j = i; j < i + OPEN_MIN; j++) {
    const b = bars[j];
    if (!b) continue;
    if (b.h > openHigh) openHigh = b.h;
    if (b.l < openLow) openLow = b.l;
  }

  if (!Number.isFinite(prevHigh) || !Number.isFinite(openHigh)) return null;

  // La vara de medir: rango tipico de una ventana de 15 min en la hora previa.
  // Se toma la MEDIANA de varias ventanas solapadas y no el rango entero de la
  // hora, que seria tres veces mayor y haria que todo pareciera comprimido.
  const refs: number[] = [];
  for (let j = i - PREV_MIN; j <= i - OPEN_MIN; j += 5) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = j; k < j + OPEN_MIN; k++) {
      const b = bars[k];
      if (!b) continue;
      if (b.h > hi) hi = b.h;
      if (b.l < lo) lo = b.l;
    }
    if (Number.isFinite(hi) && hi > lo) refs.push(hi - lo);
  }

  const base = median(refs);
  if (base <= 0) return null;

  const close = end.c;

  return {
    expansion: (openHigh - openLow) / base,
    sweepHigh: openHigh > prevHigh,
    sweepLow: openLow < prevLow,
    reversedHigh: openHigh > prevHigh && close < prevHigh,
    reversedLow: openLow < prevLow && close > prevLow,
  };
}

export function openingStats(symbolInput?: string): OpeningsReport {
  const symbol =
    normalizeSymbol(symbolInput ?? '') ||
    ((
      db().prepare('SELECT symbol, COUNT(*) AS n FROM bars GROUP BY symbol ORDER BY n DESC').get() as
        | { symbol: string }
        | undefined
    )?.symbol ??
      '');

  const empty: OpeningsReport = {
    symbol,
    prevMin: PREV_MIN,
    openMin: OPEN_MIN,
    afterMin: AFTER_MIN,
    rows: [],
  };

  if (!symbol) return empty;

  const bars = db()
    .prepare('SELECT ts, h, l, c FROM bars WHERE symbol = ? ORDER BY ts')
    .all(symbol) as Bar[];

  if (bars.length < PREV_MIN + OPEN_MIN + AFTER_MIN + 10) return empty;

  // --- aperturas: la primera vela de cada dia en cada killzone ---------------

  const openIndexes = new Map<SessionName, number[]>();
  const seen = new Set<string>();

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (!bar) continue;

    const hour = marketHour(bar.ts);
    const day = marketDate(bar.ts);

    for (const s of SESSIONS) {
      // Media centesima de hora es menos de un minuto: solo casa con la vela
      // que abre la franja, no con la siguiente.
      if (Math.abs(hour - s.from) >= 0.009) continue;

      const key = `${day}|${s.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const list = openIndexes.get(s.name);
      if (list) list.push(i);
      else openIndexes.set(s.name, [i]);
    }
  }

  // --- controles: momentos LEJOS de cualquier apertura -----------------------

  const openHours = SESSIONS.map((s) => s.from);
  const controls: Array<{ expansion: number; whipsaw: boolean }> = [];

  for (let i = PREV_MIN; i < bars.length - OPEN_MIN - AFTER_MIN; i += 3) {
    const bar = bars[i];
    if (!bar) continue;

    const hour = marketHour(bar.ts);
    // Media hora larga de margen: un control pegado a la apertura heredaria
    // justo el comportamiento que se quiere usar como referencia neutra.
    if (openHours.some((h) => Math.abs(hour - h) < 0.6)) continue;

    const p = profile(bars, i);
    if (!p) continue;

    controls.push({ expansion: p.expansion, whipsaw: p.sweepHigh && p.sweepLow });
  }

  // --- una fila por killzone -------------------------------------------------

  const raw: Array<OpeningStat & { z: number }> = [];

  for (const s of SESSIONS) {
    const idx = openIndexes.get(s.name) ?? [];
    const profiles = idx.map((i) => profile(bars, i)).filter((p) => p !== null);

    if (profiles.length < 10) continue;

    const expansions = profiles.map((p) => p.expansion);

    // Intervalo por bootstrap. Con 30-60 aperturas una formula normal daria un
    // margen demasiado optimista para una mediana.
    const boot: number[] = [];
    let seed = 20261020;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let b = 0; b < 2000; b++) {
      const sample: number[] = [];
      for (let k = 0; k < expansions.length; k++)
        sample.push(expansions[Math.floor(rnd() * expansions.length)] ?? 0);
      boot.push(median(sample));
    }
    boot.sort((a, b) => a - b);

    const onlyHigh = profiles.filter((p) => p.sweepHigh && !p.sweepLow);
    const onlyLow = profiles.filter((p) => p.sweepLow && !p.sweepHigh);
    const whip = profiles.filter((p) => p.sweepHigh && p.sweepLow);

    // Control EMPAREJADO por expansion. Cada apertura busca sus parecidos y
    // ninguno se reutiliza, para no contar dos veces el mismo momento.
    const used = new Set<number>();
    const matched: boolean[] = [];

    for (const p of profiles) {
      const near = controls
        .map((c, k) => ({ k, d: Math.abs(c.expansion - p.expansion) }))
        .filter((x) => !used.has(x.k) && x.d <= p.expansion * MATCH_TOLERANCE)
        .sort((a, b) => a.d - b.d)
        .slice(0, MATCHES_PER_OPEN);

      for (const x of near) {
        used.add(x.k);
        matched.push(controls[x.k]?.whipsaw ?? false);
      }
    }

    const n = profiles.length;
    const rate = whip.length / n;
    const cN = matched.length;
    const cRate = cN > 0 ? matched.filter(Boolean).length / cN : 0;

    let z = 0;
    if (cN > 0) {
      const pooled = (whip.length + matched.filter(Boolean).length) / (n + cN);
      const se = Math.sqrt(pooled * (1 - pooled) * (1 / n + 1 / cN));
      if (se > 0) z = (rate - cRate) / se;
    }

    raw.push({
      session: s.name,
      samples: n,
      expansion: Number(median(expansions).toFixed(2)),
      expansionLow: Number((boot[Math.floor(0.025 * boot.length)] ?? 0).toFixed(2)),
      expansionHigh: Number((boot[Math.floor(0.975 * boot.length)] ?? 0).toFixed(2)),
      sweepHigh: onlyHigh.length,
      sweepHighReversed: onlyHigh.filter((p) => p.reversedHigh).length,
      sweepLow: onlyLow.length,
      sweepLowReversed: onlyLow.filter((p) => p.reversedLow).length,
      whipsaw: whip.length,
      whipsawRate: Number(rate.toFixed(4)),
      controlRate: Number(cRate.toFixed(4)),
      controlSamples: cN,
      edge: Number((rate - cRate).toFixed(4)),
      p: Number(pValue(z).toFixed(4)),
      survives: false,
      z,
    });
  }

  // Benjamini-Hochberg al 10%: son cinco pruebas a la vez, y sin corregir una
  // de cada cinco saldria "significativa" solo por haber mirado cinco veces.
  const ordered = [...raw].sort((a, b) => a.p - b.p);
  const m = ordered.length;
  for (let r = 0; r < m; r++) {
    const row = ordered[r];
    if (row && row.p <= (0.1 * (r + 1)) / m) row.survives = true;
  }

  return {
    symbol,
    prevMin: PREV_MIN,
    openMin: OPEN_MIN,
    afterMin: AFTER_MIN,
    rows: raw.map(({ z: _z, ...rest }) => rest),
  };
}
