/**
 * La cesta de las diez del Nasdaq: historico, agregacion y EMA.
 *
 * Lo que de verdad hay que proteger aqui no es el promedio ponderado -es una
 * division- sino cuatro formas que tiene esto de mentir sin romperse:
 *
 *   1. GUARDAR DOCE COPIAS DE LA MISMA COTIZACION. Con el mercado cerrado se
 *      pide cada hora y el precio devuelto es siempre el de las 16:00. Si la
 *      clave fuera el momento de la PETICION, cada noche entrarian doce filas
 *      identicas y la media de la sesion saldria arrastrada por ellas.
 *   2. FECHAR EL TRAMO AL PRINCIPIO. Un punto que resume lo ocurrido entre
 *      las 10:00 y las 10:15 fechado a las 10:00 adelanta la informacion
 *      quince minutos. Es la forma mas comoda de que un estudio salga bien
 *      mirando al futuro.
 *   3. NORMALIZAR CONTRA EL QQQ ENTERO. Las diez cubren el 46,8% del indice.
 *      Dividir entre 100 en vez de entre el peso presente aplasta el
 *      porcentaje a la mitad.
 *   4. PERDER UNA EMPRESA SIN QUE SE NOTE. Si Finnhub deja de dar NVDA, la
 *      cesta sigue dibujandose igual de bonita con nueve, y NVDA es la que
 *      mas pesa. Por eso cada punto lleva cuantas empresas y cuanto peso lo
 *      sostienen.
 *
 *   npx tsx scripts/prueba-cesta.ts
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tj-cesta-'));
const ruta = join(dir, 'prueba.db');
process.env.JOURNAL_DB = ruta;
console.log(`base temporal: ${ruta}`);

const { db } = await import('../src/db/index.js');
const { saveQuotes } = await import('../src/domain/global.js');
const { cesta, ema, retrasoMinutos } = await import('../src/domain/cesta.js');

let ok = 0;
let fallos = 0;

function comprobar(titulo: string, cond: boolean, detalle = '') {
  if (cond) { ok++; console.log(`OK   ${titulo}${detalle ? ' · ' + detalle : ''}`); }
  else { fallos++; console.log(`FALLO ${titulo}${detalle ? ' · ' + detalle : ''}`); }
}

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 2, 14, 0);   // 09:00 NY

type Q = Parameters<typeof saveQuotes>[0][number];
const quote = (symbol: string, price: number, pct: number, quoteTs: number, ts = quoteTs): Q => ({
  symbol, label: symbol, kind: 'accion', price, changePct: pct, ts, quoteTs, prevClose: null,
});

const hist = () => db().prepare('SELECT COUNT(*) n FROM global_quotes_history').get() as { n: number };

console.log('\n--- 1. se guarda historico, y no se pisa ---\n');

saveQuotes([quote('NVDA', 200, 1.0, T0), quote('AAPL', 300, 2.0, T0)]);
comprobar('la primera tanda entra', hist().n === 2, `${hist().n} filas`);

saveQuotes([quote('NVDA', 201, 1.5, T0 + 5 * MIN), quote('AAPL', 301, 2.5, T0 + 5 * MIN)]);
comprobar('la segunda NO pisa a la primera', hist().n === 4, `${hist().n} filas`);

comprobar(
  'y `global_quotes` sigue teniendo solo la ultima de cada una',
  (db().prepare('SELECT COUNT(*) n FROM global_quotes').get() as { n: number }).n === 2,
);

console.log('\n--- 2. la misma cotizacion repetida no duplica ---\n');

// Mercado cerrado: se pide tres veces y el proveedor devuelve siempre el
// precio de las 16:00. Cambia `ts` (cuando preguntamos) pero no `quoteTs`.
const cierre = T0 + 400 * MIN;
saveQuotes([quote('NVDA', 210, 3.0, cierre, cierre + 10 * MIN)]);
saveQuotes([quote('NVDA', 210, 3.0, cierre, cierre + 70 * MIN)]);
saveQuotes([quote('NVDA', 210, 3.0, cierre, cierre + 130 * MIN)]);

comprobar(
  'tres peticiones de la misma cotizacion dejan UNA fila',
  hist().n === 5,
  `${hist().n} filas`,
);

console.log('\n--- 3. solo acciones ---\n');

saveQuotes([
  { symbol: 'QQQ', label: 'QQQ', kind: 'indice', price: 690, changePct: -3, ts: T0, quoteTs: T0, prevClose: null },
  { symbol: 'WTI', label: 'WTI', kind: 'materia', price: 60, changePct: 1, ts: T0, quoteTs: T0, prevClose: null },
]);
comprobar('el indice y la materia prima NO entran al historico', hist().n === 5, `${hist().n} filas`);

console.log('\n--- 4. el promedio ponderado ---\n');

db().prepare('DELETE FROM global_quotes_history').run();

// Pesos reales: NVDA 8.3, TSLA 2.8. Si NVDA sube 10 y TSLA baja 10, el
// ponderado tiene que irse claramente hacia NVDA, no quedarse en cero.
saveQuotes([quote('NVDA', 200, 10, T0), quote('TSLA', 400, -10, T0)]);
const c1 = cesta(T0 - MIN, T0 + 60 * MIN, 15);
comprobar('sale un punto', c1.length === 1, `${c1.length} puntos`);

if (c1[0]) {
  const esperado = (8.3 * 10 + 2.8 * -10) / (8.3 + 2.8);
  comprobar(
    'el ponderado se inclina hacia la que mas pesa',
    Math.abs(c1[0].pct - esperado) < 1e-9,
    `${c1[0].pct.toFixed(4)} % (esperado ${esperado.toFixed(4)})`,
  );
  comprobar('una media simple habria dado cero, y no es eso', Math.abs(c1[0].pct) > 3);
  comprobar('dice cuantas empresas lo sostienen', c1[0].empresas === 2, `${c1[0].empresas}`);
  comprobar('y cuanto peso', Math.abs(c1[0].peso - 11.1) < 1e-9, `${c1[0].peso}`);
}

console.log('\n--- 5. normalizar contra el peso PRESENTE ---\n');

db().prepare('DELETE FROM global_quotes_history').run();
saveQuotes([quote('NVDA', 200, 5, T0)]);
const c2 = cesta(T0 - MIN, T0 + 60 * MIN, 15);
comprobar(
  'con una sola empresa al 5%, la cesta dice 5% y no 0,4%',
  c2.length === 1 && Math.abs(c2[0]!.pct - 5) < 1e-9,
  `${c2[0]?.pct.toFixed(4)} %`,
);
comprobar('pero avisa de que la sostiene una sola', c2[0]?.empresas === 1);

console.log('\n--- 6. la agregacion, y de donde sale cada punto ---\n');

db().prepare('DELETE FROM global_quotes_history').run();

// Tres muestras de 5 minutos dentro del mismo tramo de 15. La ULTIMA manda.
saveQuotes([quote('NVDA', 200, 1, T0)]);
saveQuotes([quote('NVDA', 201, 2, T0 + 5 * MIN)]);
saveQuotes([quote('NVDA', 202, 3, T0 + 10 * MIN)]);
saveQuotes([quote('NVDA', 203, 9, T0 + 15 * MIN)]);   // ya es el tramo siguiente

const c3 = cesta(T0 - MIN, T0 + 60 * MIN, 15);
comprobar('tres muestras de 5 min hacen UN punto de 15', c3.length === 2, `${c3.length} puntos`);
comprobar(
  'y ese punto vale lo que la ULTIMA muestra del tramo, no el promedio',
  c3[0] !== undefined && Math.abs(c3[0].pct - 3) < 1e-9,
  `${c3[0]?.pct} (el promedio habria sido 2)`,
);
comprobar(
  'el punto se fecha al FINAL del tramo, no al principio',
  c3[0]?.ts === T0 + 15 * MIN,
  new Date(c3[0]?.ts ?? 0).toISOString().slice(11, 16),
);

const c4 = cesta(T0 - MIN, T0 + 60 * MIN, 5);
comprobar('a 5 minutos salen las cuatro muestras', c4.length === 4, `${c4.length} puntos`);
comprobar(
  'el marco se decide AL LEER: los mismos datos dan 2 o 4 puntos',
  c3.length === 2 && c4.length === 4,
);

console.log('\n--- 7. la EMA ---\n');

comprobar('sin datos no inventa nada', ema([], 5).length === 0);
comprobar('se siembra con el primer valor, no con cero', ema([10, 10, 10], 5)[0] === 10);
comprobar('con la serie plana se queda plana', ema([7, 7, 7, 7], 3).every((x) => Math.abs(x - 7) < 1e-9));

{
  // La propiedad que ahorra una decision: EMA(cesta) == cesta(EMAs).
  const W = [8.3, 2.8];
  const S = W[0]! + W[1]!;
  const a = [1, 2, 3, 5, 8, 13, 21];
  const b = [2, 1, 0, -1, 3, 5, 9];
  const compuesto = a.map((_, i) => (W[0]! * a[i]! + W[1]! * b[i]!) / S);
  const emaDelCompuesto = ema(compuesto, 4);
  const ea = ema(a, 4);
  const eb = ema(b, 4);
  const compuestoDeEmas = ea.map((_, i) => (W[0]! * ea[i]! + W[1]! * eb[i]!) / S);
  const dif = Math.max(...emaDelCompuesto.map((v, i) => Math.abs(v - compuestoDeEmas[i]!)));
  comprobar(
    'la EMA de la cesta es la misma linea que la cesta de las EMAs',
    dif < 1e-9,
    `diferencia maxima ${dif.toExponential(2)}`,
  );
}

console.log('\n--- 8. el retraso, que es donde se cuela el numero de otro grafico ---\n');

comprobar('su EMA 21 sobre velas de 1 min retrasa 10 minutos', retrasoMinutos(21, 1) === 10);
comprobar(
  'la MISMA EMA 21 sobre muestras de 15 min retrasa 150',
  retrasoMinutos(21, 15) === 150,
  `${retrasoMinutos(21, 15)} min, y una sesion de cotizacion tiene 390`,
);
comprobar(
  'para que se parezca a su EMA 21 en minutos de reloj, sobre 15 min el periodo es 2,3',
  Math.abs(retrasoMinutos(2.3333333333333335, 15) - 10) < 1e-6,
);
comprobar('un periodo de 1 no retrasa nada', retrasoMinutos(1, 15) === 0);

console.log('\n--- 9. una base vacia no inventa una linea ---\n');

db().prepare('DELETE FROM global_quotes_history').run();
comprobar('sin historico no hay puntos', cesta(T0 - MIN, T0 + 60 * MIN, 15).length === 0);
comprobar('un marco de cero minutos no revienta', cesta(T0, T0 + MIN, 0).length === 0);

console.log('');
console.log(`${ok} OK, ${fallos} fallos`);
// En Windows SQLite mantiene el fichero abierto y rmSync da EPERM hasta que
// se cierra la conexion.
db().close();
rmSync(dir, { recursive: true, force: true });
if (fallos > 0) process.exit(1);
