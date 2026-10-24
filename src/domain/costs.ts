import { db } from '../db/index.js';
import { instrumentOf } from './instruments.js';
import type { Operation } from './metrics.js';

/**
 * Comisiones y conversion a ticks.
 *
 * Quantower no graba las comisiones en la cuenta demo (la columna `fee` llega
 * vacia en las 315 ejecuciones), asi que se simulan. Y simularlas no es un
 * adorno: con 87 operaciones y 2,7 contratos de media, un dolar por contrato de
 * ida y vuelta son unos 230 $, que es mas de la mitad del resultado bruto. Una
 * estrategia puede parecer rentable en bruto y perder dinero en neto.
 */

export interface CostSettings {
  /** Dolares por contrato, ida y vuelta completa (comision + tasas). */
  commissionPerContract: number;

  /**
   * Perdida maxima de una jornada, en dolares y en positivo. 0 = apagado.
   *
   * Por que existe. En octubre el mes cerro en -1.471 $ y el dia 9, solo, hizo
   * -1.260 $: los otros trece dias operados suman -211 $ entre todos. Un dia
   * es el 86% de la perdida del mes. El diario sabia contarlo al dia
   * siguiente y no tenia forma de avisar durante.
   *
   * Se mide sobre la JORNADA de mercado -`marketDate`, que rueda a las 18:00
   * de Nueva York-, no sobre la fecha del calendario. Es el mismo corte que
   * usa la mesa de fondeo; con el corte a medianoche el 32% de las
   * operaciones caia en el dia equivocado y el limite no querria decir nada.
   */
  dailyLossLimit: number;
}

export const DEFAULT_COSTS: CostSettings = { commissionPerContract: 1, dailyLossLimit: 0 };

/** Numero valido y no negativo, o el que ya habia. */
function positivo(valor: unknown, actual: number): number {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : actual;
}

const KEY = 'cost_settings';

export function getCostSettings(): CostSettings {
  const row = db().prepare('SELECT value FROM meta WHERE key = ?').get(KEY) as { value: string } | undefined;
  if (!row) return { ...DEFAULT_COSTS };

  try {
    const parsed = JSON.parse(row.value) as Partial<CostSettings>;
    return {
      commissionPerContract: positivo(parsed.commissionPerContract, DEFAULT_COSTS.commissionPerContract),
      dailyLossLimit: positivo(parsed.dailyLossLimit, DEFAULT_COSTS.dailyLossLimit),
    };
  } catch {
    return { ...DEFAULT_COSTS };
  }
}

export function setCostSettings(settings: Partial<CostSettings>): CostSettings {
  const current = getCostSettings();

  const next: CostSettings = {
    commissionPerContract: positivo(settings.commissionPerContract, current.commissionPerContract),
    dailyLossLimit: positivo(settings.dailyLossLimit, current.dailyLossLimit),
  };

  db()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(KEY, JSON.stringify(next));

  return next;
}

/** Campos calculados que se anaden a cada operacion. */
export interface OperationCosts {
  /** Ticks por contrato: la decision en si, sin el tamano de la posicion. */
  ticks: number | null;
  /** Puntos por contrato. */
  points: number | null;
  tickValue: number | null;
  commission: number;
  netPnl: number;
  /** El bruto original, intacto, aunque gross_pnl pase a ser el neto. */
  rawGrossPnl: number;
}

export type EnrichedOperation = Operation & OperationCosts;

function ticksOf(op: Operation): { ticks: number | null; points: number | null; tickValue: number | null } {
  const spec = instrumentOf(op.symbol);
  if (!spec) return { ticks: null, points: null, tickValue: null };

  const tickValue = spec.pointValue * spec.tickSize;

  // Los ticks salen del PnL y no de (salida - entrada), porque con entradas
  // parciales los precios guardados son medias ponderadas y la resta no cuadra.
  // El PnL del broker si es exacto, asi que se invierte desde ahi.
  const perContract = op.max_quantity > 0 ? op.gross_pnl / (tickValue * op.max_quantity) : null;

  return {
    ticks: perContract === null ? null : Number(perContract.toFixed(1)),
    points: perContract === null ? null : Number((perContract * spec.tickSize).toFixed(2)),
    tickValue,
  };
}

/**
 * Anade costes y ticks a cada operacion.
 *
 * `basis` decide que va en `gross_pnl`. Puede sonar raro sobrescribir ese campo,
 * pero es deliberado: todas las metricas (resumen, agrupaciones, curva de
 * capital, rachas) leen `gross_pnl`, asi que cambiando la base aqui funcionan
 * tal cual sobre el neto sin tocar ni una de ellas. El bruto original queda
 * siempre en `rawGrossPnl`, nunca se pierde.
 */
export function applyCosts(
  ops: Operation[],
  settings: CostSettings = getCostSettings(),
  basis: 'gross' | 'net' = 'net',
): EnrichedOperation[] {
  return ops.map((op) => {
    const { ticks, points, tickValue } = ticksOf(op);

    // Ida y vuelta se cobra sobre el tamano maximo alcanzado: si escalaste a 4
    // contratos, pagaste 4 entradas y 4 salidas.
    const commission = Number((settings.commissionPerContract * op.max_quantity).toFixed(2));
    const netPnl = Number((op.gross_pnl - commission).toFixed(2));

    return {
      ...op,
      gross_pnl: basis === 'net' ? netPnl : op.gross_pnl,
      rawGrossPnl: op.gross_pnl,
      ticks,
      points,
      tickValue,
      commission,
      netPnl,
    };
  });
}

/** Totales de coste de un conjunto, para la cabecera del panel. */
export function costSummary(ops: EnrichedOperation[]) {
  const commission = ops.reduce((a, o) => a + o.commission, 0);
  const gross = ops.reduce((a, o) => a + o.rawGrossPnl, 0);
  const contracts = ops.reduce((a, o) => a + o.max_quantity, 0);
  const withTicks = ops.filter((o) => o.ticks !== null);

  return {
    operations: ops.length,
    contracts,
    grossPnl: Number(gross.toFixed(2)),
    commission: Number(commission.toFixed(2)),
    netPnl: Number((gross - commission).toFixed(2)),
    /** Que porcentaje del bruto se lleva la comision. Por encima del 30% el coste manda. */
    commissionShare: gross > 0 ? commission / gross : null,

    // Los totales van en ticks-contrato (ticks x contratos), no en ticks por
    // contrato. Sumar ticks por contrato de operaciones de distinto tamano da un
    // numero que no cuadra con los dolares: se puede tener el total de ticks en
    // negativo y el resultado en positivo si las ganadoras llevaban mas tamano.
    // Asi el total de ticks y el de dolares cuentan siempre la misma historia.
    ticksWon: Number(
      withTicks.filter((o) => o.ticks! > 0).reduce((a, o) => a + o.ticks! * o.max_quantity, 0).toFixed(1),
    ),
    ticksLost: Number(
      withTicks.filter((o) => o.ticks! <= 0).reduce((a, o) => a + o.ticks! * o.max_quantity, 0).toFixed(1),
    ),
    /** Media de ticks por contrato y operacion: la decision, sin el tamano. */
    avgTicksPerTrade: withTicks.length
      ? Number((withTicks.reduce((a, o) => a + o.ticks!, 0) / withTicks.length).toFixed(1))
      : null,
    /** Ticks que hay que sacar por contrato solo para cubrir la comision. */
    breakevenTicks: ops.length
      ? Number(
          (
            ops.reduce((a, o) => a + (o.tickValue ? getCostSettings().commissionPerContract / o.tickValue : 0), 0) /
            ops.length
          ).toFixed(1),
        )
      : 0,
  };
}
