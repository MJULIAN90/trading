/**
 * Comprobacion de los ajustes que cambian QUE SE MIDE, no como se ve.
 *
 *   npx tsx scripts/prueba-ajustes.ts
 *
 * Las cuentas que cuentan para las metricas, y estan aqui por dos razones
 * concretas:
 *
 *   - TRES estados, dos de ellos parecidos. Si "no he elegido" y "he elegido
 *     todas" se confunden, el desplegable de cuenta deja de funcionar y no hay
 *     forma de verlo mirando el codigo: la pantalla sigue pintando bien, solo
 *     que filtra por cuentas que nadie pidio.
 *   - El `IN ()` vacio. Una lista vacia significa "todas", pero traducida a
 *     SQL a ciegas seria `account_id IN ()`, que no devuelve NADA: el tablero
 *     saldria en blanco y pareceria que no hay operaciones.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.JOURNAL_DB = join(mkdtempSync(join(tmpdir(), 'tj-aj-')), 'prueba.db');

const { getChartPrefs, setChartPrefs, resolverCuentas } = await import('../src/domain/prefs.js');

function check(nombre: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${nombre}${extra ? ' · ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

// --- 1. el valor guardado ----------------------------------------------------
const mismo = (a: string[] | undefined, b: string[] | undefined) =>
  JSON.stringify(a) === JSON.stringify(b);

check('de serie son todas', getChartPrefs().metricAccounts.length === 0);
check('se puede marcar una', mismo(setChartPrefs({ metricAccounts: ['17011740'] }).metricAccounts, ['17011740']));
check('y persiste', mismo(getChartPrefs().metricAccounts, ['17011740']));
check(
  'se pueden marcar VARIAS, que es el caso de la demo nueva',
  mismo(setChartPrefs({ metricAccounts: ['17011740', 'NUEVA'] }).metricAccounts, ['17011740', 'NUEVA']),
);
check('se recortan los espacios', mismo(setChartPrefs({ metricAccounts: ['  A  ', 'B'] }).metricAccounts, ['A', 'B']));
check('los duplicados se colapsan', mismo(setChartPrefs({ metricAccounts: ['A', 'A', 'B'] }).metricAccounts, ['A', 'B']));
check('las vacias se caen', mismo(setChartPrefs({ metricAccounts: ['A', '', '   '] }).metricAccounts, ['A']));
check('lo que no sea texto no la rompe', mismo(setChartPrefs({ metricAccounts: [5, 'A'] as unknown as string[] }).metricAccounts, ['A']));
check('un valor que no es lista cae en vacia', mismo(setChartPrefs({ metricAccounts: 'A' as unknown as string[] }).metricAccounts, []));

// --- 2. LOS TRES ESTADOS -----------------------------------------------------
setChartPrefs({ metricAccounts: ['17011740', 'NUEVA'] });

check(
  'sin el parametro mandan las marcadas',
  mismo(resolverCuentas({}), ['17011740', 'NUEVA']),
  'es el primer dibujo, antes de tocar nada',
);
check(
  'el parametro VACIO son todas, y le gana al ajuste',
  resolverCuentas({ accounts: '' }) === undefined,
  'EL CASO QUE ROMPE EL DESPLEGABLE SI SE OLVIDA',
);
check('un valor manda sobre el ajuste', mismo(resolverCuentas({ accounts: '17011971' }), ['17011971']));
check('se pueden pedir varias por la URL', mismo(resolverCuentas({ accounts: 'A,B' }), ['A', 'B']));
check('con espacios de por medio tambien', mismo(resolverCuentas({ accounts: ' A , B ' }), ['A', 'B']));
check('una clave presente pero invalida son todas', resolverCuentas({ accounts: 7 }) === undefined);
check('una lista de comas sueltas son todas', resolverCuentas({ accounts: ',,,' }) === undefined);

// --- 3. sin nada marcado -----------------------------------------------------
setChartPrefs({ metricAccounts: [] });
check('sin ajuste, sin parametro, son todas', resolverCuentas({}) === undefined);
check('sin ajuste, con valor, manda el valor', mismo(resolverCuentas({ accounts: '17011740' }), ['17011740']));

// --- 4. el ajuste no se valida contra las cuentas que existen ----------------
//
// A proposito: los ajustes viajan entre ordenadores y una cuenta que aqui no
// esta puede estar en la base del otro. Borrarla al guardar seria perder su
// eleccion por culpa de la maquina en la que abrio el fichero.
check(
  'se guarda una cuenta que no existe en esta base',
  mismo(setChartPrefs({ metricAccounts: ['CUENTA-DE-OTRO-PC'] }).metricAccounts, ['CUENTA-DE-OTRO-PC']),
);

// --- 5. el filtro de verdad, contra la base ----------------------------------
//
// Que `resolverCuentas` devuelva bien la lista no basta: lo que importa es que
// `listOperations` la use, y un `IN ()` con la lista vacia no devuelve nada.
const { db } = await import('../src/db/index.js');
const { listOperations } = await import('../src/domain/metrics.js');

const meter = (id: string, ts: number) =>
  db()
    .prepare(
      `INSERT INTO operations (symbol, opened_at, closed_at, direction, entry_price, exit_price,
         max_quantity, fills_count, gross_pnl, duration_sec, session, market_hour, is_real,
         first_fill_id, last_fill_id, account_id)
       VALUES ('MNQZ6', ?, ?, 'LONG', 1, 1, 1, 2, 10, 60, 'NY_AM', 10, 0, ?, ?, ?)`,
    )
    .run(ts, ts + 1000, `f${ts}`, `l${ts}`, id);

meter('A', Date.UTC(2026, 9, 19, 14, 0));
meter('B', Date.UTC(2026, 9, 20, 14, 0));
meter('C', Date.UTC(2026, 9, 21, 14, 0));

check('sin filtro entran las tres', listOperations({}).length === 3);
check('una cuenta', listOperations({ accounts: ['A'] }).length === 1);
check('DOS cuentas se SUMAN', listOperations({ accounts: ['A', 'B'] }).length === 2);
check('las tres', listOperations({ accounts: ['A', 'B', 'C'] }).length === 3);
check(
  'una lista VACIA son todas, no ninguna',
  listOperations({ accounts: [] }).length === 3,
  'un IN () devolveria cero y el tablero saldria en blanco',
);
check('una cuenta que no existe no devuelve nada', listOperations({ accounts: ['ZZZ'] }).length === 0);

console.log('\nbase temporal:', process.env.JOURNAL_DB);
