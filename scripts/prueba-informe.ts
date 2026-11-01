/**
 * Comprobacion del informe periodico, sin tocar tu base ni salir fuera.
 *
 *   npx tsx scripts/prueba-informe.ts
 *
 * Lo que de verdad se comprueba aqui es que el informe NO mezcle el tamanio
 * de la posicion con la calidad de la entrada. Cuatro formas de que eso pase,
 * y las cuatro estan abajo:
 *
 *   - los ticks por contrato. Si salieran multiplicados por los contratos, una
 *     operacion de 40 lotes con el stop respetado parecerian 2.400 ticks en
 *     contra en vez de 60, y la unica cifra limpia del panel dejaria de serlo.
 *   - el bruto pisado. `applyCosts` SOBRESCRIBE `gross_pnl` con el neto. Si el
 *     informe sumara ese campo creyendo que es el bruto, restaria la comision
 *     dos veces.
 *   - la semana. Va por semana de mercado -lunes a viernes-, no por "las
 *     ultimas cinco jornadas". Con una semana de tres dias, lo segundo se
 *     comeria dos dias de la semana anterior y la comparacion dejaria de ser
 *     contra nada reconocible.
 *   - el periodo anterior. Tiene que ser la semana de ANTES, no las
 *     operaciones de antes.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.JOURNAL_DB = join(mkdtempSync(join(tmpdir(), 'tj-inf-')), 'prueba.db');

const { informe } = await import('../src/domain/report.js');
const { sessionOf } = await import('../src/domain/sessions.js');
const metrics = await import('../src/domain/metrics.js');

type Operation = metrics.Operation;

function check(nombre: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${nombre}${extra ? ' · ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

const SIN_COSTE = { commissionPerContract: 0, dailyLossLimit: 0 };
let siguiente = 1;

/**
 * Una operacion con la hora de Nueva York escrita tal cual.
 *
 * `pnlPorContrato` es lo que dejo UN contrato; el total se multiplica aqui,
 * igual que lo hace la ingesta. Asi la prueba no puede pasar por casualidad
 * si algun dia se confunden las dos cosas en el dominio.
 */
function op(fechaNY: string, horaNY: string, pnlPorContrato: number, lotes = 1): Operation {
  const opened = Date.parse(`${fechaNY}T${horaNY}:00-04:00`);
  return {
    id: siguiente++,
    symbol: 'MNQZ6',
    opened_at: opened,
    closed_at: opened + 120_000,
    direction: 'LONG',
    entry_price: 25000,
    exit_price: 25000 + pnlPorContrato / 2,
    max_quantity: lotes,
    fills_count: 2,
    gross_pnl: pnlPorContrato * lotes,
    duration_sec: 120,
    session: sessionOf(opened),
    market_hour: 0,
    is_real: 0,
    account_id: null,
  };
}

// --- 1. los ticks son POR CONTRATO -------------------------------------------
//
// EL FALLO QUE ESTA PRUEBA EXISTE PARA EVITAR. 60 ticks en contra con 40
// contratos son -$1.200 de perdida y -60 ticks por contrato. Si el informe
// multiplicara, diria -2.400 y la cifra que existe precisamente para separar
// "como opero" de "cuanto arriesgo" quedaria mezclada con el tamanio.
{
  // 60 ticks * 0,25 puntos * $2 = $30 por contrato.
  const r = informe([op('2026-10-19', '10:00', -30, 40)], 'diario', SIN_COSTE);
  check('el neto lleva los contratos', r.net === -1200, `${r.net}`);
  check('los ticks NO los llevan', r.ticksPerTrade === -60, `${r.ticksPerTrade}`);
  check('la destacada guarda las dos cosas', r.worst[0]?.net === -1200 && r.worst[0]?.ticks === -60);
  check('y lo que habria costado con 1 contrato', r.worst[0]?.netPerContract === -30, `${r.worst[0]?.netPerContract}`);
}

// --- 2. el bruto no se cuenta con la comision ya quitada ----------------------
//
// `applyCosts` pisa `gross_pnl` con el neto. Sumar ese campo creyendo que es
// el bruto resta la comision dos veces, y el informe diria que una jornada
// plana perdio dinero.
{
  const ops = [op('2026-10-19', '10:00', 100, 2)]; // +$200 brutos, 2 contratos
  const r = informe(ops, 'diario', { commissionPerContract: 1, dailyLossLimit: 0 });
  check('el bruto es el bruto', r.gross === 200, `${r.gross}`);
  check('la comision son 2 contratos x $1', r.commission === 2, `${r.commission}`);
  check('y el neto es la resta, una sola vez', r.net === 198, `${r.net}`);
}

// --- 3. la semana va de lunes a viernes --------------------------------------
//
// 19 oct 2026 es lunes. Se meten dos semanas completas y se comprueba que el
// periodo actual sea la SEGUNDA entera y el anterior la PRIMERA entera.
{
  const ops: Operation[] = [];
  for (const d of ['19', '20', '21', '22', '23']) ops.push(op(`2026-10-${d}`, '10:00', 10));
  for (const d of ['26', '27', '28', '29', '30']) ops.push(op(`2026-10-${d}`, '10:00', 20));

  const r = informe(ops, 'semanal', SIN_COSTE);
  check('la semana en curso son 5 jornadas', r.days.length === 5, r.days.join(','));
  check('y empieza en lunes', r.from === '2026-10-26', r.from);
  check('acaba en viernes', r.to === '2026-10-30', r.to);
  check('solo cuenta sus operaciones', r.operations === 5 && r.net === 100, `${r.operations} ops, ${r.net}`);

  check('el periodo anterior es la semana de antes', r.previous?.from === '2026-10-19', r.previous?.from);
  check('entera, no las ultimas cinco operaciones', r.previous?.days === 5, `${r.previous?.days}`);
  check('con su propio resultado', r.previous?.net === 50, `${r.previous?.net}`);
}

// --- 4. una semana corta se declara corta ------------------------------------
//
// Si la semana tiene tres dias, el panel tiene que poder decirlo. Rellenarla
// con dias de la semana anterior daria una comparacion falsa.
{
  const ops = ['26', '27', '28'].map((d) => op(`2026-10-${d}`, '10:00', 10));
  const r = informe(ops, 'semanal', SIN_COSTE);
  check('tres jornadas son tres', r.days.length === 3, r.days.join(','));
  check('y el panel sabe que esperaba cinco', r.expectedDays === 5);
  check('sin semana anterior, no se inventa una', r.previous === null);
}

// --- 5. el diario es UNA jornada, con la de antes para comparar --------------
{
  const ops = [
    op('2026-10-29', '10:00', 10),
    op('2026-10-30', '10:00', 20),
    op('2026-10-30', '10:30', 30),
  ];
  const r = informe(ops, 'diario', SIN_COSTE);
  check('el diario coge la ultima jornada', r.days.join(',') === '2026-10-30', r.days.join(','));
  check('con sus dos operaciones', r.operations === 2 && r.net === 50, `${r.operations}, ${r.net}`);
  check('y la jornada anterior aparte', r.previous?.from === '2026-10-29' && r.previous?.net === 10);
}

// --- 6. la jornada rueda a las 18:00 de Nueva York ---------------------------
//
// Lo operado el jueves por la noche es la jornada del viernes. Sin esto, una
// sesion de Asia saldria partida en dos informes diarios.
{
  const ops = [op('2026-10-29', '21:00', 10), op('2026-10-30', '00:30', 10)];
  const r = informe(ops, 'diario', SIN_COSTE);
  check('las 21:00 del jueves son la jornada del viernes', r.days.join(',') === '2026-10-30', r.days.join(','));
  check('y las dos caen en el mismo informe', r.operations === 2, `${r.operations}`);
}

// --- 7. el lote mediano parte la muestra, no un numero inventado -------------
{
  const ops = [
    op('2026-10-30', '10:00', 10, 1),
    op('2026-10-30', '10:05', 10, 1),
    op('2026-10-30', '10:10', 10, 5),
    op('2026-10-30', '10:15', -10, 5),
  ];
  const r = informe(ops, 'diario', SIN_COSTE);
  check('el lote mediano son 3', r.medianLot === 3, `${r.medianLot}`);
  check('las grandes son las de 5', r.bigLots.operations === 2, `${r.bigLots.operations}`);
  check('las pequenias las de 1', r.smallLots.operations === 2, `${r.smallLots.operations}`);
  check('el lote maximo es 5', r.maxLot === 5, `${r.maxLot}`);
  check('y el reparto por lotaje tiene dos filas', r.byLot.length === 2, `${r.byLot.length}`);
}

// --- 8. lo que queda del limite sale de la ULTIMA jornada --------------------
//
// Si se calculara con el acumulado del periodo, una semana mala dejaria el
// limite "gastado" el lunes siguiente.
{
  const ops = [op('2026-10-29', '10:00', -500), op('2026-10-30', '10:00', -100)];
  const r = informe(ops, 'diario', { commissionPerContract: 0, dailyLossLimit: 300 });
  check('queda el limite menos lo perdido HOY', r.remaining === 200, `${r.remaining}`);
  check('no lo de toda la semana', r.remaining !== 0);

  const sinLimite = informe(ops, 'diario', SIN_COSTE);
  check('sin limite puesto, no hay cifra', sinLimite.remaining === null);
}

// --- 9. una jornada en verde puede tener los ticks en rojo -------------------
//
// Es el caso que da sentido al panel entero: en octubre el dinero dijo +157,50
// y los ticks por contrato dijeron -3,99. Si las dos cifras no pudieran
// discrepar, una de las dos sobraria.
{
  const ops = [
    op('2026-10-30', '10:00', 100, 10), // +$1.000 con 10 contratos, +200 ticks
    op('2026-10-30', '10:05', -30, 1),
    op('2026-10-30', '10:10', -30, 1),
    op('2026-10-30', '10:15', -30, 1),
    op('2026-10-30', '10:20', -30, 1),
  ];
  const r = informe(ops, 'diario', SIN_COSTE);

  // +$880 en dolares, -8 ticks por contrato. Las dos cifras son correctas y
  // dicen cosas opuestas: gano dinero porque metio diez contratos en la unica
  // que salio bien, no porque operase bien. Es el caso que justifica que la
  // segunda baldosa del panel no sea dinero.
  check('la jornada acaba en verde', r.net === 880, `${r.net}`);
  check('y aun asi los ticks por contrato estan en rojo', r.ticksPerTrade === -8, `${r.ticksPerTrade}`);
  check(
    'la mediana remata',
    r.ticksMedian === -60,
    `${r.ticksMedian} · cuatro de cinco operaciones perdieron 60 ticks`,
  );
}

// --- 10. los huecos salen aparte de las franjas ------------------------------
{
  const ops = [
    op('2026-10-30', '10:00', 10), // NY_AM
    op('2026-10-30', '11:15', -20), // hueco entre NY AM y el almuerzo
  ];
  const r = informe(ops, 'diario', SIN_COSTE);
  check('hay dos franjas', r.bySession.length === 2, r.bySession.map((b) => b.key).join(','));
  check('y un hueco con nombre', r.byGap.length === 1 && r.byGap[0]!.label.includes('almuerzo'), r.byGap[0]?.label);
  check('el hueco lleva su propio resultado', r.byGap[0]!.net === -20, `${r.byGap[0]?.net}`);
}

// --- 11. la navegacion por fechas --------------------------------------------
//
// EL FALLO QUE ESTOS CASOS EXISTEN PARA EVITAR. `prev` y `next` no devuelven
// el mismo dia: hacia atras sale el ULTIMO dia del periodo anterior y hacia
// delante el PRIMERO del siguiente. Los dos valen como ancla porque el ancla
// solo tiene que caer dentro de la semana, pero si alguna vez se cambiara por
// "el lunes de la semana anterior", ir hacia atras y luego hacia delante
// dejaria de volver al punto de partida.
{
  const ops: Operation[] = [];
  for (const d of ['05', '06', '07']) ops.push(op(`2026-10-${d}`, '10:00', 10));
  for (const d of ['12', '13']) ops.push(op(`2026-10-${d}`, '10:00', 20));
  for (const d of ['19', '20']) ops.push(op(`2026-10-${d}`, '10:00', 30));

  const ultimo = informe(ops, 'diario', SIN_COSTE);
  check('sin ancla se coge lo mas reciente', ultimo.from === '2026-10-20', ultimo.from);
  check('y se sabe que es lo ultimo', ultimo.isLatest === true && ultimo.next === null);

  const enMedio = informe(ops, 'diario', SIN_COSTE, '2026-10-13');
  check('con ancla se coge esa jornada', enMedio.from === '2026-10-13', enMedio.from);
  check('con su anterior', enMedio.prev === '2026-10-12', `${enMedio.prev}`);
  check('y su siguiente', enMedio.next === '2026-10-19', `${enMedio.next}`);
  check('y ya no es lo ultimo', enMedio.isLatest === false);

  // Ir y volver tiene que dejarte donde estabas.
  const atras = informe(ops, 'diario', SIN_COSTE, enMedio.prev!);
  const vuelta = informe(ops, 'diario', SIN_COSTE, atras.next!);
  check('atras y adelante vuelve al mismo sitio', vuelta.from === enMedio.from, `${vuelta.from}`);

  // Lo mismo en semanal, donde prev y next son dias DISTINTOS de su semana.
  const sem = informe(ops, 'semanal', SIN_COSTE, '2026-10-19');
  check('la semana del 19 son sus dos jornadas', sem.operations === 2 && sem.from === '2026-10-19');
  check('prev es el ULTIMO dia de la semana de antes', sem.prev === '2026-10-13', `${sem.prev}`);

  const semAtras = informe(ops, 'semanal', SIN_COSTE, sem.prev!);
  check('y lleva a esa semana entera', semAtras.from === '2026-10-12' && semAtras.operations === 2, semAtras.from);
  check('next es el PRIMER dia de la de despues', semAtras.next === '2026-10-19', `${semAtras.next}`);

  const semVuelta = informe(ops, 'semanal', SIN_COSTE, semAtras.next!);
  check('ir y volver tambien cuadra en semanal', semVuelta.from === sem.from, `${semVuelta.from}`);

  const primera = informe(ops, 'semanal', SIN_COSTE, '2026-10-05');
  check('la primera semana no tiene anterior', primera.prev === null);
}

// --- 11b. el periodo anterior salta los huecos -------------------------------
//
// Con una semana entera sin operar por medio, "la semana de hace siete dias"
// daria una comparacion contra cero que no dice nada. Se compara contra la
// ultima semana que tuvo operaciones, y sus fechas van en el informe para que
// se vea contra que se esta comparando.
{
  const ops = [
    op('2026-10-05', '10:00', 10),
    // la semana del 12 entera sin operar
    op('2026-10-19', '10:00', 30),
  ];
  const r = informe(ops, 'semanal', SIN_COSTE, '2026-10-19');
  check('se compara contra la ultima semana CON operaciones', r.previous?.from === '2026-10-05', `${r.previous?.from}`);
  check('y no contra una semana vacia', r.previous?.net === 10, `${r.previous?.net}`);
}

// --- 11c. el calendario trae TODAS las jornadas, no las del periodo ----------
//
// Es para navegar: tiene que ensenar los dias a los que todavia no has ido.
{
  const ops = ['05', '06', '19', '20'].map((d) => op(`2026-10-${d}`, '10:00', 10));
  const r = informe(ops, 'diario', SIN_COSTE);
  check('el informe mira una jornada', r.days.length === 1, r.days.join(','));
  check('pero el calendario trae las cuatro', r.calendar.length === 4, `${r.calendar.length}`);
  check('en orden', r.calendar.map((d) => d.date).join(',') === '2026-10-05,2026-10-06,2026-10-19,2026-10-20');
  check('con su cuenta y su neto', r.calendar[0]?.count === 1 && r.calendar[0]?.pnl === 10);
}

// --- 11d. un ancla sin operaciones no inventa un dia -------------------------
{
  const ops = [op('2026-10-19', '10:00', 10), op('2026-10-21', '10:00', 10)];
  const r = informe(ops, 'diario', SIN_COSTE, '2026-10-20');
  check('una jornada sin operar sale vacia', r.operations === 0 && r.days.length === 0);
  check('pero se puede seguir navegando hacia atras', r.prev === '2026-10-19', `${r.prev}`);
  check('y hacia delante', r.next === '2026-10-21', `${r.next}`);
}

// --- 12. sin operaciones no se rompe nada ------------------------------------
{
  const r = informe([], 'semanal', SIN_COSTE);
  check('sin operaciones el informe sale vacio', r.operations === 0 && r.days.length === 0);
  check('y no inventa un periodo anterior', r.previous === null);
  check('ni un payoff', r.payoff === null && r.breakeven === null);
}

console.log('\nbase temporal:', process.env.JOURNAL_DB);
