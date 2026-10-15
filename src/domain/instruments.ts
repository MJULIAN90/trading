/**
 * Especificacion de cada contrato: cuanto vale un punto y cuanto mide un tick.
 *
 * Sin esto no se puede hablar de ticks, y los ticks son la unidad en la que de
 * verdad se mide una operacion: 87 puntos no significa nada si no sabes si el
 * contrato mueve 2 $ o 20 $ por punto. Los dolares dependen del tamano de la
 * posicion; los ticks son la decision en si.
 */

export interface Instrument {
  root: string;
  name: string;
  tickSize: number;
  /** Dolares por punto y contrato. */
  pointValue: number;
}

/**
 * CQG nombra el Nasdaq grande como ENQ, no NQ. El micro es MNQ. Verificado
 * contra las operaciones reales: MNQ sale exactamente a 2,00 $ por punto.
 */
const TABLE: Record<string, Instrument> = {
  MNQ: { root: 'MNQ', name: 'Micro Nasdaq', tickSize: 0.25, pointValue: 2 },
  ENQ: { root: 'ENQ', name: 'E-mini Nasdaq', tickSize: 0.25, pointValue: 20 },
  NQ: { root: 'NQ', name: 'E-mini Nasdaq', tickSize: 0.25, pointValue: 20 },
  MES: { root: 'MES', name: 'Micro S&P 500', tickSize: 0.25, pointValue: 5 },
  EP: { root: 'EP', name: 'E-mini S&P 500', tickSize: 0.25, pointValue: 50 },
  ES: { root: 'ES', name: 'E-mini S&P 500', tickSize: 0.25, pointValue: 50 },
  MYM: { root: 'MYM', name: 'Micro Dow', tickSize: 1, pointValue: 0.5 },
  YM: { root: 'YM', name: 'E-mini Dow', tickSize: 1, pointValue: 5 },
  M2K: { root: 'M2K', name: 'Micro Russell', tickSize: 0.1, pointValue: 0.5 },
  RTY: { root: 'RTY', name: 'E-mini Russell', tickSize: 0.1, pointValue: 5 },
  MGC: { root: 'MGC', name: 'Micro Oro', tickSize: 0.1, pointValue: 10 },
  GC: { root: 'GC', name: 'Oro', tickSize: 0.1, pointValue: 100 },
};

/**
 * Quita el codigo de vencimiento del final: MNQZ26 -> MNQ, F.US.ENQZ26 -> ENQ.
 * El vencimiento son siempre una letra de mes mas dos digitos de ano.
 */
export function instrumentRoot(symbol: string): string {
  const parts = symbol.split('.');
  const short = (parts[parts.length - 1] ?? symbol).trim().toUpperCase();
  return short.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '') || short;
}

/**
 * Especificacion del contrato. Si no esta en la tabla devuelve null, y entonces
 * quien llame debe deducirla de los datos en vez de inventarse un numero: una
 * tabla de ticks equivocada falsea todas las metricas en silencio.
 */
export function instrumentOf(symbol: string): Instrument | null {
  return TABLE[instrumentRoot(symbol)] ?? null;
}

/**
 * Valor del punto deducido de la propia operacion.
 *
 * Es la red de seguridad para un contrato que no este en la tabla: el PnL que da
 * el broker es la verdad, asi que dividiendo entre puntos y contratos sale el
 * multiplicador real. Solo sirve si la operacion movio precio y no tuvo
 * entradas parciales, por eso se usa como respaldo y no como fuente principal.
 */
export function inferPointValue(
  entry: number,
  exit: number,
  direction: string,
  quantity: number,
  grossPnl: number,
): number | null {
  const points = (exit - entry) * (direction === 'LONG' ? 1 : -1);
  if (!points || !quantity) return null;

  const value = grossPnl / (points * quantity);
  return Number.isFinite(value) && value > 0 ? value : null;
}
