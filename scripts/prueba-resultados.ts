/**
 * Comprobacion de la franja de resultados, sin tocar tu base ni salir fuera.
 *
 *   npx tsx scripts/prueba-resultados.ts
 *
 * Lo que de verdad se comprueba aqui es que una ALARMA CON SONIDO no suene
 * cuando no toca. Tres formas de que eso pase, y las tres estan abajo:
 *
 *   - el cambio de hora. Nueva York pasa a UTC-5 el 1 de noviembre de 2026 y
 *     AAPL presenta el 2: calculado con el desfase de hoy, el aviso sale una
 *     hora corrido.
 *   - el `epsActual` a 0 de lo que todavia no ha presentado. Leido como
 *     resultado, cualquier empresa pendiente es un desplome del 100 %.
 *   - la ventana por fecha en vez de por instante: a las once de la noche,
 *     "dentro de 3 dias" y "dentro de 3 dias y 23 horas" serian lo mismo.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.JOURNAL_DB = join(mkdtempSync(join(tmpdir(), 'tj-res-')), 'prueba.db');

const { db } = await import('../src/db/index.js');
const { num } = await import('../src/ingest/market.js');
const { saveEarnings } = await import('../src/domain/global.js');
const { agenda, momentoDe, setEarningsSettings, sorpresas, HORA_MEDIDA } = await import(
  '../src/domain/earnings.js'
);

function check(nombre: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${nombre}${extra ? ' · ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

const iso = (ms: number) => new Date(ms).toISOString();

// --- 1. la convencion y el cambio de hora ------------------------------------
check(
  'amc antes del cambio de hora (21 oct, NY en UTC-4)',
  iso(momentoDe('2026-10-21', 'amc')!) === '2026-10-21T20:30:00.000Z',
  iso(momentoDe('2026-10-21', 'amc')!),
);
check(
  'amc DESPUES del cambio (17 nov, NY en UTC-5)',
  iso(momentoDe('2026-11-17', 'amc')!) === '2026-11-17T21:30:00.000Z',
  iso(momentoDe('2026-11-17', 'amc')!),
);
check(
  'bmo usa su propia hora',
  iso(momentoDe('2026-11-02', 'bmo')!) === '2026-11-02T13:30:00.000Z',
  iso(momentoDe('2026-11-02', 'bmo')!),
);
check('una fecha con mala pinta no inventa una hora', momentoDe('manana', 'amc') === null);
check('sin "when" se toma despues del cierre', momentoDe('2026-11-17', null) !== null);

// --- 2. la hora se puede cambiar, pero solo a una hora valida ----------------
check('se puede mover la convencion', setEarningsSettings({ amcHour: '17:05' }).amcHour === '17:05');
check(
  'y se nota en el calculo',
  iso(momentoDe('2026-11-17', 'amc')!) === '2026-11-17T22:05:00.000Z',
  iso(momentoDe('2026-11-17', 'amc')!),
);
check('una hora imposible se rechaza', setEarningsSettings({ amcHour: '25:70' }).amcHour === '17:05');
check('y un texto cualquiera tambien', setEarningsSettings({ bmoHour: 'por la manana' }).bmoHour === '08:30');
setEarningsSettings({ amcHour: '16:30', bmoHour: '08:30' });

// --- 2b. la hora MEDIDA manda sobre la convencion ---------------------------
//
// Es el cambio que destapo que la convencion unica estaba mal: solo valia para
// Apple. GOOGL publica a las 16:01 y con las 16:30 el aviso de los 15 minutos
// sonaba media hora tarde.
check(
  'con simbolo medido se usa SU hora, no la convencion',
  iso(momentoDe('2026-11-17', 'amc', undefined, 'GOOGL')!) === '2026-11-17T21:01:00.000Z',
  iso(momentoDe('2026-11-17', 'amc', undefined, 'GOOGL')!),
);
check(
  'sin simbolo se sigue usando la convencion',
  iso(momentoDe('2026-11-17', 'amc')!) === '2026-11-17T21:30:00.000Z',
  iso(momentoDe('2026-11-17', 'amc')!),
);
check(
  'un simbolo que no hemos medido cae en la convencion',
  iso(momentoDe('2026-11-17', 'amc', undefined, 'XYZ')!) === '2026-11-17T21:30:00.000Z',
);
// De ninguna hay medicion de "antes de abrir": las diez publican por la tarde.
// Si alguna cambiara, la convencion tiene que seguir mandando ahi.
check(
  'para bmo manda la convencion aunque la empresa este medida',
  iso(momentoDe('2026-11-17', 'bmo', undefined, 'GOOGL')!) === '2026-11-17T13:30:00.000Z',
  iso(momentoDe('2026-11-17', 'bmo', undefined, 'GOOGL')!),
);
check('AAPL medida coincide con la vieja convencion', HORA_MEDIDA.AAPL?.hhmm === '16:30');
check('y GOOGL NO: por eso hacia falta medir', HORA_MEDIDA.GOOGL?.hhmm === '16:01');

// --- 3. la agenda ------------------------------------------------------------
//
// Reloj fijo: martes 27 oct 2026, 10:00 de Nueva York (14:00Z).
const AHORA = Date.UTC(2026, 9, 27, 14, 0, 0);
const dia = (n: number) => new Date(AHORA + n * 86_400_000).toISOString().slice(0, 10);

const cuantas = (s: string) =>
  (db().prepare('SELECT COUNT(*) n FROM global_earnings WHERE symbol = ?').get(s) as { n: number }).n;

const fechaDe = (s: string) =>
  (db().prepare('SELECT date FROM global_earnings WHERE symbol = ? ORDER BY date DESC LIMIT 1').get(s) as { date: string } | undefined)?.date;

const meter = (symbol: string, fecha: string, when: string, est: number | null, real: number | null) =>
  db()
    .prepare(
      `INSERT INTO global_earnings (symbol, name, date, when_, eps_estimate, eps_actual)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(symbol, symbol, fecha, when, est, real);

meter('HOY', dia(0), 'amc', 1.0, null);
meter('TRES', dia(3), 'amc', 2.0, 0);
meter('CUATRO', dia(4), 'amc', 3.0, 0);
meter('AYER', dia(-1), 'amc', 4.0, 3.0);

const vista = agenda(3, AHORA);
const simbolos = vista.map((c) => c.symbol);

check('entra quien presenta hoy', simbolos.includes('HOY'), simbolos.join(', '));
check('entra quien presenta en 3 dias', simbolos.includes('TRES'), simbolos.join(', '));
check('NO entra quien presenta en 4 dias', !simbolos.includes('CUATRO'), simbolos.join(', '));
check('ni lo que ya presento ayer', !simbolos.includes('AYER'), simbolos.join(', '));
check('salen ordenadas por cercania', simbolos.join('>') === 'HOY>TRES', simbolos.join('>'));

const hoy = vista.find((c) => c.symbol === 'HOY')!;
check('la cuenta atras sale del instante, no de la fecha', hoy.faltaMs === hoy.at - AHORA);
check('a las 10:00 NY, el informe de esta tarde esta a 6h30', hoy.faltaMs === 6.5 * 3_600_000, `${hoy.faltaMs / 3_600_000} h`);
check('y lleva la hora de Nueva York escrita', hoy.hhmm === '16:30', hoy.hhmm);
check(
  'la cita dice si su hora esta medida o es convencion',
  hoy.medido === null,
  'HOY no es un simbolo medido, asi que toca convencion',
);

// La ventana va por DIAS DE CALENDARIO. 'TRES' presenta dentro de tres dias a
// las 16:30, que son 78,5 horas: con una ventana de 72 horas justas no saldria
// hasta las 16:30 de hoy, y por la mañana el panel diria que no hay nada
// cuando el calendario dice que si. La hora manda para la cuenta atras, no
// para decidir quien entra.
const tres = vista.find((c) => c.symbol === 'TRES')!;
check('el de 3 dias entra aunque falten mas de 72 horas', tres.faltaMs > 3 * 86_400_000, `${(tres.faltaMs / 3_600_000).toFixed(1)} h`);

// --- 4. lo que ya presento ---------------------------------------------------
const s = sorpresas(3, AHORA);
const porSimbolo = new Map(s.map((x) => [x.symbol, x]));

check('solo entra lo que ya presento', [...porSimbolo.keys()].join(',') === 'AYER', [...porSimbolo.keys()].join(','));
check(
  'un resultado por debajo se marca como fallo',
  porSimbolo.get('AYER')?.fallo === true && porSimbolo.get('AYER')?.desvioPct === -25,
  `${porSimbolo.get('AYER')?.desvioPct}%`,
);

// EL FALLO QUE ESTA PRUEBA EXISTE PARA EVITAR. 'TRES' presenta dentro de tres
// dias y el proveedor le puso `eps_actual = 0`. Si ese cero se leyera como
// resultado, saldria un -100 % y un aviso rojo por una empresa que todavia no
// ha abierto la boca.
check('un cero de lo que aun no presento NO es un desplome', !porSimbolo.has('TRES'));
check('ni lo que presenta en 4 dias', !porSimbolo.has('CUATRO'));

// Con la estimacion en negativo -se esperaban perdidas-, dividir conservando
// el signo le da la vuelta a la lectura: perder menos de lo esperado saldria
// en rojo.
meter('PERDIA', dia(-1), 'amc', -2.0, -1.0);
const perdia = sorpresas(3, AHORA).find((x) => x.symbol === 'PERDIA')!;
check('perder menos de lo esperado es mejor, no peor', perdia.fallo === false && perdia.desvioPct === 50, `${perdia.desvioPct}%`);

// Un resultado de 0,00 de verdad, en una empresa que YA presento, si cuenta
// —pero solo porque TIENE INGRESOS. Dos ceros a la vez son el hueco del
// proveedor, no un resultado.
meter('CERO', dia(-1), 'amc', 1.5, 0);
db().prepare('UPDATE global_earnings SET revenue_actual = 5000 WHERE symbol = ?').run('CERO');
const cero = sorpresas(3, AHORA).find((x) => x.symbol === 'CERO')!;
check('un cero REAL con ingresos, ya presentado, si es un fallo', cero.fallo === true && cero.desvioPct === -100, `${cero.desvioPct}%`);

meter('HUECO', dia(-1), 'amc', 1.5, 0);
db().prepare('UPDATE global_earnings SET revenue_actual = 0 WHERE symbol = ?').run('HUECO');
check('pero dos ceros a la vez son un hueco, no un desplome', !sorpresas(3, AHORA).some((x) => x.symbol === 'HUECO'));

// --- 5. HOY, que es el caso que se escapo ------------------------------------
//
// La guarda decia "la fecha ha pasado" (`date > hoy`) y eso deja entrar el dia
// de hoy entero. AAPL presenta DESPUES DEL CIERRE: a las 10:00 de la maniana
// su fila ya pasaba el filtro, y con `eps_actual = 0` salia un -100 % y un
// aviso rojo por una empresa que aun no habia abierto la boca.
//
// AHORA son las 10:00 de Nueva York.
meter('HOYAMC', dia(0), 'amc', 2.03, 0);
check(
  'lo que presenta HOY despues del cierre no sale por la maniana',
  !sorpresas(3, AHORA).some((x) => x.symbol === 'HOYAMC'),
);
check(
  'y a las 17:00 NY, ya cerrado, tampoco si sigue sin dato',
  !sorpresas(3, AHORA + 7 * 3_600_000).some((x) => x.symbol === 'HOYAMC'),
);

db().prepare('UPDATE global_earnings SET eps_actual = 1.80 WHERE symbol = ?').run('HOYAMC');
check(
  'pero en cuanto publica, y ya cerrado, si sale',
  sorpresas(3, AHORA + 7 * 3_600_000).some((x) => x.symbol === 'HOYAMC'),
);
check(
  'y antes del cierre sigue sin salir aunque el dato ya este',
  !sorpresas(3, AHORA).some((x) => x.symbol === 'HOYAMC'),
);

// El que presenta HOY antes de abrir si cuenta a las 10:00: ya ha presentado.
meter('HOYBMO', dia(0), 'bmo', 2.00, 2.20);
const bmo = sorpresas(3, AHORA).find((x) => x.symbol === 'HOYBMO');
check('lo que presenta HOY antes de abrir si sale a las 10:00', bmo !== undefined);
check('y con su desvio bien', bmo?.desvioPct === 10 && bmo?.fallo === false, `${bmo?.desvioPct}%`);

// --- 5b. la fecha que se mueve ----------------------------------------------
//
// NVDA tenia el 17 Y el 25 de noviembre a la vez, con la misma estimacion: el
// proveedor movio la fecha, el upsert metio la nueva y la vieja se quedo. Como
// la agenda ordena por cercania, el aviso habria saltado ocho dias antes de
// tiempo para la empresa que mas pesa del indice.
{
  const hoy = dia(0);
  const mañana = dia(1);
  const dentro = dia(10);

  saveEarnings([
    { symbol: 'MUEVE', name: 'Mueve', date: mañana, when: 'amc', epsEstimate: 1, epsActual: null, revenueEstimate: null, revenueActual: null },
  ], hoy);
  check('entra la primera fecha', cuantas('MUEVE') === 1, `${cuantas('MUEVE')}`);

  saveEarnings([
    { symbol: 'MUEVE', name: 'Mueve', date: dentro, when: 'amc', epsEstimate: 1, epsActual: null, revenueEstimate: null, revenueActual: null },
  ], hoy);
  check('al mover la fecha NO quedan dos', cuantas('MUEVE') === 1, `${cuantas('MUEVE')} filas`);
  check('y la que queda es la nueva', fechaDe('MUEVE') === dentro, fechaDe('MUEVE'));

  // Lo PASADO no se toca: lleva lo presentado, que no se puede volver a pedir.
  saveEarnings([
    { symbol: 'PASADO', name: 'Pasado', date: dia(-2), when: 'amc', epsEstimate: 1, epsActual: 1.1, revenueEstimate: null, revenueActual: 900 },
  ], hoy);
  saveEarnings([
    { symbol: 'PASADO', name: 'Pasado', date: dentro, when: 'amc', epsEstimate: 2, epsActual: null, revenueEstimate: null, revenueActual: null },
  ], hoy);
  check('la fila ya presentada sobrevive', cuantas('PASADO') === 2, `${cuantas('PASADO')} filas`);

  // Un simbolo que no contesta no se toca. Si una peticion falla y vuelve
  // vacia, borrar su futuro dejaria sin aviso a quien presenta maniana.
  saveEarnings([
    { symbol: 'OTRO', name: 'Otro', date: mañana, when: 'amc', epsEstimate: 3, epsActual: null, revenueEstimate: null, revenueActual: null },
  ], hoy);
  check('un simbolo ajeno a la tanda no pierde su fecha', cuantas('OTRO') === 1);
}

// --- 6. la raiz: Number(null) es 0 -------------------------------------------
//
// Lo de arriba son dos guardas. Esto es lo que de verdad estaba mal: el null
// que manda Finnhub para lo no presentado llegaba a la base como un cero.
check('null no es cero', num(null) === null, String(num(null)));
check('la cadena vacia tampoco', num('') === null, String(num('')));
check('undefined tampoco', num(undefined) === null, String(num(undefined)));
check('pero un cero de verdad se conserva', num(0) === 0);
check('y un numero en texto se convierte', num('1.5') === 1.5);
check('lo que no es un numero no pasa', num('manana') === null);

console.log('\nbase temporal:', process.env.JOURNAL_DB);
