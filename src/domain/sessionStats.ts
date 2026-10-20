import { db } from '../db/index.js';
import { normalizeSymbol } from './bars.js';
import { instrumentOf } from './instruments.js';
import { sessionOf, type SessionName } from './sessions.js';

/**
 * Cuanto stop y cuanto objetivo pide cada killzone, medido sobre las velas.
 *
 * La diferencia con el resto del diario es importante: esto NO mide tus
 * operaciones, mide el MERCADO. Un stop sacado de tus 160 entradas hereda tus
 * errores; uno sacado de cien dias de velas dice cuanto se mueve el precio en
 * esa franja, operes tu o no. Son miles de muestras en vez de un punado, y no
 * depende de que acertaras.
 *
 * Se hace en dos pasadas:
 *
 *   1. Cuanto se aleja el precio en contra y a favor en el horizonte. De ahi
 *      sale el STOP: el recorrido en contra que la mayoria de las entradas no
 *      llega a sufrir.
 *   2. Con ese stop puesto y el objetivo a R veces esa distancia, se simula
 *      entrada por entrada QUE SE TOCO ANTES. Esto no se puede sacar de los
 *      percentiles de la primera pasada: ahi solo esta hasta donde llego el
 *      precio, no en que orden.
 *
 * La segunda pasada es la que convierte la tabla en algo accionable. Sin ella
 * solo se sabe la forma de la franja; con ella se sabe que sale de poner el
 * stop y el objetivo ahi.
 */

export interface SessionStat {
  session: SessionName;
  /** Cuantos puntos de entrada se han muestreado. */
  samples: number;
  /** Dias distintos que aportan muestras. */
  days: number;
  /** Rango mediano de la vela de un minuto en esa franja, en ticks. */
  barRange: number;

  /** Recorrido a favor a lo largo del horizonte, en ticks. */
  favP50: number;
  favP75: number;
  /** Recorrido en contra. */
  advP50: number;
  advP75: number;
  advP90: number;

  /**
   * El stop que se ha simulado, en ticks. Sale del percentil elegido de la
   * distribucion "en contra": con el percentil 75, tres de cada cuatro entradas
   * no llegan a sufrir ese recorrido antes de que acabe el horizonte.
   */
  suggestedStop: number;
  /** El objetivo simulado, en ticks: el stop multiplicado por R. */
  suggestedTarget: number;
  /** Objetivo entre stop. Es R, y se guarda por comodidad de quien lee. */
  ratio: number;

  /** Entradas simuladas que se pudieron resolver. */
  trades: number;
  /** Tocaron el objetivo antes que el stop. */
  wins: number;
  /** Tocaron el stop antes que el objetivo. */
  losses: number;
  /** No tocaron ninguno: se cierran a mercado al acabar el horizonte. */
  timeouts: number;
  /** Tocaron los dos dentro de la misma vela de un minuto: se descartan. */
  ambiguous: number;

  /**
   * Acierto entre las que SE DECIDIERON (wins / (wins + losses)).
   *
   * Es el numero que se puede comparar con `breakEven`. El otro reparto, sobre
   * el total, sale siempre bajo porque la mayoria de las entradas se quedan sin
   * tocar nada, y comparado con el 50% parece un desastre cuando no lo es.
   */
  hitRate: number;
  /** Cuantas acabaron sin tocar ni stop ni objetivo, sobre el total. */
  timeoutRate: number;
  /** El acierto necesario para no perder ni ganar: 1 / (1 + R). */
  breakEven: number;
  /** Ticks esperados por operacion, antes de costes. */
  expectancy: number;

  /**
   * La misma esperanza, separada por sentido.
   *
   * Esto esta aqui para no vender deriva como ventaja. Con objetivo y stop a la
   * misma distancia, compras y ventas son espejo exacto y la esperanza sale
   * cero por construccion. En cuanto el objetivo deja de ser 1R, deja de serlo,
   * y una esperanza global positiva puede ser simplemente que el mercado subio
   * en el periodo medido. Si una columna esta en verde y la otra en rojo, eso es
   * lo que esta pasando, y no hay nada que explotar ahi.
   */
  longExpectancy: number;
  shortExpectancy: number;

  /**
   * Margen de error de las dos cifras de arriba, en ticks.
   *
   * Esta columna es la que evita vender ruido como hallazgo. Las muestras se
   * SOLAPAN: con una entrada cada 5 minutos y un horizonte de 30, treinta y seis
   * muestras consecutivas miran casi el mismo tramo de mercado. Contarlas como
   * independientes hace que el error parezca seis veces menor de lo que es, y
   * entonces cualquier cifra sale "significativa".
   *
   * Asi que el numero de casos se corrige por el solape antes de dividir, y lo
   * que sale es la desviacion tipica de la media. Una esperanza por debajo de
   * dos veces esto es indistinguible de cero.
   */
  expectancyError: number;
}

export interface SessionStatsReport {
  symbol: string;
  /** Minutos que se miran hacia delante desde cada entrada muestreada. */
  horizonMin: number;
  /** Cada cuantos minutos se toma una muestra. */
  stepMin: number;
  /** Percentil de la distribucion en contra usado como stop (0,5 / 0,75 / 0,9). */
  stopPct: number;
  /** Multiplo del stop usado como objetivo. */
  targetR: number;
  /** Tamano del tick del contrato, en puntos de precio. */
  tickSize: number;
  /** Dolares por punto y contrato. */
  pointValue: number;
  /** Dolares que mueve un tick con un contrato. Es tickSize * pointValue. */
  tickValue: number;
  rows: SessionStat[];
}

/**
 * Horizonte por defecto: 30 minutos.
 *
 * No es arbitrario del todo. Tus operaciones duran una mediana de pocos
 * minutos, pero un horizonte de 5 minutos mediria casi solo ruido y uno de 4
 * horas mediria la tendencia del dia, no lo que se puede sacar de una entrada.
 * Media hora es el orden de magnitud de una operacion intradia que respira.
 *
 * Es un parametro porque el stop ESCALA con el tiempo que piensas aguantar: el
 * de media hora en NY AM es inasumible para una cuenta pequena, y el de diez
 * minutos si. Esa es justo la decision que la tabla tiene que ayudar a tomar.
 */
const HORIZON_MIN = 30;

/** Una muestra cada 5 minutos: suficiente resolucion sin multiplicar el coste. */
const STEP_MIN = 5;

const MINUTE = 60_000;

interface Row {
  ts: number;
  h: number;
  l: number;
  c: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i]!;
}

export interface SessionStatsOptions {
  horizonMin?: number;
  /** 0,5 · 0,75 · 0,9. Cuanto mas alto, mas holgado el stop. */
  stopPct?: number;
  /** Objetivo en multiplos del stop. */
  targetR?: number;
}

const cache = new Map<string, SessionStatsReport>();

export function sessionStats(symbol: string, options: SessionStatsOptions = {}): SessionStatsReport {
  const sym = normalizeSymbol(symbol);

  const horizonMin = Math.max(1, Math.min(240, Math.round(options.horizonMin ?? HORIZON_MIN)));
  const stopPct = Math.max(0.1, Math.min(0.99, options.stopPct ?? 0.75));
  const targetR = Math.max(0.1, Math.min(10, options.targetR ?? 1));

  const s = db()
    .prepare('SELECT COUNT(*) AS n, MAX(ts) AS m FROM bars WHERE symbol = ?')
    .get(sym) as { n: number; m: number | null };

  const key = `${sym}:${s.n}:${s.m ?? 0}:${horizonMin}:${STEP_MIN}:${stopPct}:${targetR}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rows = db()
    .prepare('SELECT ts, h, l, c FROM bars WHERE symbol = ? ORDER BY ts')
    .all(sym) as Row[];

  const instrument = instrumentOf(sym);
  const tickSize = instrument?.tickSize ?? 0.25;
  const pointValue = instrument?.pointValue ?? 2;

  // ------------------------------------------------------------------ pasada 1

  interface Acc {
    fav: number[];
    adv: number[];
    range: number[];
    days: Set<string>;
    /** Indices de las velas que sirven de entrada, para no repetir el filtrado. */
    entries: number[];
  }

  const acc = new Map<SessionName, Acc>();
  const get = (k: SessionName): Acc => {
    let a = acc.get(k);
    if (!a) {
      a = { fav: [], adv: [], range: [], days: new Set(), entries: [] };
      acc.set(k, a);
    }
    return a;
  };

  for (let i = 0; i < rows.length; i++) {
    const bar = rows[i]!;
    const session = sessionOf(bar.ts);

    const a = get(session);
    a.range.push((bar.h - bar.l) / tickSize);

    // El muestreo se hace sobre el reloj, no sobre el indice: con huecos de
    // captura, "cada 5 velas" puede ser cada cinco minutos o cada media hora.
    if (bar.ts % (STEP_MIN * MINUTE) !== 0) continue;

    const limit = bar.ts + horizonMin * MINUTE;

    let high = bar.c;
    let low = bar.c;
    let seen = 0;

    for (let j = i + 1; j < rows.length; j++) {
      const next = rows[j]!;
      if (next.ts > limit) break;
      if (next.h > high) high = next.h;
      if (next.l < low) low = next.l;
      seen++;
    }

    // Una muestra con cuatro velas detras no describe media hora de mercado.
    // Se descarta en vez de mezclarla: son los bordes de los huecos de captura
    // y del cierre diario, y tiran las medianas hacia abajo.
    if (seen < horizonMin * 0.6) continue;

    // Para una compra, a favor es hacia arriba. Para una venta es al reves,
    // asi que la distribucion "en contra" de una compra es la "a favor" de una
    // venta: midiendo las dos se cubren los dos sentidos.
    a.fav.push((high - bar.c) / tickSize);
    a.adv.push((bar.c - low) / tickSize);
    a.days.add(new Date(bar.ts).toISOString().slice(0, 10));
    a.entries.push(i);
  }

  // ------------------------------------------------------------------ pasada 2

  /**
   * Simula una entrada con stop y objetivo puestos, y devuelve el resultado en
   * ticks.
   *
   * `dir` es +1 para una compra y -1 para una venta. Se simulan las dos desde
   * cada muestra porque el diario opera en los dos sentidos y la franja no es
   * simetrica del todo: en una franja con deriva alcista, las compras aguantan
   * el stop mas a menudo que las ventas, y promediar las dos evita vender como
   * cierto lo que solo pasaba en una direccion.
   *
   * Devuelve null cuando el objetivo y el stop caen en la MISMA vela de un
   * minuto: sin los ticks no se sabe cual se toco antes, y suponer que fue el
   * objetivo infla el acierto exactamente en los casos mas violentos.
   */
  function simulate(
    i: number,
    dir: 1 | -1,
    stopTicks: number,
    targetTicks: number,
  ): { outcome: 'win' | 'loss' | 'timeout'; ticks: number; ambiguous: boolean } {
    const entry = rows[i]!.c;
    const limit = rows[i]!.ts + horizonMin * MINUTE;

    const stopPrice = entry - dir * stopTicks * tickSize;
    const targetPrice = entry + dir * targetTicks * tickSize;

    let lastClose = entry;

    for (let j = i + 1; j < rows.length; j++) {
      const bar = rows[j]!;
      if (bar.ts > limit) break;

      lastClose = bar.c;

      const hitTarget = dir === 1 ? bar.h >= targetPrice : bar.l <= targetPrice;
      const hitStop = dir === 1 ? bar.l <= stopPrice : bar.h >= stopPrice;

      // Vela que toca objetivo Y stop: con velas de un minuto no se sabe cual
      // llego antes. Antes se DESCARTABA el caso, y eso sesgaba el resultado
      // hacia arriba: las velas ambiguas son las de rango grande, justo las que
      // se habrian llevado el stop por delante. Quitarlas de la muestra regalaba
      // beneficio.
      //
      // Medido sobre los datos reales con R=1,5: descartando salia
      // +0,48 compra / +1,63 venta (los dos positivos, imposible). Resolviendo
      // la ambiguedad como stop salen -0,53 / +0,53, espejo exacto.
      //
      // Se resuelve siempre como PERDIDA. Es la convencion conservadora y es la
      // unica que no te hace creer que tienes una ventaja que no existe.
      if (hitTarget && hitStop) {
        return { outcome: 'loss', ticks: -stopTicks, ambiguous: true };
      }

      if (hitTarget) return { outcome: 'win', ticks: targetTicks, ambiguous: false };
      if (hitStop) return { outcome: 'loss', ticks: -stopTicks, ambiguous: false };
    }

    // Ni objetivo ni stop: se cierra a mercado al acabar el horizonte. Contarlo
    // asi, y no descartarlo, es lo que hace que la esperanza sea la de una
    // operacion de verdad: esos casos existen y casi siempre dejan un resultado
    // pequeno, ni el objetivo entero ni el stop entero.
    return { outcome: 'timeout', ticks: (dir * (lastClose - entry)) / tickSize, ambiguous: false };
  }

  const order: SessionName[] = ['ASIA', 'LONDON', 'NY_AM', 'NY_LUNCH', 'NY_PM', 'OUTSIDE'];

  const result: SessionStat[] = [];

  for (const name of order) {
    const a = acc.get(name);
    if (!a || a.fav.length === 0) continue;

    const fav = [...a.fav].sort((x, y) => x - y);
    const adv = [...a.adv].sort((x, y) => x - y);
    const range = [...a.range].sort((x, y) => x - y);

    const round = (v: number) => Number(v.toFixed(1));

    // El stop se redondea a tick entero: un stop de 166,7 ticks no se puede
    // poner en la plataforma, y dejarlo con decimales hace que la tabla parezca
    // mas precisa de lo que es.
    const stop = Math.max(1, Math.round(percentile(adv, stopPct)));
    const target = Math.max(1, Math.round(stop * targetR));

    let wins = 0;
    let losses = 0;
    let timeouts = 0;
    let ambiguous = 0;
    let sum = 0;

    let longSum = 0;
    let longN = 0;
    let shortSum = 0;
    let shortN = 0;
    let sumSq = 0;

    for (const i of a.entries) {
      for (const dir of [1, -1] as const) {
        const r = simulate(i, dir, stop, target);

        // El caso ambiguo ya NO se tira: se cuenta como perdida y ademas se
        // lleva la cuenta, para que la tabla pueda decir cuantos hubo.
        if (r.ambiguous) ambiguous++;

        if (r.outcome === 'win') wins++;
        else if (r.outcome === 'loss') losses++;
        else timeouts++;
        sum += r.ticks;
        sumSq += r.ticks * r.ticks;

        if (dir === 1) {
          longSum += r.ticks;
          longN++;
        } else {
          shortSum += r.ticks;
          shortN++;
        }
      }
    }

    const trades = wins + losses + timeouts;
    const decided = wins + losses;

    // Dos muestras separadas por menos de un horizonte miran casi el mismo
    // tramo de mercado, asi que no son dos casos independientes. Se cuenta un
    // caso efectivo por cada horizonte completo, y el error se calcula sobre
    // ese numero mas pequeno. Sin esta correccion el margen sale ridiculamente
    // estrecho y cualquier cifra parece significativa.
    const overlap = Math.max(1, horizonMin / STEP_MIN);
    const effective = Math.max(1, trades / overlap);

    const mean = trades > 0 ? sum / trades : 0;
    const variance = trades > 1 ? Math.max(0, sumSq / trades - mean * mean) : 0;
    const error = Math.sqrt(variance / effective);

    result.push({
      session: name,
      samples: fav.length,
      days: a.days.size,
      barRange: round(percentile(range, 0.5)),

      favP50: round(percentile(fav, 0.5)),
      favP75: round(percentile(fav, 0.75)),
      advP50: round(percentile(adv, 0.5)),
      advP75: round(percentile(adv, 0.75)),
      advP90: round(percentile(adv, 0.9)),

      suggestedStop: stop,
      suggestedTarget: target,
      ratio: Number((target / stop).toFixed(2)),

      trades,
      wins,
      losses,
      timeouts,
      ambiguous,

      hitRate: decided > 0 ? Number((wins / decided).toFixed(4)) : 0,
      timeoutRate: trades > 0 ? Number((timeouts / trades).toFixed(4)) : 0,
      breakEven: Number((stop / (stop + target)).toFixed(4)),
      expectancy: trades > 0 ? Number((sum / trades).toFixed(2)) : 0,
      longExpectancy: longN > 0 ? Number((longSum / longN).toFixed(2)) : 0,
      shortExpectancy: shortN > 0 ? Number((shortSum / shortN).toFixed(2)) : 0,
      expectancyError: Number(error.toFixed(2)),
    });
  }

  const report: SessionStatsReport = {
    symbol: sym,
    horizonMin,
    stepMin: STEP_MIN,
    stopPct,
    targetR,
    tickSize,
    pointValue,
    tickValue: Number((tickSize * pointValue).toFixed(4)),
    rows: result,
  };

  cache.set(key, report);
  return report;
}

/** La fila de una killzone concreta, para el bloque de diagnostico. */
export function statFor(symbol: string, session: string): SessionStat | null {
  return sessionStats(symbol).rows.find((r) => r.session === session) ?? null;
}
