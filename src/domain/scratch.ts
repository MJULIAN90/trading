import { db } from '../db/index.js';
import { normalizeSymbol } from './bars.js';
import { instrumentOf } from './instruments.js';
import type { EnrichedOperation } from './costs.js';

/**
 * Salidas en plano: las operaciones que cerraste practicamente a cero por salir
 * rapido para no dejar correr la perdida.
 *
 * La pregunta que contesta este modulo es "¿tenia razon la entrada?", y la
 * trampa es contestarla mirando solo lo que subio despues. Eso es mirar el
 * pasado sabiendo el final: aguantar significa aguantar TAMBIEN las que se van
 * en contra, y si solo se ensena el lado bueno el informe estaria empujando a
 * dejar correr perdidas, que es justo lo contrario de lo que hay que hacer.
 *
 * Por eso la medida principal no es cuanto llego a subir, sino una prueba
 * simetrica: desde el precio de ENTRADA, ¿que llego antes, +N ticks o -N ticks?
 * Esa pregunta lleva el riesgo incorporado y se puede contestar con un si o un
 * no. El recorrido maximo se informa aparte y como lo que es: un techo que nadie
 * captura, no una ganancia que estaba disponible.
 */

export interface ScratchConfig {
  /** Hasta cuantos ticks por contrato cuenta como "salida en plano". */
  maxTicks: number;
  /** Cuantos minutos se sigue mirando despues de cerrar. */
  horizonMinutes: number;
  /** El objetivo de la prueba simetrica, en ticks desde la entrada. */
  targetTicks: number;
}

export const DEFAULT_SCRATCH: ScratchConfig = { maxTicks: 4, horizonMinutes: 30, targetTicks: 20 };

export interface ScratchCase {
  id: number;
  openedAt: number;
  direction: string;
  quantity: number;
  ticks: number;
  session: string;
  /** Ticks que llego a dar a favor DESPUES de que salieras, medido desde la entrada. */
  afterFavourable: number;
  /** Ticks que llego a ir en contra despues de salir. */
  afterAdverse: number;
  /** 1 si llego al objetivo antes que al riesgo, -1 al reves, 0 si ninguno. */
  resolved: 1 | -1 | 0;
}

export interface ScratchReport {
  config: ScratchConfig;
  /** Operaciones planas encontradas, con y sin velas posteriores. */
  total: number;
  analyzed: number;
  /** Cuantas habrian alcanzado el objetivo antes que el riesgo. */
  wouldHaveWorked: number;
  wouldHaveFailed: number;
  unresolved: number;
  avgAfterFavourable: number | null;
  avgAfterAdverse: number | null;
  /** Lo que habrias ganado o perdido con la prueba simetrica, en ticks netos. */
  symmetricTicks: number | null;
  cases: ScratchCase[];
}

export function scratchReport(
  ops: EnrichedOperation[],
  config: ScratchConfig = DEFAULT_SCRATCH,
): ScratchReport {
  const flat = ops.filter((o) => o.ticks !== null && Math.abs(o.ticks) <= config.maxTicks);
  const cases: ScratchCase[] = [];

  const horizon = config.horizonMinutes * 60_000;

  for (const op of flat) {
    const spec = instrumentOf(op.symbol);
    if (!spec) continue;

    const rows = db()
      .prepare('SELECT h, l FROM bars WHERE symbol = ? AND ts BETWEEN ? AND ? ORDER BY ts')
      .all(normalizeSymbol(op.symbol), op.closed_at, op.closed_at + horizon) as Array<{
      h: number;
      l: number;
    }>;

    if (rows.length === 0) continue;

    const long = op.direction === 'LONG';
    let favourable = 0;
    let adverse = 0;
    let resolved: 1 | -1 | 0 = 0;

    for (const r of rows) {
      const fav = (long ? r.h - op.entry_price : op.entry_price - r.l) / spec.tickSize;
      const adv = (long ? op.entry_price - r.l : r.h - op.entry_price) / spec.tickSize;

      favourable = Math.max(favourable, fav);
      adverse = Math.max(adverse, adv);

      // Se decide con la PRIMERA vela que toca uno de los dos niveles. Dentro de
      // una misma vela no se sabe el orden, asi que si toca los dos a la vez se
      // cuenta como que salto el riesgo: es el supuesto conservador, y en una
      // medida que puede empujar a aguantar perdidas hay que equivocarse hacia
      // el lado prudente.
      if (resolved === 0) {
        if (adv >= config.targetTicks) resolved = -1;
        else if (fav >= config.targetTicks) resolved = 1;
      }
    }

    cases.push({
      id: op.id,
      openedAt: op.opened_at,
      direction: op.direction,
      quantity: op.max_quantity,
      ticks: op.ticks!,
      session: op.session,
      afterFavourable: Number(favourable.toFixed(1)),
      afterAdverse: Number(adverse.toFixed(1)),
      resolved,
    });
  }

  const avg = (xs: number[]) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)) : null);

  const wouldHaveWorked = cases.filter((c) => c.resolved === 1).length;
  const wouldHaveFailed = cases.filter((c) => c.resolved === -1).length;

  return {
    config,
    total: flat.length,
    analyzed: cases.length,
    wouldHaveWorked,
    wouldHaveFailed,
    unresolved: cases.filter((c) => c.resolved === 0).length,
    avgAfterFavourable: avg(cases.map((c) => c.afterFavourable)),
    avgAfterAdverse: avg(cases.map((c) => c.afterAdverse)),
    // El resultado de haber aguantado con ese objetivo y ese riesgo. Es una
    // cuenta simple a proposito: sin deslizamiento, sin comisiones, sin la
    // duda de si habrias aguantado de verdad.
    symmetricTicks: cases.length
      ? (wouldHaveWorked - wouldHaveFailed) * config.targetTicks
      : null,
    cases: cases.sort((a, b) => b.openedAt - a.openedAt),
  };
}
