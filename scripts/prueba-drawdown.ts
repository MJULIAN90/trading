/**
 * Comprobacion del drawdown por killzone, sin tocar tu base ni salir fuera.
 *
 *   npx tsx scripts/prueba-drawdown.ts
 *
 * Lo que de verdad se comprueba aqui es que el panel NO te venda un nivel de
 * parada que no existe. Cuatro formas de que eso pase, y las cuatro estan
 * abajo:
 *
 *   - el pico inicial. Si la curva de la franja arranca en la primera
 *     operacion en vez de en cero, una franja que empieza perdiendo 300 sale
 *     con drawdown cero, que es justo la que mas duele.
 *   - el cruce en la ULTIMA operacion. Ahi no seguiste, asi que no puede
 *     contar como "seguir dio esto": contarlo mete ceros en la media y empuja
 *     cualquier celda hacia "da igual seguir".
 *   - la comparacion sin base. "Despues de estar abajo gane -2 por operacion"
 *     no dice nada si tu media normal en esa franja ya es -2.
 *   - el p-valor que se mueve solo. Con semilla aleatoria, la misma celda sale
 *     0,04 y 0,06 en dos recargas y el color cambia al azar.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.JOURNAL_DB = join(mkdtempSync(join(tmpdir(), 'tj-dd-')), 'prueba.db');

const { sessionDrawdown, MIN_TRADES_AFTER } = await import('../src/domain/sessionDrawdown.js');
const { sessionOf, marketDate } = await import('../src/domain/sessions.js');
const type = await import('../src/domain/metrics.js');

type Operation = type.Operation;

function check(nombre: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${nombre}${extra ? ' · ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

let siguiente = 1;

/** Una operacion con la hora de Nueva York escrita tal cual. */
function op(fechaNY: string, horaNY: string, pnl: number, duracionMin = 2): Operation {
  // Octubre de 2026 cae en horario de verano de Nueva York: UTC-4.
  const opened = Date.parse(`${fechaNY}T${horaNY}:00-04:00`);
  const closed = opened + duracionMin * 60_000;

  return {
    id: siguiente++,
    symbol: 'MNQZ6',
    opened_at: opened,
    closed_at: closed,
    direction: 'LONG',
    entry_price: 25000,
    exit_price: 25000 + pnl / 2,
    max_quantity: 1,
    fills_count: 2,
    gross_pnl: pnl,
    duration_sec: duracionMin * 60,
    // La franja se sella en la ingesta a partir de la APERTURA. Aqui se usa la
    // misma funcion, para que la prueba falle si alguna de las dos cambia.
    session: sessionOf(opened),
    market_hour: 0,
    is_real: 0,
    account_id: null,
  };
}

const fila = (r: ReturnType<typeof sessionDrawdown>, s: string) => r.rows.find((x) => x.session === s);
const celda = (r: ReturnType<typeof sessionDrawdown>, s: string, u: number) =>
  r.cells.find((x) => x.session === s && x.threshold === u);

// --- 1. el drawdown arranca en cero, no en la primera operacion ------------------
//
// EL FALLO QUE ESTA PRUEBA EXISTE PARA EVITAR. Una franja que empieza perdiendo
// 300 y acaba en -300 tiene un drawdown de 300: estuviste 300 por debajo de tu
// mejor momento, que era el momento de sentarte. Si el pico arrancase en la
// primera operacion, el drawdown saldria 0 y la peor franja posible pareceria la
// mas tranquila.
{
  const r = sessionDrawdown([op('2026-10-19', '10:00', -300)]);
  const f = fila(r, 'NY_AM')!;
  check('una franja que solo pierde tiene drawdown, no cero', f.drawdownWorst === 300, `${f.drawdownWorst}`);
  check('y el resultado es el mismo numero en negativo', f.total === -300, `${f.total}`);
}

// --- 2. el drawdown se mide desde el pico, no desde cero -------------------------
{
  const r = sessionDrawdown([
    op('2026-10-19', '10:00', 500),
    op('2026-10-19', '10:10', -200),
    op('2026-10-19', '10:20', -100),
    op('2026-10-19', '10:30', 50),
  ]);
  const f = fila(r, 'NY_AM')!;
  check('el drawdown se mide desde el pico', f.drawdownWorst === 300, `${f.drawdownWorst}`);
  check('aunque la franja acabe en verde', f.total === 250 && f.greenDays === 1, `${f.total}`);
  check('la racha perdedora cuenta seguidas', f.worstStreak === 2, `${f.worstStreak}`);
}

// --- 3. un cero exacto cuenta como perdedora --------------------------------
{
  const r = sessionDrawdown([
    op('2026-10-19', '10:00', -10),
    op('2026-10-19', '10:10', 0),
    op('2026-10-19', '10:20', -10),
  ]);
  check('salir a cero no rompe la racha', fila(r, 'NY_AM')!.worstStreak === 3);
}

// --- 4. el cruce en la ULTIMA operacion no es "seguir" -----------------------
//
// Dos jornadas que cruzan el umbral de 25. En la primera el cruce es la ultima
// operacion -ahi paraste-, en la segunda queda una detras. `days` tiene que
// contar las dos y `daysWithRest` solo una: si la primera entrase en la media
// con su cero, la celda diria "seguir da 0" cuando lo que paso es que no
// seguiste.
{
  const r = sessionDrawdown([
    op('2026-10-19', '10:00', -50),
    op('2026-10-20', '10:00', -50),
    op('2026-10-20', '10:10', 80),
  ]);
  const c = celda(r, 'NY_AM', 25)!;
  check('las dos jornadas tocaron el umbral', c.days === 2, `${c.days}`);
  check('pero solo una siguio operando', c.daysWithRest === 1, `${c.daysWithRest}`);
  check('y solo cuenta la operacion de despues', c.tradesAfter === 1, `${c.tradesAfter}`);
  check('el dinero de despues es el de esa operacion', c.perTradeAfter === 80, `${c.perTradeAfter}`);
}

// --- 5. la comparacion es contra la base de la franja ------------------------
{
  const r = sessionDrawdown([
    op('2026-10-19', '10:00', -50),
    op('2026-10-19', '10:10', 80),
  ]);
  const f = fila(r, 'NY_AM')!;
  const c = celda(r, 'NY_AM', 25)!;
  check('la base es el resultado por operacion de la franja', c.baseline === f.perTrade, `${c.baseline} vs ${f.perTrade}`);
  check('y la diferencia es lo de despues menos la base', c.diff === Number((80 - 15).toFixed(2)), `${c.diff}`);
}

// --- 6. sin muestra no hay prueba -------------------------------------------
{
  const r = sessionDrawdown([
    op('2026-10-19', '10:00', -50),
    op('2026-10-19', '10:10', 80),
  ]);
  const c = celda(r, 'NY_AM', 25)!;
  check(`con 1 operacion detras (minimo ${MIN_TRADES_AFTER}) la celda no cuenta`, c.enough === false);
  check('y no se gasta una permutacion en ella', c.p === null);
  check('ni entra en el Benjamini-Hochberg', r.tested === 0 && r.survivors === 0);
  check('pero el numero se calcula igual, para poder enseñarlo en gris', c.perTradeAfter === 80);
}

// --- 7. la jornada rueda a las 18:00 de Nueva York ---------------------------
//
// Lo operado el lunes por la noche es la jornada del martes, igual que lo
// cuenta la mesa. Sin esto, una sesion de Asia aparece partida en dos dias y
// los dos drawdowns salen mas pequeños que el de verdad.
{
  check('las 19:00 del lunes son la jornada del martes',
    marketDate(Date.parse('2026-10-19T19:00:00-04:00')) === '2026-10-20');

  const r = sessionDrawdown([
    op('2026-10-19', '21:00', -200),
    op('2026-10-19', '23:00', -100),
    op('2026-10-20', '00:30', 50),
  ]);
  const f = fila(r, 'ASIA')!;
  check('las tres son la MISMA jornada de Asia', f.days === 1, `${f.days} jornadas`);
  check('y el drawdown es el de la sesion entera', f.drawdownWorst === 300, `${f.drawdownWorst}`);
}

// --- 8. Asia NO cruza medianoche --------------------------------------------
//
// Esto sorprende y conviene dejarlo escrito. La ventana de Asia del indicador
// KillZones va de 20:00 a 24:00, asi que a las 00:01 ya no estas en Asia: estas
// en hueco. El comentario de `sessions.ts` dice que Asia cruza medianoche y la
// condicion `h < 0` que lo implementaria no se cumple nunca —`marketHour`
// devuelve de 0 a 24—, o sea que es codigo muerto.
//
// No se toca: las ventanas son las del indicador y el indicador esta congelado.
// Pero importa saberlo, porque 37 de tus operaciones caen entre las 00:00 y las
// 02:00 y acaban en el cajon de "fuera", no en Asia.
{
  check('las 23:00 son Asia', sessionOf(Date.parse('2026-10-19T23:00:00-04:00')) === 'ASIA');
  check(
    'las 00:30 YA NO son Asia: la ventana del indicador acaba a medianoche',
    sessionOf(Date.parse('2026-10-20T00:30:00-04:00')) === 'OUTSIDE',
  );
  check('las 06:00 tampoco son ninguna', sessionOf(Date.parse('2026-10-20T06:00:00-04:00')) === 'OUTSIDE');
}

// --- 8b. los huecos entre franjas tienen nombre ------------------------------
//
// "OUTSIDE" no es un sitio: son cinco huecos distintos entre killzones, y se
// portan de forma muy distinta. Juntarlos en una fila esconde que la hora de
// despues de NY AM es la que mas dinero cuesta.
{
  const r = sessionDrawdown([
    op('2026-10-19', '11:15', -100),  // entre NY AM y el almuerzo
    op('2026-10-19', '13:15', 40),    // entre el almuerzo y NY PM
    op('2026-10-20', '00:30', 25),    // tras cerrar Asia
  ]);

  check('los huecos salen separados', r.gaps.length === 3, `${r.gaps.length}`);

  const g = (desde: number) => r.gaps.find((x) => x.from === desde);
  check('el de las 11 esta', g(11)?.total === -100, `${g(11)?.total}`);
  check('y lleva nombre, no un numero', (g(11)?.label ?? '').length > 0, g(11)?.label);
  check('el de medianoche esta aparte', g(0)?.total === 25, `${g(0)?.total}`);
  check('y el de las 13:00 tambien', g(13)?.total === 40, `${g(13)?.total}`);

  const suma = r.gaps.reduce((a, x) => a + x.total, 0);
  check('los huecos suman lo mismo que la fila de fuera', suma === fila(r, 'OUTSIDE')!.total, `${suma}`);
}

// --- 9. el drawdown encadenado es otra cosa que el peor dia ----------------------
//
// Tres jornadas que pierden 100 cada una. Ningun dia tiene un drawdown grande,
// pero la franja lleva 300 de drawdown acumulado. Las dos cifras tienen que salir
// distintas o el panel esconde justo el goteo.
{
  const r = sessionDrawdown([
    op('2026-10-19', '10:00', -100),
    op('2026-10-20', '10:00', -100),
    op('2026-10-21', '10:00', -100),
  ]);
  const f = fila(r, 'NY_AM')!;
  check('el peor drawdown de un dia son 100', f.drawdownWorst === 100, `${f.drawdownWorst}`);
  check('pero el encadenado son 300', f.chainedDrawdown === 300, `${f.chainedDrawdown}`);
  check('y lo dice en que jornada fue', f.drawdownWorstDay === '2026-10-19', `${f.drawdownWorstDay}`);
}

// --- 10. el limite diario -----------------------------------------------------
{
  const ops = [op('2026-10-19', '10:00', -150), op('2026-10-20', '10:00', -50)];
  check('sin limite puesto, la columna no existe', fila(sessionDrawdown(ops, 0), 'NY_AM')!.overLimit === null);
  check('con limite 100, una jornada lo cruza', fila(sessionDrawdown(ops, 100), 'NY_AM')!.overLimit === 1);
  check('con limite 200, ninguna', fila(sessionDrawdown(ops, 200), 'NY_AM')!.overLimit === 0);
}

// --- 11. el p-valor no se mueve solo -----------------------------------------
//
// Con semilla aleatoria, la misma celda sale 0,04 y 0,06 en dos recargas y el
// color cambia al azar. Dos informes del mismo material tienen que dar el
// mismo numero.
{
  const ops: Operation[] = [];
  for (let d = 0; d < 12; d++) {
    const dia = `2026-10-${String(5 + d).padStart(2, '0')}`;
    // Una jornada con drawdown y cola suficiente para que la celda cuente.
    ops.push(op(dia, '10:00', -80));
    for (let k = 0; k < 4; k++) ops.push(op(dia, `10:${String(10 + k * 5).padStart(2, '0')}`, k % 2 ? 30 : -20));
  }

  const a = celda(sessionDrawdown(ops, 0), 'NY_AM', 50)!;
  // Material distinto para esquivar la cache y volver a calcular de cero.
  const b = celda(sessionDrawdown([...ops].reverse(), 0), 'NY_AM', 50)!;

  check('la celda tiene muestra suficiente', a.enough === true, `${a.tradesAfter} operaciones detras`);
  check('el p-valor es el mismo en dos informes', a.p === b.p, `${a.p} vs ${b.p}`);
  check('y nunca es cero exacto', (a.p ?? 1) > 0, `${a.p}`);
  check('ni mayor que uno', (a.p ?? 0) <= 1, `${a.p}`);
}

// --- 12. sin operaciones no se rompe nada ------------------------------------
{
  const r = sessionDrawdown([]);
  check('sin operaciones el informe sale vacio', r.rows.length === 0 && r.cells.length === 0);
  check('y no afirma haber probado nada', r.tested === 0 && r.survivors === 0);
}

console.log('\nbase temporal:', process.env.JOURNAL_DB);
