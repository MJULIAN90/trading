#!/usr/bin/env node
/**
 * Compartir las VELAS con otra persona, sin compartir tus operaciones.
 *
 * Para que sirve: el diario bebe de dos sitios. Las operaciones las escribe
 * Quantower en el ordenador de cada uno, asi que cada diario consigue las
 * suyas solo. Las velas las escribe el indicador j_Flujo, y quien no lo tenga
 * puesto se queda con la pestaña Mercado vacia.
 *
 * Y aqui esta la clave: las velas son DATO DE MERCADO. El OHLC del MNQ a las
 * 10:00 es el mismo para todo el mundo. Asi que no hace falta que esa persona
 * capture nada ni monte ningun indicador: basta con pasarle las tuyas.
 *
 * Lo que NO viaja: operations, fills, notas y etiquetas. Eso es tuyo.
 *
 *   node scripts/velas-compartidas.mjs exportar
 *   node scripts/velas-compartidas.mjs importar <fichero>
 */

import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * better-sqlite3 se carga a mano y no con `import` arriba a proposito.
 *
 * Un `import` que falla revienta ANTES de que corra una sola linea de este
 * fichero, y lo que ve quien lo lanza es un volcado de Node hablando de
 * paquetes ESM. Cargandolo asi, el fallo se puede traducir a la unica causa
 * real que tiene: que en esa carpeta nunca se instalaron las dependencias.
 */
let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  console.error('');
  console.error('Falta la libreria de base de datos (better-sqlite3).');
  console.error('');
  console.error('Casi siempre es que en esta carpeta no se han instalado las');
  console.error('dependencias todavia. Se arregla con:');
  console.error('');
  console.error('  pnpm install');
  console.error('');
  process.exit(1);
}

/**
 * Los dos comandos trabajan con rutas relativas (`data/journal.db`,
 * `velas-compartidas.db`), asi que lanzarlos desde el Escritorio o desde
 * dentro de `scripts\` no encuentra nada. En vez de dar un "no encuentro el
 * fichero" que despista, se comprueba primero donde estamos parados.
 */
if (!existsSync(resolve('./package.json')) || !existsSync(resolve('./scripts'))) {
  console.error('');
  console.error('Esto hay que lanzarlo DESDE LA CARPETA DEL PROYECTO.');
  console.error('');
  console.error(`  Ahora mismo estas en:  ${process.cwd()}`);
  console.error('');
  console.error('Abre la terminal en la carpeta que tiene dentro package.json');
  console.error('(la del proyecto, no la de scripts) y repite el comando.');
  console.error('');
  process.exit(1);
}

const LOCAL = resolve(process.env.JOURNAL_DB ?? './data/journal.db');

/** Tablas con informacion personal. Nunca salen de tu maquina. */
const PERSONALES = ['operations', 'fills', 'operation_notes', 'operation_tags', 'ingest_runs'];

/**
 * El crudo del que ya salieron las velas. Pesa el 85% del fichero y no aporta
 * nada a quien solo quiere ver el mercado: va aparte para no confundirlo con
 * lo personal, porque se borra por tamaño, no por privacidad.
 */
const CRUDO = ['context_snapshots'];

/** Tablas de mercado: iguales para cualquiera que mire el mismo simbolo. */
const MERCADO = ['bars', 'economic_events', 'market_holidays'];

const mb = (p) => (statSync(p).size / 1e6).toFixed(0);
const existe = (db, t) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t) !== undefined;
const filas = (db, t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

/** Nombres de columna de una tabla, en el orden en que las declara el esquema. */
function columnas(db, tabla, esquema = 'main') {
  return db.prepare(`PRAGMA ${esquema}.table_info(${tabla})`).all().map((c) => c.name);
}

function exportar() {
  const salida = resolve('./velas-compartidas.db');

  if (!existsSync(LOCAL)) {
    console.error(`No encuentro ${LOCAL}`);
    process.exit(1);
  }

  // Se trabaja sobre una COPIA. Nunca sobre la base buena: un borrado mal
  // escrito en el original no tiene vuelta atras.
  if (existsSync(salida)) unlinkSync(salida);
  copyFileSync(LOCAL, salida);

  const db = new Database(salida);

  // WAL a off: el fichero tiene que ser autocontenido para poder mandarlo por
  // correo o copiarlo a un USB. Con WAL, lo mas reciente vive en un fichero
  // aparte y se perderia por el camino.
  db.pragma('journal_mode = DELETE');

  let borradas = 0;

  for (const t of [...PERSONALES, ...CRUDO]) {
    // Que una tabla no exista en esta version no es un problema; que exista y
    // no se pueda vaciar SI lo es, y entonces se para. Un fichero que sale
    // con operaciones dentro es justo lo que este script existe para evitar.
    if (!existe(db, t)) continue;

    const n = filas(db, t);
    db.prepare(`DELETE FROM ${t}`).run();

    const quedan = filas(db, t);
    if (quedan > 0) {
      console.error(`\nNo pude vaciar ${t}: quedan ${quedan} filas. No genero el fichero.`);
      db.close();
      unlinkSync(salida);
      process.exit(1);
    }

    if (n > 0) {
      const nota = CRUDO.includes(t) ? ' (el crudo, ya derivado)' : '';
      console.log(`  fuera  ${t.padEnd(18)} ${String(n).padStart(8)} filas${nota}`);
      if (!CRUDO.includes(t)) borradas += n;
    }
  }

  console.log('');
  for (const t of MERCADO) {
    if (existe(db, t)) console.log(`  viaja  ${t.padEnd(18)} ${String(filas(db, t)).padStart(8)} filas`);
  }

  db.exec('VACUUM');
  db.close();

  console.log('');
  console.log(`Listo: ${salida}  (${mb(salida)} MB)`);
  console.log(`Se quitaron ${borradas} filas personales.`);
  console.log('');
  console.log('Pasale ese fichero y que lo importe con:');
  console.log('  node scripts/velas-compartidas.mjs importar velas-compartidas.db');
}

function importar(ruta) {
  const origen = resolve(ruta);

  if (!existsSync(origen)) {
    console.error('');
    console.error(`No encuentro el fichero: ${origen}`);

    // Enseñar lo que SI hay al lado ahorra la vuelta entera: casi siempre el
    // fichero esta ahi con otro nombre, o metido en una subcarpeta.
    const sueltas = readdirSync(process.cwd()).filter((f) => f.endsWith('.db'));
    console.error('');
    if (sueltas.length > 0) {
      console.error('En esta carpeta veo estas bases:');
      for (const f of sueltas) console.error(`  ${f}`);
      console.error('');
      console.error('Usa el nombre tal cual sale arriba.');
    } else {
      console.error('En esta carpeta no hay ningun .db.');
      console.error('Copia velas-compartidas.db aqui, al lado de package.json,');
      console.error('y no dentro de scripts\\ ni en el Escritorio.');
    }
    console.error('');
    process.exit(1);
  }

  if (!existsSync(LOCAL)) {
    console.error('');
    console.error(`No encuentro tu base del diario: ${LOCAL}`);
    console.error('');
    console.error('Esa base la crea el propio diario la primera vez que arranca.');
    console.error('Arrancalo una vez con:');
    console.error('');
    console.error('  pnpm dev');
    console.error('');
    console.error('espera a que abra la pagina, cierralo, y repite la importacion.');
    console.error('');
    process.exit(1);
  }

  const db = new Database(LOCAL);
  db.exec(`ATTACH DATABASE '${origen.replace(/'/g, "''")}' AS origen`);

  console.log('Tus operaciones NO se tocan. Solo entran velas y calendario.');
  console.log('');

  let fallos = 0;

  for (const t of MERCADO) {
    if (!existe(db, t)) {
      console.log(`  ${t.padEnd(18)} no existe en tu base, se salta`);
      continue;
    }
    if (!db.prepare("SELECT 1 FROM origen.sqlite_master WHERE type='table' AND name=?").get(t)) {
      continue;
    }

    try {
      const antes = filas(db, `main.${t}`);

      // Columnas por nombre y no SELECT *: si una de las dos bases va una
      // version por delante, el numero de columnas no cuadra y el INSERT se
      // cae entero. Nombrandolas, viaja lo que tienen en comun y lo que
      // sobra se queda fuera sin romper nada.
      const comunes = columnas(db, t, 'main').filter((c) => columnas(db, t, 'origen').includes(c));
      if (comunes.length === 0) {
        console.log(`  ${t.padEnd(18)} sin columnas en comun, se salta`);
        fallos++;
        continue;
      }

      const lista = comunes.map((c) => `"${c}"`).join(', ');

      // OR IGNORE y no REPLACE: si una vela ya esta, se respeta la tuya. Las
      // dos deberian ser identicas -es el mismo mercado-, pero ante la duda
      // manda lo que capturaste tu.
      db.prepare(`INSERT OR IGNORE INTO main.${t} (${lista}) SELECT ${lista} FROM origen.${t}`).run();

      const despues = filas(db, `main.${t}`);
      const aviso = comunes.length < columnas(db, t, 'main').length ? '  (columnas parciales)' : '';
      console.log(
        `  ${t.padEnd(18)} ${String(antes).padStart(8)} -> ${String(despues).padStart(8)}  (+${despues - antes})${aviso}`,
      );
    } catch (e) {
      console.log(`  ${t.padEnd(18)} FALLO: ${e.message}`);
      fallos++;
    }
  }

  db.exec('DETACH DATABASE origen');
  db.close();

  console.log('');
  if (fallos > 0) {
    console.error(`${fallos} tabla(s) no entraron. La pestaña Mercado puede seguir vacia.`);
    process.exit(1);
  }
  console.log('Hecho. Recarga el diario y la pestaña Mercado deberia tener datos.');
}

const [modo, arg] = process.argv.slice(2);

if (modo === 'exportar') exportar();
else if (modo === 'importar' && arg) importar(arg);
else {
  console.log('Uso:');
  console.log('  node scripts/velas-compartidas.mjs exportar');
  console.log('  node scripts/velas-compartidas.mjs importar <fichero.db>');
}
