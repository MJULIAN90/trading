/**
 * El calendario de dias operados: que cada dia caiga en SU columna.
 *
 * Existe por un fallo del 1 de noviembre de 2026. El hueco inicial del mes se
 * calculaba con el dia de la semana del dia 1 sin mirar si ese dia 1 cabia en
 * la rejilla. Noviembre de 2026 empieza en domingo -el 6 con lunes = 0- y seis
 * huecos en cinco columnas corrieron el mes entero: el lunes 2 salia bajo la M
 * y el viernes 6 bajo la L.
 *
 * Lo que lo hace peligroso es que NO SE ROMPE NADA A LA VISTA. El numero de la
 * casilla es correcto, la cifra es correcta y el color es correcto; lo unico
 * equivocado es la columna, que es informacion que uno lee sin leerla. Por eso
 * se prueba mes a mes y no con un par de casos sueltos.
 *
 *   npx tsx scripts/prueba-calendario.ts
 */

import { celdasDelMes, COLUMNAS, diasDelMes, weekdayMondayFirst } from '../client/src/calendario';

let ok = 0;
let fallos = 0;

function comprobar(titulo: string, cond: boolean, detalle = '') {
  if (cond) {
    ok++;
    console.log(`OK   ${titulo}${detalle ? ' · ' + detalle : ''}`);
  } else {
    fallos++;
    console.log(`FALLO ${titulo}${detalle ? ' · ' + detalle : ''}`);
  }
}

const NOMBRES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/**
 * Recorre un mes entero y devuelve el primer dia mal colocado, si lo hay.
 * Se comprueban tres cosas a la vez porque las tres fallan juntas cuando el
 * hueco inicial esta mal, y verlas por separado no aclara nada.
 */
function revisar(y: number, m: number): string | null {
  const celdas = celdasDelMes(y, m);

  if (celdas.length % COLUMNAS !== 0) return `la rejilla no es multiplo de ${COLUMNAS}: ${celdas.length}`;

  // 1. Cada dia, en la columna de su dia de la semana.
  for (let i = 0; i < celdas.length; i++) {
    const d = celdas[i];
    if (d === null) continue;
    const columna = i % COLUMNAS;
    const real = weekdayMondayFirst(y, m, d);
    if (columna !== real) {
      return `el ${d} cae en la columna ${NOMBRES[columna]} y es ${NOMBRES[real]}`;
    }
  }

  // 2. Estan TODOS los dias entre semana. Un dia con dinero que desaparece de
  //    la vista es el unico fallo que no se puede permitir en este panel.
  const presentes = new Set(celdas.filter((d): d is number => d !== null));
  for (let d = 1; d <= diasDelMes(y, m); d++) {
    const finde = weekdayMondayFirst(y, m, d) >= COLUMNAS;
    if (!finde && !presentes.has(d)) return `falta el dia ${d}`;
    if (finde && presentes.has(d)) return `el dia ${d} es fin de semana y tiene casilla`;
  }

  // 3. En orden, y sin repetir.
  const soloDias = celdas.filter((d): d is number => d !== null);
  for (let i = 1; i < soloDias.length; i++) {
    if (soloDias[i]! <= soloDias[i - 1]!) return `el ${soloDias[i]} va despues del ${soloDias[i - 1]}`;
  }

  return null;
}

console.log('--- todos los meses de 2024 a 2030 ---\n');

let revisados = 0;
let primeroMalo: string | null = null;
for (let y = 2024; y <= 2030; y++) {
  for (let m = 1; m <= 12; m++) {
    const mal = revisar(y, m);
    revisados++;
    if (mal !== null && primeroMalo === null) primeroMalo = `${y}-${String(m).padStart(2, '0')}: ${mal}`;
  }
}
comprobar(
  'los 84 meses colocan cada dia en su columna, sin perder ninguno',
  primeroMalo === null,
  primeroMalo ?? `${revisados} meses`,
);

console.log('\n--- los meses que empiezan en fin de semana, que son los que fallaban ---\n');

// Que haya de los dos: si algun dia alguien "simplifica" el bucle de arriba a
// un solo anio, estos casos siguen cubriendo la forma del fallo.
const findeSemana: Array<[number, number, string]> = [];
for (let y = 2024; y <= 2030; y++) {
  for (let m = 1; m <= 12; m++) {
    const w = weekdayMondayFirst(y, m, 1);
    if (w >= COLUMNAS) findeSemana.push([y, m, NOMBRES[w]!]);
  }
}
comprobar(
  'hay meses que empiezan en sabado o domingo en el rango probado',
  findeSemana.length > 0,
  `${findeSemana.length} de ${revisados}`,
);

for (const [y, m, dia] of findeSemana.filter(([y]) => y === 2026)) {
  const celdas = celdasDelMes(y, m);
  const primero = celdas.find((d) => d !== null)!;
  comprobar(
    `${y}-${String(m).padStart(2, '0')} empieza en ${dia} y el primer dia va en la columna L`,
    celdas.indexOf(primero) === 0 && weekdayMondayFirst(y, m, primero) === 0,
    `el primero es el ${primero}`,
  );
}

console.log('\n--- el caso exacto que se vio en pantalla ---\n');

{
  const celdas = celdasDelMes(2026, 11);
  const col = (d: number) => celdas.indexOf(d) % COLUMNAS;
  comprobar('noviembre de 2026: el 2 es lunes y va en la columna L', col(2) === 0, `columna ${NOMBRES[col(2)]}`);
  comprobar('noviembre de 2026: el 6 es viernes y va en la columna V', col(6) === 4, `columna ${NOMBRES[col(6)]}`);
  comprobar('noviembre de 2026: el 30 es lunes y va en la columna L', col(30) === 0, `columna ${NOMBRES[col(30)]}`);
  comprobar('noviembre de 2026: el 1 es domingo y no tiene casilla', !celdas.includes(1));
  comprobar('noviembre de 2026: la primera fila no esta vacia', celdas.slice(0, COLUMNAS).some((d) => d !== null));
}

{
  // Octubre de 2026 empieza en jueves y siempre salio bien: la prueba tiene
  // que seguir dandolo por bueno, o el "arreglo" habria roto lo que funcionaba.
  const celdas = celdasDelMes(2026, 10);
  const col = (d: number) => celdas.indexOf(d) % COLUMNAS;
  comprobar('octubre de 2026: el 1 es jueves y va en la columna J', col(1) === 3, `columna ${NOMBRES[col(1)]}`);
  comprobar('octubre de 2026: el 12 es lunes y va en la columna L', col(12) === 0, `columna ${NOMBRES[col(12)]}`);
  comprobar('octubre de 2026: hay tres huecos antes del dia 1', celdas.slice(0, 3).every((d) => d === null));
}

console.log('');
console.log(`${ok} OK, ${fallos} fallos`);
if (fallos > 0) process.exit(1);
