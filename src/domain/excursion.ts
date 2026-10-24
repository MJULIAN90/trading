import { db } from '../db/index.js';
import { normalizeSymbol } from './bars.js';
import { instrumentOf } from './instruments.js';
import type { Operation } from './metrics.js';

/**
 * MAE y MFE: cuanto se fue en contra y cuanto a favor mientras la operacion
 * estaba abierta.
 *
 * Es la metrica que separa una buena entrada de un buen resultado. Una ganadora
 * que antes se fue 30 ticks en contra no fue una buena entrada, fue una entrada
 * mala que sobrevivio. Y una perdedora que llego a ir 20 ticks a favor no fue
 * mala entrada: fue mala gestion de la salida. Sin esto las dos se cuentan
 * simplemente como "gano" y "perdio", que es justo lo que impide corregir.
 *
 * Se calcula con las velas ya capturadas, no hace falta guardar nada nuevo.
 */

export interface Excursion {
  /** Ticks que llego a ir EN CONTRA desde el precio de entrada. Siempre >= 0. */
  mae: number | null;
  /** Ticks que llego a ir A FAVOR desde el precio de entrada. Siempre >= 0. */
  mfe: number | null;
  /** Que parte del recorrido favorable te llevaste: ticks finales / MFE. */
  capture: number | null;
  /**
   * Ticks que llegaste a tener y no te llevaste: MFE menos el resultado.
   *
   * Es la cifra que convierte "perdi 12 ticks" en "estuve 39 arriba y acabe 12
   * abajo, devolvi 51". Lo primero parece mala entrada; lo segundo es mala
   * salida, y se corrige de otra manera.
   */
  givenBack: number | null;
  /**
   * El resultado en ticks por contrato, con signo.
   *
   * Se expone para poder enseñarlo AL LADO del MFE. Las dos cifras se calculan
   * sobre el mismo conjunto de operaciones, asi que una se puede restar de la
   * otra; `givenBack` no, porque solo existe cuando el MFE fue mayor que cero
   * y por tanto su mediana sale de un grupo mas pequeño.
   */
  resultTicks: number | null;
  bars: number;
}

export function excursionOf(op: Operation): Excursion {
  const spec = instrumentOf(op.symbol);
  if (!spec) return { mae: null, mfe: null, capture: null, givenBack: null, resultTicks: null, bars: 0 };

  // El margen hacia atras es lo que hace que funcionen las operaciones cortas.
  // Una vela se guarda con la hora de su APERTURA, asi que una operacion que
  // abre y cierra dentro del mismo minuto no tiene ninguna vela con timestamp
  // entre medias: sin este margen, 13 de las 86 se quedaban sin MAE.
  const BAR_MARGIN_MS = 60_000;

  const row = db()
    .prepare(
      `SELECT MIN(l) AS low, MAX(h) AS high, COUNT(*) AS n
         FROM bars
        WHERE symbol = ? AND ts BETWEEN ? AND ?`,
    )
    .get(normalizeSymbol(op.symbol), op.opened_at - BAR_MARGIN_MS, op.closed_at) as
    | { low: number | null; high: number | null; n: number }
    | undefined;

  if (!row || row.low === null || row.high === null || row.n === 0) {
    return { mae: null, mfe: null, capture: null, givenBack: null, resultTicks: null, bars: 0 };
  }

  const long = op.direction === 'LONG';

  // En contra es hacia abajo si estas largo, hacia arriba si estas corto.
  const adversePoints = long ? op.entry_price - row.low : row.high - op.entry_price;
  const favourablePoints = long ? row.high - op.entry_price : op.entry_price - row.low;

  // Se recorta en cero: si el precio nunca fue en contra, el MAE es cero, no
  // un numero negativo que luego se lee como si hubiera ido a favor.
  const mae = Number((Math.max(0, adversePoints) / spec.tickSize).toFixed(1));
  const mfe = Number((Math.max(0, favourablePoints) / spec.tickSize).toFixed(1));

  const tickValue = spec.pointValue * spec.tickSize;
  const resultTicks = op.max_quantity > 0 ? op.gross_pnl / (tickValue * op.max_quantity) : 0;

  return {
    mae,
    mfe,
    capture: mfe > 0 ? Number((resultTicks / mfe).toFixed(2)) : null,
    givenBack: mfe > 0 ? Number(Math.max(0, mfe - resultTicks).toFixed(1)) : null,
    resultTicks: Number(resultTicks.toFixed(1)),
    bars: row.n,
  };
}

/**
 * Resumen de excursiones de un conjunto de operaciones, separando ganadoras de
 * perdedoras.
 *
 * Lo que hay que mirar: si el MAE medio de las GANADORAS se parece al de las
 * perdedoras, el stop no esta distinguiendo nada. Y si el MFE medio de las
 * perdedoras es alto, estabas en beneficio y lo devolviste.
 */
export function excursionSummary(ops: Operation[]) {
  const rows = ops
    .map((o) => ({ op: o, ex: excursionOf(o) }))
    .filter((r) => r.ex.mae !== null);

  const avg = (xs: number[]) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)) : null);

  const wins = rows.filter((r) => r.op.gross_pnl > 0);
  const losses = rows.filter((r) => r.op.gross_pnl <= 0);

  return {
    analyzed: rows.length,
    skipped: ops.length - rows.length,
    wins: {
      count: wins.length,
      avgMae: avg(wins.map((r) => r.ex.mae!)),
      avgMfe: avg(wins.map((r) => r.ex.mfe!)),
    },
    losses: {
      count: losses.length,
      avgMae: avg(losses.map((r) => r.ex.mae!)),
      avgMfe: avg(losses.map((r) => r.ex.mfe!)),
    },
    /** Beneficio no realizado medio de las perdedoras: lo que llegaste a tener y devolviste. */
    givenBack: avg(losses.filter((r) => r.ex.mfe! > 0).map((r) => r.ex.mfe!)),
  };
}
