import type { Database } from 'better-sqlite3';
import { REAL_TRADING_SINCE } from '../config.js';
import { db, openReadOnly } from '../db/index.js';
import { instrumentOf } from '../domain/instruments.js';
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
  /** Operaciones que cambiaron de lado del corte de "operativa real". */
  restamped: number;
  /** Operaciones cuyo PnL se recalculo desde los precios. */
  repriced: number;
}

/**
 * Resultado de una operacion a partir UNICAMENTE de los precios de sus fills.
 *
 * Una operacion es un ciclo de posicion completo: empieza en plano y acaba en
 * plano. Eso hace que no haga falta emparejar entradas con salidas ni llevar
 * FIFO: basta el flujo de caja. Cada venta ingresa `cantidad x precio` y cada
 * compra lo paga; como al final no queda posicion abierta, lo que sobra ES el
 * resultado, en puntos x contrato. Multiplicado por el valor del punto, dolares.
 *
 * Y es exacto incluso con entradas parciales, promedios a la baja y salidas en
 * veinte trozos a precios distintos, que es justo donde `(salida - entrada)`
 * deja de valer porque los precios guardados son medias ponderadas.
 */
function pnlDePrecios(cashflow: number, symbol: string): number | null {
  const spec = instrumentOf(symbol);
  if (!spec) return null;
  return Number((cashflow * spec.pointValue).toFixed(2));
}

/** Flujo de caja de un fill, en puntos x contrato. Vender ingresa, comprar paga. */
function flujo(side: number, quantity: number, price: number): number {
  return (side === 0 ? -quantity : quantity) * price;
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
        fills_count, gross_pnl, broker_pnl, duration_sec, session, market_hour, is_real,
        account_id, first_fill_id, last_fill_id)
     VALUES (@symbol, @opened_at, @closed_at, @direction, @entry_price, @exit_price, @max_quantity,
             @fills_count, @gross_pnl, @broker_pnl, @duration_sec, @session, @market_hour, @is_real,
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

    // Un ciclo por cuenta Y simbolo. Antes habia una sola posicion global:
    // con dos cuentas o dos simbolos abiertos a la vez, los fills se mezclaban
    // y la "operacion" cerraba con precios de otro instrumento.
    interface Ciclo {
      position: number;
      current: {
        symbol: string;
        openedAt: number;
        direction: 'LONG' | 'SHORT';
        entryPrice: number;
        /** Lo que suma Quantower. Se guarda, pero ya no es lo que manda. */
        brokerPnl: number;
        /** Flujo de caja acumulado del ciclo, en puntos x contrato. */
        cash: number;
        fills: number;
        maxQuantity: number;
        accountId: string | null;
        firstFillId: string;
      } | null;
    }
    const ciclos = new Map<string, Ciclo>();

    for (const r of rows) {
      const qty = Number(r.quantity);
      const side = Number(r.side);
      const signed = side === 0 ? qty : -qty;
      const ts = ticksToMs(BigInt(r.time));

      // La clave separa por cuenta y simbolo: dos posiciones abiertas a la vez
      // son dos ciclos independientes, aunque sus fills lleguen intercalados.
      const clave = `${r.account_id ?? ''}|${r.symbol_id}`;
      let ciclo = ciclos.get(clave);
      if (!ciclo) {
        ciclo = { position: 0, current: null };
        ciclos.set(clave, ciclo);
      }

      if (ciclo.position === 0) {
        ciclo.current = {
          symbol: r.symbol_id,
          openedAt: ts,
          direction: side === 0 ? 'LONG' : 'SHORT',
          entryPrice: Number(r.price),
          brokerPnl: 0,
          cash: 0,
          fills: 0,
          maxQuantity: 0,
          // La cuenta se toma del fill que ABRE. Una operacion no cambia de
          // cuenta a mitad, y asi el dato viene del broker en vez de inferirse.
          accountId: r.account_id === null ? null : String(r.account_id),
          firstFillId: String(r.trade_id),
        };
      }

      if (!ciclo.current) continue;
      const current = ciclo.current;

      ciclo.position += signed;
      current.fills++;
      current.maxQuantity = Math.max(current.maxQuantity, Math.abs(ciclo.position));
      current.cash += flujo(side, qty, Number(r.price));
      if (r.gross_pnl_value !== null) current.brokerPnl += Number(r.gross_pnl_value);

      if (ciclo.position === 0) {
        operations++;
        // Los precios mandan. El broker solo es el respaldo para un contrato
        // que no este en la tabla de instrumentos, donde no sabemos el valor
        // del punto y calcular seria inventar.
        const propio = pnlDePrecios(current.cash, current.symbol);
        const info = insertOp.run({
          symbol: current.symbol,
          opened_at: current.openedAt,
          closed_at: ts,
          direction: current.direction,
          entry_price: current.entryPrice,
          exit_price: Number(r.price),
          max_quantity: current.maxQuantity,
          fills_count: current.fills,
          gross_pnl: propio ?? current.brokerPnl,
          broker_pnl: current.brokerPnl,
          duration_sec: Math.round((ts - current.openedAt) / 1000),
          session: sessionOf(current.openedAt),
          market_hour: marketHour(current.openedAt),
          is_real: marketDate(current.openedAt) >= REAL_TRADING_SINCE ? 1 : 0,
          account_id: current.accountId,
          first_fill_id: current.firstFillId,
          last_fill_id: String(r.trade_id),
        });
        if (info.changes > 0) operationsNew++;
        ciclo.current = null;
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

  const resellado = restampReal();
  const recalculadas = recomputarPnl();

  return {
    fillsRead: rows.length,
    fillsNew,
    operations,
    operationsNew,
    restamped: resellado,
    repriced: recalculadas,
  };
}

/**
 * Recalcula el PnL de TODAS las operaciones desde los precios, y devuelve
 * cuantas cambiaron.
 *
 * Hace falta por lo mismo que `restampReal`: las operaciones entran con
 * `INSERT OR IGNORE`, asi que una fila ya guardada no se vuelve a tocar nunca.
 * Sin esto, el calculo nuevo solo valdria para lo que se opere a partir de
 * ahora y las 573 operaciones de octubre se quedarian con la suma vieja.
 *
 * Reconstruye los MISMOS ciclos de posicion que la ingesta -mismo orden, misma
 * regla de plano a plano- y cruza por `first_fill_id`, que es unico. Si un
 * ciclo no encuentra su operacion no inventa ninguna: eso significaria que los
 * ciclos ya no salen igual, y es mejor que se note al comparar los totales que
 * arreglarlo a ciegas aqui.
 */
export function recomputarPnl(): number {
  const target = db();

  // El mismo orden que trae `USER_TRADES`: por hora, y a igualdad de hora por
  // orden de insercion, que es el de llegada. Con cuarenta ejecuciones en el
  // mismo segundo, cualquier otro desempate moveria las fronteras de los ciclos.
  const fills = target
    .prepare(
      `SELECT trade_id, symbol, ts, price, quantity, side, gross_pnl
         FROM fills ORDER BY ts ASC, rowid ASC`,
    )
    .all() as Array<{
    trade_id: string;
    symbol: string;
    ts: number;
    price: number;
    quantity: number;
    side: number;
    gross_pnl: number | null;
  }>;

  const update = target.prepare(
    'UPDATE operations SET gross_pnl = ?, broker_pnl = ? WHERE first_fill_id = ?',
  );

  let position = 0;
  let cash = 0;
  let broker = 0;
  let primero: string | null = null;
  let symbol = '';
  let cambiadas = 0;

  target.transaction(() => {
    for (const f of fills) {
      if (position === 0) {
        primero = f.trade_id;
        symbol = f.symbol;
        cash = 0;
        broker = 0;
      }

      position += f.side === 0 ? f.quantity : -f.quantity;
      cash += flujo(f.side, f.quantity, f.price);
      if (f.gross_pnl !== null) broker += f.gross_pnl;

      if (position === 0 && primero !== null) {
        const propio = pnlDePrecios(cash, symbol);
        const anterior = target
          .prepare('SELECT gross_pnl, broker_pnl FROM operations WHERE first_fill_id = ?')
          .get(primero) as { gross_pnl: number; broker_pnl: number | null } | undefined;

        if (anterior) {
          const nuevo = propio ?? broker;
          // Solo se escribe si de verdad cambia algo. Esto corre en cada pasada
          // de la ingesta, cada quince segundos: 573 UPDATE que no cambian nada
          // ensucian el WAL sin motivo.
          if (anterior.gross_pnl !== nuevo || anterior.broker_pnl !== broker) {
            update.run(nuevo, broker, primero);
            cambiadas++;
          }
        }
        primero = null;
      }
    }
  })();

  return cambiadas;
}

/**
 * Vuelve a sellar `is_real` en TODAS las operaciones segun la fecha de corte
 * actual, y devuelve cuantas cambiaron.
 *
 * Por que hace falta: las operaciones entran con `INSERT OR IGNORE`, asi que
 * una fila que ya existe no se toca nunca mas. Sin esto, mover la fecha de
 * corte no cambiaba ni una sola operacion ya guardada: el ajuste parecia
 * funcionar, las metricas seguian igual, y no habia forma de saber por que.
 *
 * El corte usa `marketDate`, el mismo dia de mercado que el resto de la
 * aplicacion. Con la fecha de calendario, lo operado entre las 18:00 y
 * medianoche del dia anterior al corte caeria del lado equivocado.
 */
export function restampReal(): number {
  const target = db();

  const filas = target
    .prepare('SELECT id, opened_at, is_real FROM operations')
    .all() as Array<{ id: number; opened_at: number; is_real: number }>;

  const update = target.prepare('UPDATE operations SET is_real = ? WHERE id = ?');
  let cambiadas = 0;

  target.transaction(() => {
    for (const f of filas) {
      const debe = marketDate(f.opened_at) >= REAL_TRADING_SINCE ? 1 : 0;
      if (debe !== f.is_real) {
        update.run(debe, f.id);
        cambiadas++;
      }
    }
  })();

  return cambiadas;
}
