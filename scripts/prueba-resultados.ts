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

// Un resultado de 0,00 de verdad, en una empresa que YA presento, si cuenta.
meter('CERO', dia(-1), 'amc', 1.5, 0);
const cero = sorpresas(3, AHORA).find((x) => x.symbol === 'CERO')!;
check('un cero REAL, ya presentado, si es un fallo', cero.fallo === true && cero.desvioPct === -100, `${cero.desvioPct}%`);

console.log('\nbase temporal:', process.env.JOURNAL_DB);
