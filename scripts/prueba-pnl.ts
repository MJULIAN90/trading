/**
 * Comprobacion del calculo del resultado de una operacion.
 *
 *   npx tsx scripts/prueba-pnl.ts
 *
 * Por que existe esta prueba y no otras. Hasta el 30 de octubre de 2026 el
 * diario sumaba el `gross_pnl` que escribe Quantower en cada ejecucion. Ese dia
 * el saldo del broker decia 301.490,50 y el diario 302.113,00, y la diferencia
 * -622,50- estaba en CUATRO ejecuciones del 28 de octubre que cerraban posicion
 * y a las que Quantower dejo el PnL a NULL. Cerrando cuarenta contratos a
 * mercado en dos segundos, se le escaparon cuatro.
 *
 * El diario no sumaba mal: sumaba fielmente un dato incompleto. Ahora el
 * resultado se calcula con los precios, y esto comprueba que ese calculo
 * aguanta los casos donde es facil equivocarse: entradas parciales, salidas en
 * trozos, vueltas de largo a corto y contratos desconocidos.
 *
 * Escribe en una base temporal, nunca en la tuya.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Antes de importar nada del diario: `config.ts` lee el entorno al cargarse.
process.env.JOURNAL_DB = join(mkdtempSync(join(tmpdir(), 'tj-pnl-')), 'prueba.db');

const { db } = await import('../src/db/index.js');
const { recomputarPnl } = await import('../src/ingest/quantower.js');

function check(nombre: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${nombre}${extra ? ' · ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

const d = db();

const COMPRA = 0;
const VENTA = 1;
let reloj = Date.UTC(2026, 9, 28, 13, 0, 0);
let id = 0;

/** Mete un fill. `pnl` a null imita lo que hace Quantower cuando se le escapa. */
function fill(symbol: string, side: number, qty: number, price: number, pnl: number | null) {
  id += 1;
  reloj += 1000;
  d.prepare(
    `INSERT INTO fills (trade_id, symbol, account_id, ts, price, quantity, side, gross_pnl)
     VALUES (?, ?, 'CUENTA', ?, ?, ?, ?, ?)`,
  ).run(String(id), symbol, reloj, price, qty, side, pnl);
  return String(id);
}

/**
 * Registra la operacion como la deja la ingesta: con el PnL del broker, que es
 * lo que habia antes. `recomputarPnl` tiene que corregirlo.
 */
function operacion(primero: string, ultimo: string, symbol: string, pnlBroker: number) {
  d.prepare(
    `INSERT INTO operations
       (symbol, opened_at, closed_at, direction, entry_price, exit_price, max_quantity,
        fills_count, gross_pnl, duration_sec, session, market_hour, is_real,
        account_id, first_fill_id, last_fill_id)
     VALUES (?, ?, ?, 'LONG', 0, 0, 1, 2, ?, 1, 'NY_AM', 10, 1, 'CUENTA', ?, ?)`,
  ).run(symbol, reloj, reloj, pnlBroker, primero, ultimo);
}

function pnlDe(primero: string): number {
  return (
    d.prepare('SELECT gross_pnl FROM operations WHERE first_fill_id = ?').get(primero) as {
      gross_pnl: number;
    }
  ).gross_pnl;
}

// --- 1. largo sencillo -------------------------------------------------------
// MNQ vale 2 $ el punto. Comprar 2 a 100 y vender 2 a 110 son 10 puntos x 2
// contratos x 2 $ = 40 $.
{
  const a = fill('MNQZ26', COMPRA, 2, 100, null);
  const b = fill('MNQZ26', VENTA, 2, 110, 40);
  operacion(a, b, 'MNQZ26', 40);
  recomputarPnl();
  check('largo sencillo', pnlDe(a) === 40, `${pnlDe(a)} USD`);
}

// --- 2. corto sencillo -------------------------------------------------------
{
  const a = fill('MNQZ26', VENTA, 1, 200, null);
  const b = fill('MNQZ26', COMPRA, 1, 190, 20);
  operacion(a, b, 'MNQZ26', 20);
  recomputarPnl();
  check('corto sencillo', pnlDe(a) === 20, `${pnlDe(a)} USD`);
}

// --- 3. entradas parciales ---------------------------------------------------
// Aqui es donde (salida - entrada) deja de valer: la entrada guardada es la del
// primer fill, 100, y la media real es 102. Comprado 1@100 y 1@104, vendido
// 2@110: (110-100)*2*2 = 40 $ seria lo que daria la resta, y la verdad es 32.
{
  const a = fill('MNQZ26', COMPRA, 1, 100, null);
  fill('MNQZ26', COMPRA, 1, 104, null);
  const c = fill('MNQZ26', VENTA, 2, 110, 32);
  operacion(a, c, 'MNQZ26', 32);
  recomputarPnl();
  check('entradas parciales (promediar a la baja)', pnlDe(a) === 32, `${pnlDe(a)} USD`);
}

// --- 4. el caso real: cierres con el PnL a NULL -------------------------------
// Largo de 4, salida en dos trozos y Quantower solo apunta uno. Comprado 4@100,
// vendido 2@90 y 2@80: (90-100)*2*2 + (80-100)*2*2 = -40 + -80 = -120 $. El
// broker solo suma los -40 del fill que si trae PnL.
{
  const a = fill('MNQZ26', COMPRA, 4, 100, null);
  fill('MNQZ26', VENTA, 2, 90, -40);
  const c = fill('MNQZ26', VENTA, 2, 80, null);
  operacion(a, c, 'MNQZ26', -40);

  check('de entrada el diario llevaba el numero del broker', pnlDe(a) === -40, `${pnlDe(a)} USD`);
  recomputarPnl();
  check('un cierre sin PnL ya no se pierde', pnlDe(a) === -120, `${pnlDe(a)} USD`);
  const fila = d
    .prepare('SELECT broker_pnl FROM operations WHERE first_fill_id = ?')
    .get(a) as { broker_pnl: number };
  check('y lo que decia el broker se guarda aparte', fila.broker_pnl === -40, `${fila.broker_pnl} USD`);
}

// --- 5. dar la vuelta dentro del ciclo ---------------------------------------
// Corto 2@100, compra 4@95 (cierra el corto con +20 $ y queda largo de 2),
// venta 2@105 (cierra el largo con +40 $). Son 60 $ y UNA sola operacion,
// porque la posicion no paso por cero en medio.
{
  const a = fill('MNQZ26', VENTA, 2, 100, null);
  fill('MNQZ26', COMPRA, 4, 95, 20);
  const c = fill('MNQZ26', VENTA, 2, 105, 40);
  operacion(a, c, 'MNQZ26', 60);
  recomputarPnl();
  check('vuelta de corto a largo sin pasar por plano', pnlDe(a) === 60, `${pnlDe(a)} USD`);
}

// --- 6. contrato que no esta en la tabla -------------------------------------
// Sin valor del punto no se puede calcular, y calcular con un multiplicador
// inventado seria peor que fiarse del broker. Se usa el del broker.
{
  const a = fill('XYZH27', COMPRA, 1, 100, null);
  const b = fill('XYZH27', VENTA, 1, 110, 777);
  operacion(a, b, 'XYZH27', 777);
  recomputarPnl();
  check('contrato desconocido: se respeta el PnL del broker', pnlDe(a) === 777, `${pnlDe(a)} USD`);
}

// --- 7. idempotencia ---------------------------------------------------------
// Corre en cada pasada de la ingesta, cada quince segundos. Si la segunda vez
// volviera a escribir, el WAL crecería sin parar por nada.
{
  const primera = recomputarPnl();
  const segunda = recomputarPnl();
  check('la segunda pasada no toca nada', primera === 0 && segunda === 0, `${primera} / ${segunda}`);
}

// --- 8. el total cuadra ------------------------------------------------------
{
  const t = d.prepare('SELECT ROUND(SUM(gross_pnl),2) s FROM operations').get() as { s: number };
  // 40 + 20 + 32 - 120 + 60 + 777
  check('el total de la base es la suma de los casos', t.s === 809, `${t.s} USD`);
}

console.log('\nbase temporal:', process.env.JOURNAL_DB);
