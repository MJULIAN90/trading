import { db } from '../db/index.js';

/**
 * Derivacion de la tabla `bars` a partir de los snapshots crudos, y consulta de
 * ventanas de velas para reconstruir el grafico de una operacion.
 */

export interface Bar {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  delta: number | null;
  buy: number | null;
  sell: number | null;
  avgSize: number | null;
  maxOneTrade: number | null;
  typicalAbsDelta: number | null;
  avgRange: number | null;
  avgTradeSize: number | null;
  bookSkew: number | null;
  pulled: number | null;
}

/**
 * Quantower nombra las operaciones con el identificador completo del contrato
 * (`F.US.MNQZ26`) y el indicador escribe el nombre corto (`MNQZ26`). Sin esto,
 * cruzar operaciones con velas no encuentra nada y el grafico sale vacio sin
 * decir por que.
 */
export function normalizeSymbol(symbol: string): string {
  const parts = symbol.split('.');
  return (parts[parts.length - 1] ?? symbol).trim().toUpperCase();
}

function getMeta(key: string): string | null {
  const row = db().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

function setMeta(key: string, value: string): void {
  db()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

const CURSOR_KEY = 'bars_cursor_id';

/**
 * Pasa los snapshots nuevos a la tabla `bars`.
 *
 * Incremental por id de snapshot: los snapshots solo se anaden al final, nunca
 * se modifican, asi que basta con recordar hasta que id se llego. Reprocesar los
 * 111.000 en cada ingesta tardaria segundos cada 15, que es justo lo que hay que
 * evitar en algo que corre en bucle.
 *
 * `force` vuelve a empezar desde cero: util si se anade una columna nueva y hay
 * que rellenarla con lo que ya estaba guardado.
 */
export function refreshBars(force = false): { scanned: number; written: number } {
  const target = db();

  if (force) {
    target.exec('DELETE FROM bars');
    setMeta(CURSOR_KEY, '0');
  }

  const cursor = Number(getMeta(CURSOR_KEY) ?? '0');

  const rows = target
    .prepare(
      `SELECT id, ts, symbol, payload FROM context_snapshots
        WHERE id > ? AND event = 'bar_close'
        ORDER BY id`,
    )
    .all(cursor) as Array<{ id: number; ts: number; symbol: string; payload: string }>;

  if (rows.length === 0) return { scanned: 0, written: 0 };

  const insert = target.prepare(
    `INSERT INTO bars (
       symbol, ts, o, h, l, c, tick_size,
       buy, sell, delta, buy_trades, sell_trades, avg_size, max_one_trade,
       base_avg_range, base_max_abs_delta, base_typical_abs_delta, base_avg_trade_size,
       book_bid_size, book_ask_size, book_pulled
     ) VALUES (
       @symbol, @ts, @o, @h, @l, @c, @tick_size,
       @buy, @sell, @delta, @buy_trades, @sell_trades, @avg_size, @max_one_trade,
       @base_avg_range, @base_max_abs_delta, @base_typical_abs_delta, @base_avg_trade_size,
       @book_bid_size, @book_ask_size, @book_pulled
     )
     ON CONFLICT (symbol, ts) DO UPDATE SET
       o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c,
       buy = COALESCE(excluded.buy, bars.buy),
       sell = COALESCE(excluded.sell, bars.sell),
       delta = COALESCE(excluded.delta, bars.delta),
       max_one_trade = COALESCE(excluded.max_one_trade, bars.max_one_trade),
       base_typical_abs_delta = COALESCE(excluded.base_typical_abs_delta, bars.base_typical_abs_delta)`,
  );

  let written = 0;
  let lastId = cursor;

  const run = target.transaction(() => {
    for (const row of rows) {
      lastId = Math.max(lastId, row.id);

      let p: any;
      try {
        p = JSON.parse(row.payload);
      } catch {
        continue;
      }

      const bar = p?.bar;
      if (!bar || typeof bar.o !== 'number') continue;

      const flow = p.flow ?? null;
      const base = p.baseline ?? null;
      const book = p.book ?? null;

      insert.run({
        symbol: normalizeSymbol(row.symbol),
        ts: row.ts,
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c,
        tick_size: bar.tickSize ?? null,
        buy: flow?.buy ?? null,
        sell: flow?.sell ?? null,
        delta: flow?.delta ?? null,
        buy_trades: flow?.buyTrades ?? null,
        sell_trades: flow?.sellTrades ?? null,
        avg_size: flow?.avgSize ?? null,
        max_one_trade: flow?.maxOneTrade ?? null,
        base_avg_range: base?.avgRange ?? null,
        base_max_abs_delta: base?.maxAbsDelta ?? null,
        base_typical_abs_delta: base?.typicalAbsDelta ?? null,
        base_avg_trade_size: base?.avgTradeSize ?? null,
        book_bid_size: book?.bidSize ?? null,
        book_ask_size: book?.askSize ?? null,
        book_pulled: book?.pulledLevels ?? null,
      });

      written++;
    }

    setMeta(CURSOR_KEY, String(lastId));
  });

  run();

  return { scanned: rows.length, written };
}

/** Velas de un simbolo dentro de una ventana de tiempo, en orden cronologico. */
export function barsWindow(symbol: string, from: number, to: number, limit = 1500): Bar[] {
  const rows = db()
    .prepare(
      `SELECT ts, o, h, l, c, buy, sell, delta, avg_size, max_one_trade,
              base_typical_abs_delta, base_avg_range, base_avg_trade_size,
              book_bid_size, book_ask_size, book_pulled
         FROM bars
        WHERE symbol = ? AND ts BETWEEN ? AND ?
        ORDER BY ts
        LIMIT ?`,
    )
    .all(normalizeSymbol(symbol), from, to, limit) as any[];

  return rows.map((r) => {
    const bid = r.book_bid_size ?? 0;
    const ask = r.book_ask_size ?? 0;
    const total = bid + ask;

    return {
      ts: r.ts,
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
      delta: r.delta,
      buy: r.buy,
      sell: r.sell,
      avgSize: r.avg_size,
      maxOneTrade: r.max_one_trade,
      typicalAbsDelta: r.base_typical_abs_delta,
      avgRange: r.base_avg_range,
      avgTradeSize: r.base_avg_trade_size,
      bookSkew: total > 0 ? (bid - ask) / total : null,
      pulled: r.book_pulled,
    };
  });
}

/** Que simbolos tienen velas guardadas y cuantas. Para diagnosticar al vuelo. */
export function barsBySymbol(): Array<{ symbol: string; bars: number; from: number; to: number }> {
  return db()
    .prepare(
      `SELECT symbol, COUNT(*) AS bars, MIN(ts) AS "from", MAX(ts) AS "to"
         FROM bars GROUP BY symbol ORDER BY bars DESC`,
    )
    .all() as Array<{ symbol: string; bars: number; from: number; to: number }>;
}
