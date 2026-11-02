/**
 * La ingesta del calendario economico, y sobre todo lo que NO deja entrar.
 *
 * (La otra prueba con nombre parecido, `prueba-calendario.ts`, es del
 * calendario de dias operados de la pantalla. Esta es de la importacion.)
 *
 * Viene de un caso real del 1 de noviembre de 2026. En la carpeta del
 * calendario estaba `plantilla.csv` -el fichero de ejemplo que explica el
 * formato- y se estaba importando como si fuera un calendario de verdad. Metio
 * seis eventos inventados en la base, uno de ellos un *Non-Farm Employment
 * Change* el SABADO 17 de octubre.
 *
 * Tres semanas sin que se viera, y el motivo es el que importa: **un evento de
 * mas no rompe nada**. Sale pintado igual que los buenos, el panel lo cuenta
 * igual, y la unica senial era que ese sabado no habia velas alrededor.
 *
 * Asi que aqui se prueba, por este orden:
 *
 *   1. Que las plantillas no entran.
 *   2. Que lo que metieron ANTES se borra. Dejar de importar no basta: las
 *      seis filas se habrian quedado en la base para siempre.
 *   3. Que un evento en fin de semana se descarta venga del fichero que venga.
 *      Es la red general: habria cazado el sabado aunque el fichero se hubiera
 *      llamado de otra forma.
 *   4. Que un calendario de verdad NO se toca. Un filtro que se lleve por
 *      delante los datos buenos es peor que el problema que arregla.
 *
 *   npx tsx scripts/prueba-ingesta-calendario.ts
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tj-cal-'));
const ruta = join(dir, 'prueba.db');
process.env.JOURNAL_DB = ruta;
console.log(`base temporal: ${ruta}`);

const carpeta = join(dir, 'calendario');
mkdirSync(carpeta, { recursive: true });

const { db } = await import('../src/db/index.js');
const { ingestCalendar } = await import('../src/ingest/calendar.js');

let ok = 0;
let fallos = 0;

function comprobar(titulo: string, cond: boolean, detalle = '') {
  if (cond) { ok++; console.log(`OK   ${titulo}${detalle ? ' · ' + detalle : ''}`); }
  else { fallos++; console.log(`FALLO ${titulo}${detalle ? ' · ' + detalle : ''}`); }
}

const eventos = () => db().prepare('SELECT id, ts, title, source FROM economic_events ORDER BY ts').all() as Array<{ id: string; ts: number; title: string; source: string }>;
const cuantos = () => eventos().length;

function escribir(nombre: string, contenido: string) {
  writeFileSync(join(carpeta, nombre), contenido, 'utf8');
}

// Octubre de 2026: el 15 es jueves, el 16 viernes, el 17 SABADO.
const CSV_BUENO = `Date,Time,Currency,Impact,Event
2026-10-15,08:30,USD,High,CPI m/m
2026-10-16,08:30,USD,Medium,Initial Jobless Claims
`;

const CSV_CON_SABADO = `Date,Time,Currency,Impact,Event
2026-10-15,08:30,USD,High,CPI m/m
2026-10-17,08:30,USD,High,Non-Farm Employment Change
2026-10-18,10:00,USD,Medium,Prelim UoM Consumer Sentiment
`;

console.log('\n--- 1. las plantillas no entran ---\n');

escribir('plantilla.csv', CSV_CON_SABADO);
escribir('t1-2026.csv', CSV_BUENO);

const r1 = ingestCalendar(carpeta);

comprobar('la plantilla se declara saltada', r1.plantillas.includes('plantilla.csv'), r1.plantillas.join(', '));
comprobar('solo se lee el fichero bueno', r1.files === 1, `${r1.files} ficheros leidos`);
comprobar('entran los dos eventos del fichero bueno', cuantos() === 2, `${cuantos()} eventos`);
comprobar(
  'y ninguno viene de la plantilla',
  eventos().every((e) => e.source !== 'plantilla.csv'),
);

for (const nombre of ['Plantilla.CSV', 'ejemplo.csv', 'TEMPLATE.ics', 'sample.csv', 'leeme.csv']) {
  escribir(nombre, CSV_CON_SABADO);
}
const r1b = ingestCalendar(carpeta);
comprobar(
  'da igual mayusculas, idioma y extension',
  r1b.plantillas.length === 6,
  r1b.plantillas.sort().join(', '),
);
comprobar('y la base sigue con los dos buenos', cuantos() === 2, `${cuantos()} eventos`);

for (const nombre of ['Plantilla.CSV', 'ejemplo.csv', 'TEMPLATE.ics', 'sample.csv', 'leeme.csv']) {
  rmSync(join(carpeta, nombre));
}

console.log('\n--- 2. lo que las plantillas metieron ANTES se borra ---\n');

// Se simula el estado del que viene todo esto: seis filas ya en la base,
// puestas por una version anterior que si importaba la plantilla.
db().prepare(
  "INSERT INTO economic_events (id, ts, title, impact, currency, source) VALUES (?, ?, ?, 'high', 'USD', 'plantilla.csv')",
).run('viejo-1', Date.UTC(2026, 9, 15, 12, 30), 'Core CPI m/m');
db().prepare(
  "INSERT INTO economic_events (id, ts, title, impact, currency, source) VALUES (?, ?, ?, 'high', 'USD', 'plantilla.csv')",
).run('viejo-2', Date.UTC(2026, 9, 16, 12, 30), 'Philly Fed');

comprobar('estan metidos antes de importar', cuantos() === 4, `${cuantos()} eventos`);

const r2 = ingestCalendar(carpeta);

comprobar('la importacion los borra', cuantos() === 2, `${cuantos()} eventos`);
comprobar('y lo dice', r2.limpiadas === 2, `limpiadas = ${r2.limpiadas}`);
comprobar(
  'sin llevarse por delante los buenos',
  eventos().every((e) => e.source === 't1-2026.csv'),
  eventos().map((e) => e.source).join(', '),
);

console.log('\n--- 3. el fin de semana se descarta venga de donde venga ---\n');

// Se vacia la tabla a proposito. La importacion es ADITIVA: no borra un evento
// porque desaparezca del fichero, asi que sin esto seguirian aqui los del
// bloque 1 y el recuento diria otra cosa. (Que sea aditiva es correcto: un
// fichero semanal no deberia llevarse por delante el calendario del mes.)
db().prepare('DELETE FROM economic_events').run();

escribir('t1-2026.csv', CSV_CON_SABADO);
const r3 = ingestCalendar(carpeta);

comprobar(
  'el sabado y el domingo no entran aunque el fichero sea bueno',
  r3.finDeSemana === 2,
  `finDeSemana = ${r3.finDeSemana}`,
);
comprobar('de los tres del fichero solo queda uno', cuantos() === 1, eventos().map((e) => e.title).join(', '));
comprobar(
  'y es el CPI del jueves 15',
  eventos()[0]?.title === 'CPI m/m',
  eventos()[0]?.title,
);

// Y la limpieza retroactiva: una fila de sabado ya metida, de un fichero con
// nombre perfectamente normal.
db().prepare(
  "INSERT INTO economic_events (id, ts, title, impact, currency, source) VALUES (?, ?, ?, 'high', 'USD', 'otro.csv')",
).run('sabado-viejo', Date.UTC(2026, 9, 17, 12, 30), 'NFP imposible');
comprobar('la fila de sabado esta en la base', cuantos() === 2);

const r3b = ingestCalendar(carpeta);
comprobar('la importacion la quita', cuantos() === 1, `${cuantos()} eventos`);
comprobar('y la cuenta como limpiada', r3b.limpiadas === 1, `limpiadas = ${r3b.limpiadas}`);

console.log('\n--- 4. un viernes por la noche en Nueva York NO es sabado ---\n');

// 20:00 del viernes 16 en Nueva York son las 00:00 del SABADO en UTC. Mirar
// el dia de la semana en UTC lo descartaria estando bien, y eso se cargaria
// eventos reales de cierre de sesion.
const viernesTarde = `Date,Time,Currency,Impact,Event
2026-10-16,20:00,USD,Low,Algo a ultima hora del viernes
`;
escribir('t1-2026.csv', viernesTarde);
const r4 = ingestCalendar(carpeta);

comprobar('no se descarta', r4.finDeSemana === 0, `finDeSemana = ${r4.finDeSemana}`);
comprobar(
  'y esta en la base',
  eventos().some((e) => e.title.includes('ultima hora')),
  eventos().map((e) => e.title).join(', '),
);
comprobar(
  'aunque en UTC caiga ya en sabado',
  eventos().some((e) => new Date(e.ts).getUTCDay() === 6),
  eventos().map((e) => new Date(e.ts).toISOString()).join(', '),
);

console.log('\n--- 5. un JSON de solo nombres se declara como tal ---\n');

// El catalogo de Investing: 'event_id' y nombre, sin 'occurrence_time'. Por si
// solo no aporta ni una prevision, y callarselo deja al usuario creyendo que
// ya tiene el calendario importado.
escribir('eventos-investing.json', JSON.stringify([
  { event_id: 1, event_translated: 'Cambio del empleo no agricola ADP', importance: 'high', category: 'employment', currency: 'USD' },
  { event_id: 8, event_translated: 'Ingresos medios por hora', importance: 'high', category: 'employment', currency: 'USD' },
]));

const r5 = ingestCalendar(carpeta);
comprobar(
  'se avisa de que es solo catalogo',
  r5.soloCatalogo.includes('eventos-investing.json'),
  r5.soloCatalogo.join(', '),
);
comprobar('se contaron los nombres', r5.named >= 2, `named = ${r5.named}`);
comprobar('y ninguna fecha', r5.read === 1, `read = ${r5.read} (solo el csv)`);

// Y el caso contrario: un JSON CON ocurrencias no debe avisar de nada.
escribir('eventos-investing.json', JSON.stringify([
  { event_id: 1, event_translated: 'CPI', importance: 'high', category: 'prices', currency: 'USD' },
  {
    event_id: 1, occurrence_id: 99, occurrence_time: '2026-10-15T12:30:00Z',
    forecast: 0.2, previous: 0.1, actual: 0.3,
  },
]));
const r5b = ingestCalendar(carpeta);
comprobar('con ocurrencias ya no avisa', r5b.soloCatalogo.length === 0);
comprobar(
  'y la prevision llega a la base',
  (db().prepare('SELECT COUNT(*) n FROM economic_events WHERE forecast IS NOT NULL').get() as { n: number }).n === 1,
);

console.log('\n--- 6. una carpeta solo con documentacion no hace nada ---\n');

rmSync(carpeta, { recursive: true, force: true });
mkdirSync(carpeta, { recursive: true });
db().prepare('DELETE FROM economic_events').run();
escribir('plantilla.csv', CSV_BUENO);

const r6 = ingestCalendar(carpeta);
comprobar('no lee ningun fichero', r6.files === 0, `${r6.files}`);
comprobar('no mete nada', cuantos() === 0);
comprobar('pero dice que vio la plantilla', r6.plantillas.includes('plantilla.csv'));

console.log('');
console.log(`${ok} OK, ${fallos} fallos`);
rmSync(dir, { recursive: true, force: true });
if (fallos > 0) process.exit(1);
