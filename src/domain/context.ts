import { CONTEXT_BAR_SECONDS } from '../config.js';
import { db } from '../db/index.js';

/**
 * Lo que el indicador graba en cada cierre de vela. Son features crudas: la
 * interpretacion (absorcion, desequilibrio del libro, rango agotado) se calcula
 * aqui a partir de ellas, nunca se guarda ya resuelta.
 */
export interface Snapshot {
  ts: number;
  symbol: string;
  event: string;
  v?: number;
  /** Duracion real de la vela en segundos: 60 para graficos de un minuto. */
  barSeconds?: number;
  bar?: { o: number; h: number; l: number; c: number; range: number; tickSize: number };
  flow?: {
    buy: number;
    sell: number;
    delta: number;
    buyTrades: number;
    sellTrades: number;
    avgSize: number;
  } | null;
  baseline?: { avgRange: number; maxAbsDelta: number; avgTradeSize: number; bars: number };
  book?: {
    bidLevels: number;
    askLevels: number;
    bestBid: number;
    bestAsk: number;
    bidSize: number;
    askSize: number;
    topBidSize: number;
    topBidPrice: number;
    topAskSize: number;
    topAskPrice: number;
    changesActive: number;
    pulledLevels: number;
  } | null;
}

/**
 * Snapshot vigente en un instante: el ultimo cerrado ANTES de esa hora.
 *
 * Nunca el posterior, aunque este mas cerca en el tiempo. Una vela que cerro
 * despues de que abrieras contiene informacion que no existia cuando decidiste,
 * y colarla aqui contamina cualquier analisis posterior con datos del futuro.
 */
export function snapshotAt(
  ts: number,
  symbol?: string,
  maxAgeMs = 10 * 60_000,
  barSeconds: number | null = CONTEXT_BAR_SECONDS,
): Snapshot | null {
  // El filtro por temporalidad usa json_extract sobre el payload. Mantener
  // barSeconds dentro del JSON y no como columna propia permite anadir o
  // cambiar features sin migrar la tabla, que es justo lo que se busca aqui.
  const conditions = ['ts <= ?', 'ts >= ?'];
  const params: unknown[] = [ts, ts - maxAgeMs];

  if (symbol) {
    conditions.push('symbol = ?');
    params.push(symbol);
  }

  if (barSeconds !== null) {
    // Tolerancia de un 10%: las velas no siempre cierran en el segundo exacto.
    conditions.push('ABS(COALESCE(json_extract(payload, \'$.barSeconds\'), ?) - ?) <= ?');
    params.push(barSeconds, barSeconds, barSeconds * 0.1);
  }

  const row = db()
    .prepare(
      `SELECT payload FROM context_snapshots
        WHERE ${conditions.join(' AND ')}
        ORDER BY ts DESC LIMIT 1`,
    )
    .get(...params);

  if (!row) return null;

  try {
    return JSON.parse((row as { payload: string }).payload) as Snapshot;
  } catch {
    return null;
  }
}

export interface DerivedContext {
  /** Delta de la vela como fraccion del mayor delta reciente. */
  deltaRatio: number | null;
  /** Que tan de un solo lado estuvo la vela: |delta| / volumen total. */
  imbalance: number | null;
  /** Rango de la vela como fraccion del rango medio reciente. */
  rangeRatio: number | null;
  /** Tamano medio por operacion como multiplo de su propia media reciente. */
  tradeSizeRatio: number | null;
  /** Delta alto que no movio el precio, o que lo movio en contra. */
  absorption: boolean | null;
  /** Liquidez del libro cargada a un lado: >0 mas compra, <0 mas venta. */
  bookSkew: number | null;
  /** Niveles que acababan de vaciarse por completo. */
  pulledLevels: number | null;
}

/**
 * Deriva los indicadores interpretados a partir de las features crudas.
 *
 * Los umbrales viven aqui y no en el indicador justamente para poder cambiarlos
 * y recalcular todo el historico. Si manana decidimos que absorcion es otra
 * cosa, se toca esta funcion y los miles de snapshots ya grabados se releen con
 * la definicion nueva.
 */
export function derive(s: Snapshot | null, config = { absorptionDeltaRatio: 0.4, absorptionRangeRatio: 0.6 }): DerivedContext {
  const empty: DerivedContext = {
    deltaRatio: null,
    imbalance: null,
    rangeRatio: null,
    tradeSizeRatio: null,
    absorption: null,
    bookSkew: null,
    pulledLevels: null,
  };

  if (!s) return empty;

  const flow = s.flow ?? null;
  const base = s.baseline ?? null;
  const bar = s.bar ?? null;
  const book = s.book ?? null;

  const deltaRatio = flow && base && base.maxAbsDelta > 0 ? Math.abs(flow.delta) / base.maxAbsDelta : null;
  const total = flow ? flow.buy + flow.sell : 0;
  const imbalance = flow && total > 0 ? Math.abs(flow.delta) / total : null;
  const rangeRatio = bar && base && base.avgRange > 0 ? bar.range / base.avgRange : null;
  const tradeSizeRatio = flow && base && base.avgTradeSize > 0 ? flow.avgSize / base.avgTradeSize : null;

  let absorption: boolean | null = null;
  if (flow && bar && deltaRatio !== null) {
    const closedAgainst = (flow.delta > 0 && bar.c < bar.o) || (flow.delta < 0 && bar.c > bar.o);
    const tight = rangeRatio !== null && rangeRatio <= config.absorptionRangeRatio;
    absorption = deltaRatio >= config.absorptionDeltaRatio && (closedAgainst || tight);
  }

  const bookTotal = book ? book.bidSize + book.askSize : 0;
  const bookSkew = book && bookTotal > 0 ? (book.bidSize - book.askSize) / bookTotal : null;

  return {
    deltaRatio,
    imbalance,
    rangeRatio,
    tradeSizeRatio,
    absorption,
    bookSkew,
    pulledLevels: book ? book.pulledLevels : null,
  };
}
