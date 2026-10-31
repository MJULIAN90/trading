import { barsWindow, normalizeSymbol } from './bars.js';
import { instrumentOf } from './instruments.js';
import type { Operation } from './metrics.js';

/**
 * "¿Y si saliera SIEMPRE en el mismo numero de ticks?"
 *
 * Coge tus entradas tal cual -las mismas, en el mismo instante- y les quita tu
 * gestion: pone un objetivo fijo y un stop fijo, y mira cual de los dos tocaba
 * primero. Lo que sale es el porcentaje de acierto que tendria esa regla sobre
 * TUS operaciones, por killzone, porque cada franja se mueve distinto.
 *
 * TRES COSAS QUE HAY QUE TENER DELANTE PARA QUE EL NUMERO SIGNIFIQUE ALGO:
 *
 * 1. EL ACIERTO SOLO NO DICE NADA. Un objetivo de 5 ticks con stop de 60
 *    acierta el 71,6 %, y pierde 13,5 ticks por operacion. Lo que decide es la
 *    expectativa: objetivo x aciertos menos stop x fallos.
 *
 * 2. LA VELA DE UN MINUTO NO SIEMPRE PUEDE DESEMPATAR. Si dentro del mismo
 *    minuto el precio toca el objetivo y el stop, no hay forma de saber cual
 *    fue primero. Esas se cuentan como PERDIDA -la hipotesis conservadora- y
 *    ademas se cuentan APARTE: con objetivo 10 y stop 10 son el 38 % de los
 *    casos, y a ese nivel el resultado ya no es una medicion, es el efecto de
 *    la regla de desempate. Por eso se enseña siempre el porcentaje de
 *    ambiguas al lado del acierto.
 *
 * 3. NO HAY MIRADA AL FUTURO. Solo se usan velas POSTERIORES a la entrada, y
 *    la entrada es la tuya, con su hora real. No se elige ningun momento
 *    bueno: se simula lo que habria pasado desde donde ya estabas dentro.
 *
 * Lo que esto NO contesta: si deberias haber entrado. Contesta solo que habria
 * pasado con la salida, dadas tus entradas.
 */

export type Resultado = 'ganada' | 'perdida' | 'ambigua' | 'sin_resolver' | 'sin_velas';

export interface ScalperConfig {
  /** Objetivo en ticks por contrato. */
  target: number;
  /** Stop en ticks por contrato. */
  stop: number;
  /** Cuanto se deja correr antes de darla por no resuelta, en minutos. */
  horizonMin: number;
}

export const DEFAULT_SCALPER: ScalperConfig = { target: 20, stop: 60, horizonMin: 180 };

/**
 * Que habria pasado con UNA operacion bajo la regla fija.
 *
 * El margen de un minuto hacia atras es el mismo de `excursionOf` y por el
 * mismo motivo: una vela se guarda con la hora de su APERTURA, asi que una
 * entrada a las 10:11:23 no tiene ninguna vela con marca entre 10:11:23 y
 * 10:12:00. Sin el margen, las operaciones cortas se quedaban sin velas.
 */
export function simular(op: Operation, cfg: ScalperConfig): Resultado {
  const spec = instrumentOf(op.symbol);
  if (!spec) return 'sin_velas';

  const desde = op.opened_at - 60_000;
  const hasta = op.opened_at + cfg.horizonMin * 60_000;
  const velas = barsWindow(normalizeSymbol(op.symbol), desde, hasta, 20_000);
  if (velas.length === 0) return 'sin_velas';

  const signo = op.direction === 'LONG' ? 1 : -1;
  const objetivo = op.entry_price + cfg.target * spec.tickSize * signo;
  const freno = op.entry_price - cfg.stop * spec.tickSize * signo;

  for (const v of velas) {
    const tocaObjetivo = signo > 0 ? v.h >= objetivo : v.l <= objetivo;
    const tocaStop = signo > 0 ? v.l <= freno : v.h >= freno;

    // El orden importa: la ambigua se comprueba ANTES que el acierto. Si se
    // mirara el objetivo primero, una vela que toca los dos saldria como
    // ganada y el resultado quedaria inflado justo en las configuraciones
    // estrechas, que son las que mas ambiguas producen.
    if (tocaObjetivo && tocaStop) return 'ambigua';
    if (tocaObjetivo) return 'ganada';
    if (tocaStop) return 'perdida';
  }

  return 'sin_resolver';
}

export interface ScalperFila {
  /** Killzone, o 'TOTAL'. */
  session: string;
  /** Operaciones que la regla resolvio: ganadas + perdidas + ambiguas. */
  n: number;
  aciertos: number;
  /** Porcentaje de acierto, de 0 a 1. null si no hay ninguna resuelta. */
  hitPct: number | null;
  /** Expectativa en ticks por contrato y operacion. */
  ticksPorOp: number | null;
  /** Lo mismo en dolares, con un contrato. */
  usdPorOp: number | null;
  /** Resoluciones que la vela de 1m no puede desempatar. Contadas como perdida. */
  ambiguas: number;
  /** De 0 a 1. Por encima de 0,15 el numero de arriba ya no es una medicion. */
  ambiguasPct: number | null;
  /** No llego ni a objetivo ni a stop dentro del horizonte. */
  sinResolver: number;
  sinVelas: number;
  /** Lo que de VERDAD sacaste tu en esa sesion, en ticks por contrato. */
  realTicksPorOp: number | null;
  realMediana: number | null;
}

/** Ticks por contrato que saco de verdad una operacion. */
function ticksReales(op: Operation): number | null {
  const spec = instrumentOf(op.symbol);
  if (!spec || op.max_quantity <= 0) return null;
  return op.gross_pnl / (spec.tickSize * spec.pointValue * op.max_quantity);
}

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function fila(session: string, ops: Operation[], cfg: ScalperConfig, previos?: Resultado[]): ScalperFila {
  let aciertos = 0;
  let fallos = 0;
  let ambiguas = 0;
  let sinResolver = 0;
  let sinVelas = 0;

  ops.forEach((op, i) => {
    const r = previos?.[i] ?? simular(op, cfg);
    if (r === 'ganada') aciertos += 1;
    else if (r === 'perdida') fallos += 1;
    else if (r === 'ambigua') { ambiguas += 1; fallos += 1; }
    else if (r === 'sin_resolver') sinResolver += 1;
    else sinVelas += 1;
  });

  const n = aciertos + fallos;
  const reales = ops.map(ticksReales).filter((x): x is number => x !== null);
  const spec = ops[0] ? instrumentOf(ops[0].symbol) : null;
  const valorTick = spec ? spec.tickSize * spec.pointValue : null;
  const ticks = n > 0 ? (cfg.target * aciertos - cfg.stop * fallos) / n : null;

  return {
    session,
    n,
    aciertos,
    hitPct: n > 0 ? aciertos / n : null,
    ticksPorOp: ticks,
    usdPorOp: ticks !== null && valorTick !== null ? Number((ticks * valorTick).toFixed(2)) : null,
    ambiguas,
    ambiguasPct: n > 0 ? ambiguas / n : null,
    sinResolver,
    sinVelas,
    realTicksPorOp: reales.length ? reales.reduce((a, b) => a + b, 0) / reales.length : null,
    realMediana: mediana(reales),
  };
}

export interface ScalperBarrido {
  target: number;
  hitPct: number | null;
  ticksPorOp: number | null;
  ambiguasPct: number | null;
}

export interface ScalperReport {
  config: ScalperConfig;
  total: ScalperFila;
  porSesion: ScalperFila[];
  /**
   * El mismo stop con objetivos de 5 en 5. Es lo que convierte una cifra
   * suelta en una curva, y lo que deja ver si hay MESETA -varios objetivos
   * vecinos que valen parecido, señal de que el efecto es real- o un unico
   * valor que funciona, que es la firma de la suerte.
   */
  barrido: ScalperBarrido[];
}

/** Objetivos del barrido. De 5 en 5 hasta 60, luego de 20 en 20. */
const OBJETIVOS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 80, 100];

export function scalperReport(ops: Operation[], cfg: ScalperConfig = DEFAULT_SCALPER): ScalperReport {
  const resultados = ops.map((op) => simular(op, cfg));

  const porSesion = new Map<string, Operation[]>();
  const porSesionRes = new Map<string, Resultado[]>();
  ops.forEach((op, i) => {
    const lista = porSesion.get(op.session) ?? [];
    const res = porSesionRes.get(op.session) ?? [];
    lista.push(op);
    res.push(resultados[i]!);
    porSesion.set(op.session, lista);
    porSesionRes.set(op.session, res);
  });

  const barrido: ScalperBarrido[] = OBJETIVOS.map((target) => {
    const f = fila('TOTAL', ops, { ...cfg, target });
    return { target, hitPct: f.hitPct, ticksPorOp: f.ticksPorOp, ambiguasPct: f.ambiguasPct };
  });

  return {
    config: cfg,
    total: fila('TOTAL', ops, cfg, resultados),
    // Por numero de operaciones y no alfabetico: con cuatro operaciones en
    // Londres y ciento noventa fuera de horario, el orden alfabetico pone
    // arriba justo la fila de la que no se puede decir nada.
    porSesion: [...porSesion.entries()]
      .map(([ses, lista]) => fila(ses, lista, cfg, porSesionRes.get(ses)))
      .sort((a, b) => b.n - a.n),
    barrido,
  };
}
