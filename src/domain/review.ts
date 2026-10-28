import { derive, snapshotAt, type DerivedContext } from './context.js';
import type { Operation } from './metrics.js';
import { marketDate, marketHour } from './sessions.js';
import { SESSIONS } from './sessions.js';

/**
 * Motor de revision por operacion.
 *
 * Todo lo que sale de aqui es determinista y verificable: cada bandera dice un
 * hecho medible con su cifra al lado. No hay interpretacion ni narrativa, a
 * proposito. Una explicacion inventada sobre por que fallo una entrada se lee
 * igual de bien que una real, y eso es justo lo que la hace peligrosa.
 */

export type Severity = 'alert' | 'warn' | 'info' | 'good';

/**
 * Las banderas de DECISION solo miran lo que se podia saber al abrir. Las de
 * RESULTADO miran como acabo. Separarlas evita el sesgo de juzgar una entrada
 * por su desenlace: una buena decision puede perder y una mala puede ganar.
 */
export type FlagKind = 'decision' | 'outcome';

export interface Flag {
  code: string;
  kind: FlagKind;
  severity: Severity;
  title: string;
  detail: string;
}

export interface Review {
  operationId: number;
  flags: Flag[];
  /** Banderas de decision con severidad alta. Es el numero que conviene vigilar. */
  decisionAlerts: number;
}

export interface ReviewConfig {
  /** Minutos por debajo de los cuales una reentrada tras perder cuenta como reaccion. */
  revengeGapMinutes: number;
  /** A partir de cuantas perdidas seguidas se avisa. */
  lossStreakThreshold: number;
  /** Operaciones en un mismo dia a partir de las cuales se avisa. */
  tradesPerDayThreshold: number;
  /** Segundos por debajo de los cuales una operacion se considera sin recorrido. */
  scratchSeconds: number;
  /** Minutos desde el inicio de una sesion que cuentan como "la apertura". */
  openingMinutes: number;
}

export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  revengeGapMinutes: 2,
  lossStreakThreshold: 3,
  tradesPerDayThreshold: 12,
  scratchSeconds: 60,
  openingMinutes: 10,
};

/** Minutos desde el comienzo de la killzone a la que pertenece la operacion. */
function minutesIntoSession(op: Operation): number | null {
  const s = SESSIONS.find((x) => x.name === op.session);
  if (!s) return null;
  const h = marketHour(op.opened_at);
  const from = s.name === 'ASIA' && h < 12 ? s.from - 24 : s.from;
  return (h - from) * 60;
}

/**
 * Revisa toda la serie de operaciones en orden. Necesita la serie completa y no
 * cada operacion por separado porque casi todo lo que importa es relacional:
 * cuanto esperaste, cuantas llevabas, que paso justo antes.
 */
export function reviewOperations(
  ops: Operation[],
  config: ReviewConfig = DEFAULT_REVIEW_CONFIG,
): Map<number, Review> {
  const result = new Map<number, Review>();

  const losses = ops.filter((o) => o.gross_pnl < 0);
  const avgLoss = losses.length ? losses.reduce((a, o) => a + o.gross_pnl, 0) / losses.length : 0;

  const perDay = new Map<string, number>();
  for (const o of ops) {
    const d = marketDate(o.opened_at);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }

  let lossStreak = 0;
  const dayCounter = new Map<string, number>();

  ops.forEach((op, i) => {
    const flags: Flag[] = [];
    const prev = i > 0 ? ops[i - 1] : undefined;
    const day = marketDate(op.opened_at);
    const indexInDay = (dayCounter.get(day) ?? 0) + 1;
    dayCounter.set(day, indexInDay);

    // ---- banderas de decision ----

    if (prev && prev.gross_pnl <= 0) {
      const gap = (op.opened_at - prev.closed_at) / 60_000;
      if (gap <= config.revengeGapMinutes) {
        flags.push({
          code: 'revenge_entry',
          kind: 'decision',
          severity: 'alert',
          title: 'Reentrada inmediata tras perder',
          detail:
            `Abierta ${gap < 1 ? `${Math.round(gap * 60)} segundos` : `${gap.toFixed(1)} minutos`} ` +
            `despues de cerrar una perdida de ${prev.gross_pnl.toFixed(2)}.`,
        });
      }
    }

    /**
     * Insistir en el MISMO LADO despues de perder, dentro de la misma vela de
     * 15 minutos.
     *
     * LO QUE SE MIDIO, y por que la bandera no es "reentraste en la misma
     * vela". Esa regla general, sobre 375 operaciones, NO DA NADA: tomar solo
     * la primera de cada vela habria dado -1.413,50 frente a los -1.367,50
     * reales, la permutacion sale p=0,21, la mediana dice lo contrario que la
     * media, y el unico grupo positivo -las terceras entradas, +2.064,50- son
     * TRES operaciones de 692, 662 y 534. Sin ellas, +176 en 49.
     *
     * Lo que si separa es POR QUE se reentra:
     *
     *   tras perder, mismo lado ....... 109 ops   -13,77/op   mediana -29,00
     *   tras perder, lado contrario .... 38 ops    +7,42/op   mediana  -1,25
     *   tras ganar,  mismo lado ........ 22 ops    -5,14/op   mediana  +2,50
     *
     * La primera fila suma -1.500,50, mas que la perdida del periodo entero. Y
     * ahi la MEDIANA acompaña a la media, asi que no son cuatro operaciones
     * grandes: es el grupo entero. Aguanta el recorte de tres por punta
     * (-15,51 frente a -3,47 del resto).
     *
     * PROVISIONAL, y conviene que quede escrito. La permutacion da p=0,074,
     * por encima del 0,05 que se exige aqui. Y por cuartos vive en la primera
     * mitad: -39,40 y -33,66 en los dos primeros, +7,22 y +1,79 en los dos
     * ultimos. O ya se corrigio, o nunca estuvo. Repetir con noviembre antes
     * de darla por buena.
     *
     * Compara `gross_pnl` como las banderas vecinas; la medicion se hizo en
     * neto. La diferencia son dos ticks: mueve algun caso de borde, no el
     * grupo.
     */
    const MISMA_VELA_MS = 15 * 60_000;

    if (
      prev &&
      prev.gross_pnl <= 0 &&
      prev.direction === op.direction &&
      Math.floor(prev.opened_at / MISMA_VELA_MS) === Math.floor(op.opened_at / MISMA_VELA_MS)
    ) {
      const seg = Math.max(0, Math.round((op.opened_at - prev.closed_at) / 1000));
      flags.push({
        code: 'insist_same_candle',
        kind: 'decision',
        severity: 'alert',
        title: 'Insististe en el mismo lado tras perder',
        detail:
          `Perdiste ${prev.gross_pnl.toFixed(2)} y volviste a entrar en ` +
          `${op.direction === 'LONG' ? 'largo' : 'corto'} ${seg} segundos despues, ` +
          'dentro de la misma vela de 15 minutos.',
      });
    }

    if (lossStreak >= config.lossStreakThreshold) {
      flags.push({
        code: 'loss_streak',
        kind: 'decision',
        severity: 'alert',
        title: `Entrada con ${lossStreak} perdidas seguidas`,
        detail: 'Las rachas largas suelen venir de insistir en una lectura que el mercado ya rechazo.',
      });
    }

    if (prev && prev.direction !== op.direction) {
      const gap = (op.opened_at - prev.closed_at) / 60_000;
      if (gap <= config.revengeGapMinutes && prev.gross_pnl <= 0) {
        flags.push({
          code: 'direction_flip',
          kind: 'decision',
          severity: 'warn',
          title: 'Giro de direccion inmediato',
          detail: `Perdiste en ${prev.direction === 'LONG' ? 'largo' : 'corto'} y abriste en ` +
            `${op.direction === 'LONG' ? 'largo' : 'corto'} ${gap.toFixed(1)} minutos despues.`,
        });
      }
    }

    if (op.session === 'OUTSIDE') {
      flags.push({
        code: 'outside_killzone',
        kind: 'decision',
        severity: 'warn',
        title: 'Fuera de killzone',
        detail: 'La entrada cae fuera de las ventanas que marcas en el grafico.',
      });
    }

    const into = minutesIntoSession(op);
    if (into !== null && into >= 0 && into <= config.openingMinutes) {
      flags.push({
        code: 'session_opening',
        kind: 'decision',
        severity: 'info',
        title: 'Primeros minutos de la sesion',
        detail: `Abierta ${Math.round(into)} minutos despues de arrancar ${op.session.replace('_', ' ')}.`,
      });
    }

    if (indexInDay > config.tradesPerDayThreshold) {
      flags.push({
        code: 'overtrading',
        kind: 'decision',
        severity: 'warn',
        title: `Operacion numero ${indexInDay} del dia`,
        detail: `Por encima de las ${config.tradesPerDayThreshold} que te marcas como limite razonable.`,
      });
    }

    // ---- banderas que usan el contexto de los indicadores ----
    // Solo aparecen si habia un snapshot grabado antes de abrir. Mientras el
    // indicador no este capturando, esta seccion simplemente no produce nada.
    const ctx = derive(snapshotAt(op.opened_at, op.symbol));

    if (ctx.absorption === true) {
      const against =
        (ctx.deltaRatio ?? 0) > 0 &&
        ((op.direction === 'LONG' && (ctx.bookSkew ?? 0) < -0.2) ||
          (op.direction === 'SHORT' && (ctx.bookSkew ?? 0) > 0.2));
      flags.push({
        code: 'entry_into_absorption',
        kind: 'decision',
        severity: against ? 'alert' : 'warn',
        title: 'Entrada con absorcion en curso',
        detail:
          `La vela previa movio ${((ctx.deltaRatio ?? 0) * 100).toFixed(0)}% del mayor delta reciente ` +
          `con un rango del ${((ctx.rangeRatio ?? 0) * 100).toFixed(0)}% del habitual: alguien estaba absorbiendo.`,
      });
    }

    if (ctx.pulledLevels !== null && ctx.pulledLevels >= 3) {
      flags.push({
        code: 'book_pulled',
        kind: 'decision',
        severity: 'warn',
        title: 'Liquidez retirandose al entrar',
        detail: `${ctx.pulledLevels} niveles del libro se habian vaciado por completo justo antes.`,
      });
    }

    if (ctx.tradeSizeRatio !== null && ctx.tradeSizeRatio >= 2) {
      flags.push({
        code: 'big_players',
        kind: 'decision',
        severity: 'info',
        title: 'Tamano grande en el mercado',
        detail: `El tamano medio por operacion iba x${ctx.tradeSizeRatio.toFixed(1)} sobre lo normal.`,
      });
    }

    if (ctx.bookSkew !== null && Math.abs(ctx.bookSkew) >= 0.3) {
      const favor =
        (op.direction === 'LONG' && ctx.bookSkew > 0) || (op.direction === 'SHORT' && ctx.bookSkew < 0);
      flags.push({
        code: favor ? 'book_with_you' : 'book_against_you',
        kind: 'decision',
        severity: favor ? 'good' : 'warn',
        title: favor ? 'Libro cargado a tu favor' : 'Libro cargado en tu contra',
        detail:
          `${Math.abs(ctx.bookSkew * 100).toFixed(0)}% mas liquidez del lado ` +
          `${ctx.bookSkew > 0 ? 'comprador' : 'vendedor'} al abrir.`,
      });
    }

    // ---- banderas de resultado ----

    if (op.gross_pnl < 0 && avgLoss < 0 && op.gross_pnl <= avgLoss * 2) {
      flags.push({
        code: 'oversized_loss',
        kind: 'outcome',
        severity: 'alert',
        title: 'Perdida fuera de tamano',
        detail: `${op.gross_pnl.toFixed(2)} contra una perdida media de ${avgLoss.toFixed(2)}.`,
      });
    }

    if (op.duration_sec <= config.scratchSeconds && op.gross_pnl < 0) {
      flags.push({
        code: 'instant_stop',
        kind: 'outcome',
        severity: 'warn',
        title: 'Se fue en contra al instante',
        detail: `Duro ${op.duration_sec} segundos. El precio no llego a darte razon en ningun momento.`,
      });
    }

    if (op.gross_pnl > 0 && flags.every((f) => f.severity !== 'alert')) {
      flags.push({
        code: 'clean_win',
        kind: 'outcome',
        severity: 'good',
        title: 'Ganadora limpia',
        detail: 'Sin banderas de decision graves.',
      });
    }

    result.set(op.id, {
      operationId: op.id,
      flags,
      decisionAlerts: flags.filter((f) => f.kind === 'decision' && f.severity === 'alert').length,
    });

    lossStreak = op.gross_pnl <= 0 ? lossStreak + 1 : 0;
  });

  return result;
}

/** Cuantas veces salta cada bandera y cuanto P&L acumulan las operaciones que la llevan. */
export function flagImpact(ops: Operation[], reviews: Map<number, Review>) {
  const agg = new Map<string, { code: string; title: string; severity: Severity; count: number; pnl: number }>();

  for (const op of ops) {
    const r = reviews.get(op.id);
    if (!r) continue;
    for (const f of r.flags) {
      const cur = agg.get(f.code) ?? { code: f.code, title: f.title, severity: f.severity, count: 0, pnl: 0 };
      cur.count++;
      cur.pnl += op.gross_pnl;
      agg.set(f.code, cur);
    }
  }

  return [...agg.values()].sort((a, b) => a.pnl - b.pnl);
}
