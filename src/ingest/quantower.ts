import type { Database } from 'better-sqlite3';
import { REAL_TRADING_SINCE } from '../config.js';
import { db, openReadOnly } from '../db/index.js';
import { marketDate, marketHour, sessionOf } from '../domain/sessions.js';

/**
 * .NET DateTime cuenta en intervalos de 100 ns desde el ano 1. Este es el
 * numero de esos intervalos que hay hasta 1970, para pasar a epoch.
 */
const TICKS_AT_EPOCH = 621_355_968_000_000_000n;

function ticksToMs(ticks: bigint): number {
  return Number((ticks - TICKS_AT_EPOCH) / 10_000n);
}

interface RawFill {
  trade_id: string;
  symbol_id: string;
  account_id: string | null;
  time: bigint;
  price: number;
  quantity: number;
  side: number;
  gross_pnl_value: number | null;
  fee_value: number | null;
  order_type_id: string | null;
  order_id: string | null;
}

export interface IngestResult {
  fillsRead: number;
  fillsNew: number;
  operations: number;
  operationsNew: number;
}

/**
 * Lee la cache de Quantower y la vuelca en nuestra base.
 *
 * Las operaciones se arman por ciclos de posicion: una empieza cuando la
 * posicion neta sale de cero y termina cuando vuelve a cero. Emparejar
 * entradas con salidas por orden de llegada parece equivalente pero no lo es
 * en cuanto hay entradas parciales o se promedia a la baja, y produce
 * duraciones que no tienen nada que ver con la realidad.
 */
export function ingestQuantower(tradesDbPath: string): IngestResult {
  const source: Database = openReadOnly(tradesDbPath);
  const target = db();

  const rows = source
    .prepare(
      `SELECT trade_id, symbol_id, account_id, time, price, quantity, side,
              gross_pnl_value, fee_value, order_type_id, order_id
         FROM USER_TRADES
        ORDER BY time ASC`,
    )
    .safeIntegers(true)
    .all() as unknown as RawFill[];

  source.close();

  const insertFill = target.prepare(
    `INSERT OR IGNORE INTO fills
       (trade_id, symbol, account_id, ts, price, quantity, side, gross_pnl, fee, order_type, order_id)
     VALUES (@trade_id, @symbol, @account_id, @ts, @price, @quantity, @side, @gross_pnl, @fee, @order_type, @order_id)`,
  );

  const insertOp = target.prepare(
    `INSERT OR IGNORE INTO operations
       (symbol, opened_at, closed_at, direction, entry_price, exit_price, max_quantity,
        fills_count, gross_pnl, duration_sec, session, market_hour, is_real,
        account_id, first_fill_id, last_fill_id)
     VALUES (@symbol, @opened_at, @closed_at, @direction, @entry_price, @exit_price, @max_quantity,
             @fills_count, @gross_pnl, @duration_sec, @session, @market_hour, @is_real,
             @account_id, @first_fill_id, @last_fill_id)`,
  );

  let fillsNew = 0;
  let operations = 0;
  let operationsNew = 0;

  const run = target.transaction(() => {
    for (const r of rows) {
      const info = insertFill.run({
        trade_id: String(r.trade_id),
        symbol: r.symbol_id,
        account_id: r.account_id === null ? null : String(r.account_id),
        ts: ticksToMs(BigInt(r.time)),
        price: Number(r.price),
        quantity: Number(r.quantity),
        side: Number(r.side),
        gross_pnl: r.gross_pnl_value === null ? null : Number(r.gross_pnl_value),
        fee: r.fee_value === null ? null : Number(r.fee_value),
        order_type: r.order_type_id,
        order_id: r.order_id === null ? null : String(r.order_id),
      });
      if (info.changes > 0) fillsNew++;
    }

    // Reconstruccion de operaciones por ciclo de posicion.
    let position = 0;
    let current: {
      symbol: string;
      openedAt: number;
      direction: 'LONG' | 'SHORT';
      entryPrice: number;
      pnl: number;
      fills: number;
      maxQuantity: number;
      accountId: string | null;
      firstFillId: string;
    } | null = null;

    for (const r of rows) {
      const qty = Number(r.quantity);
      const side = Number(r.side);
      const signed = side === 0 ? qty : -qty;
      const ts = ticksToMs(BigInt(r.time));

      if (position === 0) {
        current = {
          symbol: r.symbol_id,
          openedAt: ts,
          direction: side === 0 ? 'LONG' : 'SHORT',
          entryPrice: Number(r.price),
          pnl: 0,
          fills: 0,
          maxQuantity: 0,
          // La cuenta se toma del fill que ABRE. Una operacion no cambia de
          // cuenta a mitad, y asi el dato viene del broker en vez de inferirse.
          accountId: r.account_id === null ? null : String(r.account_id),
          firstFillId: String(r.trade_id),
        };
      }

      if (!current) continue;

      position += signed;
      current.fills++;
      current.maxQuantity = Math.max(current.maxQuantity, Math.abs(position));
      if (r.gross_pnl_value !== null) current.pnl += Number(r.gross_pnl_value);

      if (position === 0) {
        operations++;
        const info = insertOp.run({
          symbol: current.symbol,
          opened_at: current.openedAt,
          closed_at: ts,
          direction: current.direction,
          entry_price: current.entryPrice,
          exit_price: Number(r.price),
          max_quantity: current.maxQuantity,
          fills_count: current.fills,
          gross_pnl: current.pnl,
          duration_sec: Math.round((ts - current.openedAt) / 1000),
          session: sessionOf(current.openedAt),
          market_hour: marketHour(current.openedAt),
          is_real: marketDate(current.openedAt) >= REAL_TRADING_SINCE ? 1 : 0,
          account_id: current.accountId,
          first_fill_id: current.firstFillId,
          last_fill_id: String(r.trade_id),
        });
        if (info.changes > 0) operationsNew++;
        current = null;
      }
    }

    target
      .prepare(
        `INSERT INTO ingest_runs (source, ran_at, rows_read, rows_new, cursor)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('quantower', Date.now(), rows.length, fillsNew, null);
  });

  run();

  return { fillsRead: rows.length, fillsNew, operations, operationsNew };
}
