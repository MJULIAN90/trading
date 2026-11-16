/**
 * DOCTOR DE DIBUJO: por que a veces se ven los indicadores y a veces no.
 *
 *   node scripts/doctor-graficos.mjs            (el log de hoy)
 *   node scripts/doctor-graficos.mjs 20261110   (el de un dia concreto)
 *
 * Lee el log de Quantower SIN cargarlo en memoria -- son cientos de megas al
 * dia -- y cuenta las excepciones de repintado por tipo y por tramos de diez
 * minutos.
 *
 * Por que existe. El 10 de noviembre el log traia 384.015 excepciones en
 * `PlateIndicator.getBrush` dentro de `PlateBase.Draw`, que es la PLACA DE
 * DATOS de Quantower. Esa excepcion sube hasta `ChartBase.OnMainThreadDrawing`
 * y aborta la pasada de dibujo entera, asi que el indicador deja de pintarse
 * sin dar ni un error propio. Y como la placa falla segun por que vela pasa el
 * raton (`lastMouseHoverBarIndex` sale en la traza), un grafico se queda sin
 * dibujar y el de al lado no: es exactamente el "a veces si y a veces no".
 *
 * Esto no arregla nada. Dice si esta pasando, cuanto, y desde cuando.
 */
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const DIR = process.env.QUANTOWER_LOGS ?? 'C:\\Quantower\\Logs\\Serilog';

function ficheroDelDia(arg) {
  if (arg) return join(DIR, `${arg}.slog`);
  const hoy = new Date();
  const nombre =
    `${hoy.getFullYear()}` +
    String(hoy.getMonth() + 1).padStart(2, '0') +
    String(hoy.getDate()).padStart(2, '0');
  return join(DIR, `${nombre}.slog`);
}

const ruta = ficheroDelDia(process.argv[2]);

if (!existsSync(ruta)) {
  console.log(`No existe ${ruta}`);
  console.log('Los que hay:');
  try {
    for (const f of readdirSync(DIR).filter((f) => f.endsWith('.slog')).sort()) console.log('  ', f);
  } catch {
    console.log('  (tampoco se pudo leer la carpeta; mira QUANTOWER_LOGS)');
  }
  process.exit(1);
}

/** La primera linea de la traza, que es la que dice QUE fallo. */
function donde(msg) {
  const m = /\s+at\s+([^\s(]+)/.exec(msg);
  return m ? m[1] : '(sin traza)';
}

const porTipo = new Map();
const porTramo = new Map();
const nuestros = new Map();
let lineas = 0;
let errores = 0;
let primera = null;
let ultima = null;

const rl = createInterface({ input: createReadStream(ruta), crlfDelay: Infinity });

for await (const linea of rl) {
  lineas++;
  // Filtro barato ANTES de parsear: parsear 400 MB de JSON tarda minutos y el
  // 99 % de las lineas no interesa.
  if (!linea.includes('"Error"') && !linea.includes('"Fatal"')) continue;

  let d;
  try {
    d = JSON.parse(linea);
  } catch {
    continue;
  }

  if (d.lvl !== 'Error' && d.lvl !== 'Fatal') continue;

  const msg = d.msg ?? d.ev ?? '';
  errores++;

  const cabeza = String(msg).split('   at ')[0].trim().slice(0, 70);
  const sitio = donde(msg);
  const clave = `${cabeza}  ←  ${sitio}`;
  porTipo.set(clave, (porTipo.get(clave) ?? 0) + 1);

  // Hora de Colombia (UTC-5) para que cuadre con tu reloj.
  const t = new Date(Date.parse(d['@t']) - 5 * 3600_000);
  const tramo = `${String(t.getUTCHours()).padStart(2, '0')}:${String(Math.floor(t.getUTCMinutes() / 10) * 10).padStart(2, '0')}`;
  porTramo.set(tramo, (porTramo.get(tramo) ?? 0) + 1);

  primera ??= t;
  ultima = t;

  // Lo que sale de NUESTRO codigo se separa: eso si lo podemos arreglar.
  for (const nuestro of ['j_Guardia', 'KillZones', 'j_Flujo']) {
    if (msg.includes(nuestro)) nuestros.set(nuestro, (nuestros.get(nuestro) ?? 0) + 1);
  }
}

console.log(`${ruta}`);
console.log(`${lineas.toLocaleString('es')} lineas · ${errores.toLocaleString('es')} errores`);
if (primera) {
  console.log(`del ${primera.toISOString().slice(11, 16)} al ${ultima.toISOString().slice(11, 16)} (hora Colombia)\n`);
}

if (errores === 0) {
  console.log('Ni un error de dibujo. Si hoy se ve todo, esta es la foto de "sano":');
  console.log('guardala y compara el dia que vuelva a desaparecer algo.');
  process.exit(0);
}

console.log('POR TIPO');
console.log('-'.repeat(100));
for (const [k, n] of [...porTipo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`${String(n).padStart(9)}x  ${k}`);
}

console.log('\nPOR TRAMOS DE 10 MINUTOS');
console.log('-'.repeat(100));
for (const [k, n] of [...porTramo.entries()].sort()) {
  // Una barra para ver de un vistazo si es constante o a rachas.
  console.log(`  ${k}  ${String(n).padStart(8)}  ${'#'.repeat(Math.min(60, Math.round(n / 500)))}`);
}

console.log('\nDE NUESTROS INDICADORES');
console.log('-'.repeat(100));
if (nuestros.size === 0) {
  console.log('  Ninguno. Todos los errores son de la plataforma.');
  console.log('  Es la buena noticia y la mala: no es codigo nuestro, y por eso');
  console.log('  no se puede arreglar desde el indicador, solo rodear.');
} else {
  for (const [k, n] of nuestros) console.log(`  ${k}: ${n}`);
}

console.log(`
COMO SE LEE

  "PlateIndicator.getBrush" o "PlateBase.Draw" en decenas de miles
      Es la placa de datos de Quantower. Aborta la pasada de dibujo del
      grafico entero, y por eso un indicador desaparece sin dar error propio.
      Depende de por que vela pasa el raton: por eso va y viene.

  Cualquier cosa con j_Guardia / KillZones / j_Flujo en la traza
      Eso SI es nuestro y se arregla. Pasamelo.

  Cero errores pero sigue desapareciendo
      Entonces no es una excepcion: es orden de dibujo o una condicion que
      devuelve antes de pintar. Tambien se mira, pero por otro lado.
`);
