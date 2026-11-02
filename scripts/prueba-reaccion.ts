/**
 * La reaccion a las noticias, sobre una base de juguete.
 *
 * Lo que de verdad hay que proteger aqui no es la aritmetica -restar dos
 * cierres no tiene misterio- sino las tres formas que tiene este panel de
 * mentir sin romperse:
 *
 *   1. CONTAR DOS VECES EL MISMO MOVIMIENTO. El "Core CPI m/m" y el "CPI m/m"
 *      salen el mismo minuto: dos filas del calendario, un solo movimiento del
 *      precio. Si la direccion los cuenta por separado, la muestra parece el
 *      doble de grande de lo que es.
 *   2. REGALAR EL CONTRASTE CON LA LINEA BASE. Si en la comparacion entran
 *      sabados y domingos -rango cero, mercado cerrado- la base se hunde y
 *      CUALQUIER noticia parece moverlo todo.
 *   3. ESCONDER UN EVENTO QUE NO CUADRA. Un dato economico fechado donde no
 *      hay mercado es una fila mal importada, no un hueco de velas. Si el
 *      panel lo quita de la lista, el dato inventado se queda en la base para
 *      siempre.
 *
 * Y una cuarta, de confianza: el contraste tiene que dar SIEMPRE el mismo
 * numero con los mismos datos. Un p que cambia en cada recarga no se puede
 * citar.
 *
 *   npx tsx scripts/prueba-reaccion.ts
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tj-reac-'));
const ruta = join(dir, 'prueba.db');
process.env.JOURNAL_DB = ruta;
console.log(`base temporal: ${ruta}`);

const { db } = await import('../src/db/index.js');
const { reaccion, HORIZONTES, pMoneda } = await import('../src/domain/reaction.js');

let ok = 0;
let fallos = 0;

function comprobar(titulo: string, cond: boolean, detalle = '') {
  if (cond) { ok++; console.log(`OK   ${titulo}${detalle ? ' · ' + detalle : ''}`); }
  else { fallos++; console.log(`FALLO ${titulo}${detalle ? ' · ' + detalle : ''}`); }
}

const SYM = 'MNQZ26';
const MIN = 60_000;

/** Un dia concreto a una hora UTC concreta. */
const en = (y: number, m: number, d: number, hh: number, mm = 0) => Date.UTC(y, m - 1, d, hh, mm);

/**
 * Siembra 90 minutos de velas de un minuto a partir de `desde`.
 *
 * `amplitud` es cuanto oscila el precio dentro de cada vela: es la palanca que
 * convierte un dia en "movido" o "tranquilo" sin tocar nada mas.
 */
function velas(desde: number, minutos: number, precio: number, amplitud: number, deriva = 0) {
  const ins = db().prepare(
    'INSERT OR REPLACE INTO bars (symbol, ts, o, h, l, c, tick_size) VALUES (?, ?, ?, ?, ?, ?, 0.25)',
  );
  let c = precio;
  for (let i = 0; i < minutos; i++) {
    const o = c;
    c = o + deriva;
    ins.run(SYM, desde + i * MIN, o, Math.max(o, c) + amplitud, Math.min(o, c) - amplitud, c);
  }
}

function evento(id: string, ts: number, title: string, impact = 'high', source = 'prueba.csv') {
  db().prepare(
    'INSERT OR REPLACE INTO economic_events (id, ts, title, impact, currency, source) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, ts, title, impact, 'USD', source);
}

// ---------------------------------------------------------------------------
// La base de juguete: cuatro semanas de laborables con velas a las 12:30.
// Los dias tranquilos oscilan 1 punto por vela; los de noticia, 10.
// ---------------------------------------------------------------------------

console.log('\n--- montando la base ---\n');

const LABORABLES: Array<[number, number]> = [];
for (let d = 5; d <= 30; d++) {
  const dow = new Date(Date.UTC(2026, 9, d)).getUTCDay();
  if (dow !== 0 && dow !== 6) LABORABLES.push([10, d]);
}
// Y dos findes, que NO deben entrar en la linea base.
const FINDES: Array<[number, number]> = [[10, 10], [10, 11], [10, 17], [10, 18]];

const CON_NOTICIA = new Set([14, 21, 28]);

for (const [m, d] of LABORABLES) {
  const movido = CON_NOTICIA.has(d);
  velas(en(2026, m, d, 12, 20), 90, 30000, movido ? 10 : 1, movido ? 2 : 0);
}
for (const [m, d] of FINDES) {
  // Fin de semana: velas planas, rango practicamente cero.
  velas(en(2026, m, d, 12, 20), 90, 30000, 0);
}

for (const d of CON_NOTICIA) evento(`ev-${d}`, en(2026, 10, d, 12, 30), `Dato del ${d}`);

// Dos filas en el MISMO minuto, como el Core CPI y el CPI.
evento('ev-28-bis', en(2026, 10, 28, 12, 30), 'Dato del 28 (nucleo)');

// Y uno fechado en sabado, donde no hay velas: la fila mal importada.
evento('ev-sabado', en(2026, 10, 24, 12, 30), 'Dato imposible en sabado');

const r = reaccion(SYM);

console.log('\n--- 1. no contar dos veces el mismo movimiento ---\n');

comprobar(
  'las dos filas del mismo minuto salen las dos en la lista',
  r.eventos.filter((e) => e.ts === en(2026, 10, 28, 12, 30)).length === 2,
);
comprobar(
  'pero la direccion cuenta un solo momento por minuto',
  r.direccion !== null && r.direccion.momentos === 3,
  `momentos = ${r.direccion?.momentos} con 4 filas medibles`,
);
comprobar(
  'y a favor + en contra cuadra con los momentos',
  r.direccion !== null && r.direccion.aFavor + r.direccion.enContra === r.direccion.momentos,
);

console.log('\n--- 2. la linea base no se regala con los findes ---\n');

const franja = r.franjas.find((f) => f.hhmm === '12:30');
comprobar('hay franja de las 12:30', franja !== undefined);

if (franja) {
  comprobar(
    'el fin de semana NO entra en la linea base',
    franja.nSin === LABORABLES.length - CON_NOTICIA.size,
    `${franja.nSin} dias sin noticia, y hay ${LABORABLES.length} laborables y ${FINDES.length} findes sembrados`,
  );
  comprobar(
    'los dias de noticia cuentan como "con"',
    franja.nCon === CON_NOTICIA.size,
    `nCon = ${franja.nCon}`,
  );
  comprobar(
    'la mediana con noticia es mayor que sin ella',
    franja.medianaCon > franja.medianaSin,
    `${franja.medianaCon.toFixed(1)} vs ${franja.medianaSin.toFixed(1)}`,
  );
  comprobar(
    'con una diferencia tan marcada, el contraste la detecta',
    franja.p < 0.05,
    `p = ${franja.p.toFixed(4)}`,
  );
  comprobar('el ratio es mayor que 1', franja.ratio > 1, `×${franja.ratio.toFixed(2)}`);
}

console.log('\n--- 3. el evento que no cuadra NO se esconde ---\n');

const sabado = r.eventos.find((e) => e.id === 'ev-sabado');
comprobar('el evento del sabado sale en la lista', sabado !== undefined);
comprobar(
  'y lleva escrito por que no se pudo medir',
  sabado !== undefined && sabado.problema !== null,
  sabado?.problema ?? '(sin problema, que es el fallo)',
);
comprobar(
  'un evento con problema no tiene movimientos inventados',
  sabado !== undefined && sabado.movimientos.length === 0 && sabado.rango60 === null,
);
comprobar(
  'y no entra en la direccion',
  r.direccion !== null && r.direccion.momentos === 3,
);

console.log('\n--- 4. el contraste es reproducible ---\n');

// Se fuerza un recalculo metiendo y quitando una vela, para que la clave de
// cache cambie y vuelva a pasar por la permutacion de verdad.
const antes = r.franjas.map((f) => f.p).join(',');
velas(en(2026, 10, 30, 23, 0), 1, 30000, 1);
db().prepare('DELETE FROM bars WHERE symbol = ? AND ts = ?').run(SYM, en(2026, 10, 30, 23, 0));
const otra = reaccion(SYM);
comprobar(
  'los mismos datos dan exactamente el mismo p',
  otra.franjas.map((f) => f.p).join(',') === antes,
  antes,
);

console.log('\n--- 5. lo que mide cada evento ---\n');

const uno = r.eventos.find((e) => e.id === 'ev-14');
comprobar('hay un horizonte por cada valor de HORIZONTES', uno !== undefined && uno.movimientos.length === HORIZONTES.length);
comprobar(
  'los horizontes salen en orden y son los esperados',
  uno !== undefined && uno.movimientos.map((m) => m.min).join(',') === HORIZONTES.join(','),
  uno?.movimientos.map((m) => m.min).join(','),
);
comprobar(
  'con deriva positiva, el movimiento crece con el horizonte',
  uno !== undefined && uno.movimientos.every((m, i) => i === 0 || m.puntos > uno.movimientos[i - 1]!.puntos),
  uno?.movimientos.map((m) => m.puntos.toFixed(0)).join(' / '),
);
comprobar(
  'la referencia es el cierre de la vela ANTERIOR al evento, no la del evento',
  uno !== undefined && uno.previo !== null && uno.movimientos[0]!.puntos === 5 * 2,
  `previo = ${uno?.previo}, +5m = ${uno?.movimientos[0]?.puntos}`,
);
comprobar(
  'el rango de 60 minutos es mayor que el movimiento neto',
  uno !== undefined && uno.rango60 !== null && uno.rango60 > Math.abs(uno.movimientos.at(-1)!.puntos),
  `rango ${uno?.rango60?.toFixed(1)} vs neto ${uno?.movimientos.at(-1)?.puntos.toFixed(1)}`,
);

console.log('\n--- 5b. la binomial que decide si es una moneda ---\n');

// Sin esto, "9 de 15" se lee como tendencia. Es lo que mas se parece a una
// interpretacion de todo el panel, asi que es lo que mas vigilancia pide.
comprobar('mitad y mitad da p = 1', pMoneda(5, 10) === 1, `${pMoneda(5, 10)}`);
comprobar('9 de 15 es indistinguible del azar', pMoneda(9, 15) > 0.5, `p = ${pMoneda(9, 15).toFixed(3)}`);
comprobar('8 de 15 tambien', pMoneda(8, 15) > 0.5, `p = ${pMoneda(8, 15).toFixed(3)}`);
comprobar('14 de 15 ya no', pMoneda(14, 15) < 0.01, `p = ${pMoneda(14, 15).toFixed(5)}`);
comprobar('todas a favor es el caso mas extremo', pMoneda(15, 15) < pMoneda(14, 15));
comprobar('y es simetrico: 0 de 15 da lo mismo que 15 de 15', pMoneda(0, 15) === pMoneda(15, 15));
comprobar('13 de 20 todavia no convence', pMoneda(13, 20) > 0.05, `p = ${pMoneda(13, 20).toFixed(3)}`);
// Con 600 lanzamientos los factoriales desbordarian; la recurrencia no. El
// resultado no sale 1 EXACTO porque sumar 601 probabilidades acumula error de
// redondeo, y eso es correcto: lo que no vale es que salga NaN o 0.
comprobar(
  'no se desborda con muestras grandes',
  Number.isFinite(pMoneda(300, 600)) && pMoneda(300, 600) > 0.999,
  `300/600 -> ${pMoneda(300, 600)}`,
);
comprobar(
  'y con 600 lanzamientos si distingue un sesgo pequenio',
  pMoneda(340, 600) < 0.01,
  `340/600 -> ${pMoneda(340, 600).toFixed(6)}`,
);
comprobar('sin muestra no afirma nada', pMoneda(0, 0) === 1);

console.log('\n--- 6. el estado del calendario se cuenta bien ---\n');

comprobar('cuenta todos los eventos', r.calendario.total === 5, `${r.calendario.total}`);
comprobar('ninguno trae prevision', r.calendario.conPrevision === 0);
comprobar('ninguno trae dato real', r.calendario.conDatoReal === 0);

db().prepare('UPDATE economic_events SET forecast = 4.0, actual = 4.2 WHERE id = ?').run('ev-14');
const conDato = reaccion(SYM);
comprobar(
  'y si se rellena uno, se nota al instante',
  conDato.calendario.conPrevision === 1 && conDato.calendario.conDatoReal === 1,
  `prevision ${conDato.calendario.conPrevision}, real ${conDato.calendario.conDatoReal}`,
);

console.log('\n--- 7. una base sin nada no inventa nada ---\n');

db().prepare('DELETE FROM economic_events').run();
const sinEventos = reaccion(SYM);
comprobar('sin eventos no hay franjas', sinEventos.franjas.length === 0);
comprobar('sin eventos no hay direccion', sinEventos.direccion === null);
comprobar('y no afirma haber medido nada', sinEventos.eventos.length === 0);

db().prepare('DELETE FROM bars').run();
const sinVelas = reaccion(SYM);
comprobar('sin velas tampoco', sinVelas.direccion === null && sinVelas.franjas.length === 0);

console.log('');
console.log(`${ok} OK, ${fallos} fallos`);
rmSync(dir, { recursive: true, force: true });
if (fallos > 0) process.exit(1);
