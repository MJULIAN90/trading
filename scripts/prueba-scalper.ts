/**
 * Comprobacion del simulador de salida fija, con velas puestas a mano.
 *
 *   npx tsx scripts/prueba-scalper.ts
 *
 * Esta pantalla contesta "¿y si saliera siempre en el mismo numero de ticks?",
 * y la respuesta puede acabar cambiando como opera. Asi que lo que se
 * comprueba aqui no es que el codigo corra: es que **no infla el acierto**.
 * Tres formas de inflarlo, y las tres estan abajo:
 *
 *   - resolver la vela ambigua a favor. Si dentro del mismo minuto el precio
 *     toca el objetivo y el stop, no hay forma de saber cual fue primero. Si
 *     se mirara el objetivo antes que la ambiguedad, las configuraciones
 *     estrechas -que son las que mas ambiguas producen- saldrian preciosas.
 *   - contar como acierto lo que no se resolvio dentro del horizonte.
 *   - mirar velas ANTERIORES a la entrada.
 *
 * Escribe en una base temporal, nunca en la tuya.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.JOURNAL_DB = join(mkdtempSync(join(tmpdir(), 'tj-scalp-')), 'prueba.db');

const { db } = await import('../src/db/index.js');
const { scalperReport, simular } = await import('../src/domain/scalper.js');
import type { Operation } from '../src/domain/metrics.js';

function check(nombre: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${nombre}${extra ? ' · ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

const T0 = Date.UTC(2026, 9, 27, 14, 0, 0);
const ENTRADA = 29000;

/** Mete una vela de 1m en el minuto `n` desde la entrada. */
function vela(n: number, high: number, low: number) {
  db()
    .prepare(
      `INSERT OR REPLACE INTO bars (symbol, ts, o, h, l, c, tick_size)
       VALUES ('MNQZ26', ?, ?, ?, ?, ?, 0.25)`,
    )
    .run(T0 + n * 60_000, low, high, low, high);
}

let id = 0;
function op(direction: 'LONG' | 'SHORT', session = 'NY_AM', gross = 0, qty = 1): Operation {
  id += 1;
  return {
    id, symbol: 'F.US.MNQZ26', opened_at: T0, closed_at: T0 + 600_000,
    direction, entry_price: ENTRADA, exit_price: ENTRADA, max_quantity: qty,
    fills_count: 2, gross_pnl: gross, duration_sec: 600, session,
    market_hour: 10, is_real: 1, account_id: 'X',
  };
}

const CFG = { target: 20, stop: 60, horizonMin: 60 };
// 20 ticks = 5 puntos arriba. 60 ticks = 15 puntos abajo.
const OBJETIVO_LARGO = ENTRADA + 5;
const STOP_LARGO = ENTRADA - 15;

// --- sin velas ---------------------------------------------------------------
check('sin velas no se inventa un resultado', simular(op('LONG'), CFG) === 'sin_velas');

// --- objetivo limpio ---------------------------------------------------------
vela(1, ENTRADA + 1, ENTRADA - 1);
vela(2, OBJETIVO_LARGO, ENTRADA - 1);
check('largo que toca el objetivo', simular(op('LONG'), CFG) === 'ganada');

// --- el stop va primero en el tiempo ----------------------------------------
db().exec('DELETE FROM bars');
vela(1, ENTRADA + 1, STOP_LARGO);
vela(2, OBJETIVO_LARGO, ENTRADA);
check(
  'si el stop esta en una vela ANTERIOR, manda el stop',
  simular(op('LONG'), CFG) === 'perdida',
  'el orden temporal decide, no cual es mejor',
);

// --- la vela ambigua ---------------------------------------------------------
db().exec('DELETE FROM bars');
vela(1, OBJETIVO_LARGO, STOP_LARGO);
check(
  'una vela que toca objetivo Y stop es ambigua, no ganada',
  simular(op('LONG'), CFG) === 'ambigua',
  'es LA comprobacion de esta prueba',
);

// --- corto, en espejo --------------------------------------------------------
db().exec('DELETE FROM bars');
vela(1, ENTRADA + 1, ENTRADA - 5);
check('corto que toca el objetivo', simular(op('SHORT'), CFG) === 'ganada');

db().exec('DELETE FROM bars');
vela(1, ENTRADA + 15, ENTRADA + 1);
check('corto que toca el stop', simular(op('SHORT'), CFG) === 'perdida');

// --- el horizonte ------------------------------------------------------------
db().exec('DELETE FROM bars');
vela(1, ENTRADA + 1, ENTRADA - 1);
check('si no pasa nada, NO se resuelve', simular(op('LONG'), CFG) === 'sin_resolver');

// Y lo que ocurre PASADO el horizonte no cuenta.
vela(120, OBJETIVO_LARGO, OBJETIVO_LARGO);
check(
  'lo que pasa fuera del horizonte no cuenta como acierto',
  simular(op('LONG'), CFG) === 'sin_resolver',
  'con horizonte de 60 min y la vela buena en el 120',
);

// --- nada ANTES de la entrada ------------------------------------------------
db().exec('DELETE FROM bars');
vela(-30, OBJETIVO_LARGO, OBJETIVO_LARGO);
vela(1, ENTRADA + 1, ENTRADA - 1);
check(
  'una vela de media hora ANTES no da el objetivo por tocado',
  simular(op('LONG'), CFG) === 'sin_resolver',
  'sin esto habria mirada al futuro al reves',
);

// --- la cuenta de la expectativa --------------------------------------------
//
// Tres operaciones: dos ganan y una pierde. Con objetivo 20 y stop 60:
//   (20 x 2 - 60 x 1) / 3 = -20/3 = -6,67 ticks por operacion.
// Y el acierto es 2/3 = 66,7 %. Las dos cifras del mismo caso, para que se vea
// que un acierto de dos tercios puede perder dinero.
db().exec('DELETE FROM bars');
// Una sola vela que es objetivo para el largo y stop para el corto:
//   largo:  objetivo 29005 <= high 29015  y stop 28985 < low 28999  -> gana
//   corto:  objetivo 28995 <  low  28999  y stop 29015 <= high      -> pierde
vela(1, ENTRADA + 15, ENTRADA - 1);

const ganadoras = [op('LONG', 'ASIA'), op('LONG', 'ASIA')];
const perdedora = op('SHORT', 'ASIA');
const r = scalperReport([...ganadoras, perdedora], CFG);

check('dos de tres aciertan', r.total.aciertos === 2 && r.total.n === 3);
check('el acierto es del 66,7 %', Math.abs((r.total.hitPct ?? 0) - 2 / 3) < 0.001, `${((r.total.hitPct ?? 0) * 100).toFixed(1)}%`);
check(
  'y aun asi la expectativa es NEGATIVA',
  Math.abs((r.total.ticksPorOp ?? 0) + 20 / 3) < 0.01,
  `${r.total.ticksPorOp?.toFixed(2)} ticks/op`,
);
check('en dolares, a 0,50 el tick', Math.abs((r.total.usdPorOp ?? 0) + 10 / 3) < 0.01, `${r.total.usdPorOp}`);

// --- el reparto por sesion ---------------------------------------------------
const mezcla = [op('LONG', 'ASIA'), op('LONG', 'NY_AM'), op('LONG', 'NY_AM')];
const r2 = scalperReport(mezcla, CFG);
check('se agrupa por killzone', r2.porSesion.length === 2);
check(
  'y la sesion con mas operaciones va primero',
  r2.porSesion[0]?.session === 'NY_AM' && r2.porSesion[0]?.n === 2,
  r2.porSesion.map((f) => `${f.session}:${f.n}`).join(' '),
);

// --- el barrido --------------------------------------------------------------
check('el barrido recorre varios objetivos', r2.barrido.length >= 10);
check(
  'el barrido NO cambia el stop',
  r2.config.stop === CFG.stop,
  'si lo cambiara, la curva mezclaria dos cosas a la vez',
);

// --- el resultado real, que es la vara de medir ------------------------------
//
// 1 contrato de MNQ: el tick vale 0,50 $. Una operacion de +30 $ son 60 ticks.
const conResultado = [op('LONG', 'ASIA', 30, 1), op('LONG', 'ASIA', -10, 1)];
const r3 = scalperReport(conResultado, CFG);
check(
  'los ticks reales salen del PnL y del tamaño',
  Math.abs((r3.total.realTicksPorOp ?? 0) - (60 - 20) / 2) < 0.01,
  `${r3.total.realTicksPorOp?.toFixed(1)} ticks/contrato`,
);

console.log('\nbase temporal:', process.env.JOURNAL_DB);
