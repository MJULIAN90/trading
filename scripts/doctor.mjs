#!/usr/bin/env node
/**
 * Revision de la instalacion: dice que falta y que hay que hacer, en vez de
 * dejar que el servidor falle a medias.
 *
 * Node puro, sin dependencias: tiene que poder ejecutarse ANTES de instalar
 * nada, que es justo cuando mas falta hace.
 *
 *   node scripts/doctor.mjs
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const OK = 'OK  ';
const WARN = 'AVISO';
const FAIL = 'FALLA';

let fails = 0;
let warns = 0;

function say(level, title, detail) {
  if (level === FAIL) fails++;
  if (level === WARN) warns++;
  console.log(`[${level.padEnd(5)}] ${title}`);
  if (detail) for (const l of String(detail).split('\n')) console.log(`          ${l}`);
}

function section(name) {
  console.log(`\n--- ${name} ---`);
}

/** Lee el .env de la raiz sin pisar lo que ya haya en el entorno. */
function env(key, fallback) {
  if (process.env[key] !== undefined) return process.env[key];
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return fallback;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    let v = line.slice(eq + 1).trim();
    if (v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return fallback;
}

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ---------------------------------------------------------------- herramientas

section('Herramientas');

const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) {
  say(OK, `Node ${process.versions.node}`);
} else {
  say(
    FAIL,
    `Node ${process.versions.node} es demasiado antiguo`,
    'Hace falta Node 20 LTS o superior (recomendado 22 LTS).\n' +
      'Fastify 5, Vite y tsx fallan con versiones anteriores, y los tres dan\n' +
      'errores que no mencionan la version, asi que se pierde mucho tiempo.',
  );
}

if (existsSync(join(ROOT, 'node_modules'))) {
  say(OK, 'Dependencias instaladas');

  // El binario nativo de better-sqlite3 es el fallo numero uno al montar esto
  // en otra maquina: con pnpm el postinstall viene bloqueado por defecto.
  try {
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    const probe = new Database(':memory:');
    probe.close();
    say(OK, 'better-sqlite3 carga su binario nativo');
  } catch (e) {
    say(
      FAIL,
      'better-sqlite3 no puede cargar su binario nativo',
      `${String(e).split('\n')[0]}\nArreglo:  pnpm rebuild better-sqlite3   (o  npm rebuild better-sqlite3)`,
    );
  }
} else {
  say(FAIL, 'Faltan las dependencias', 'Ejecuta:  pnpm install   (o  npm install)');
}

if (existsSync(join(ROOT, 'web', 'index.html'))) {
  say(OK, 'Front compilado en web/');
} else {
  say(
    WARN,
    'El front no esta compilado',
    'Ejecuta:  pnpm build\nSin esto el servidor arranca pero la pagina sale vacia.',
  );
}

// ------------------------------------------------------------------ quantower

section('Quantower');

const qwRoot = env('QUANTOWER_ROOT', 'C:\\Quantower');

if (existsSync(qwRoot)) {
  say(OK, `Instalacion encontrada en ${qwRoot}`);
} else {
  say(
    WARN,
    `No existe ${qwRoot}`,
    'Si Quantower esta en otra ruta, ponla en .env como QUANTOWER_ROOT.\n' +
      'Si esta maquina solo analiza datos copiados, esto no es un problema.',
  );
}

const explicitDb = env('QUANTOWER_TRADES_DB', '');
const cacheRoot = join(qwRoot, 'UserTradesCache');
const found = [];

if (explicitDb) {
  if (existsSync(explicitDb)) say(OK, `user-trades.db fijado a mano: ${explicitDb}`);
  else say(FAIL, `QUANTOWER_TRADES_DB apunta a algo que no existe: ${explicitDb}`);
} else if (existsSync(cacheRoot)) {
  for (const d of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const c = join(cacheRoot, d.name, 'user-trades.db');
    if (existsSync(c)) found.push(c);
  }

  if (found.length === 1) {
    say(OK, 'Una cuenta encontrada', `${found[0]}  (${mb(statSync(found[0]).size)})`);
  } else if (found.length > 1) {
    // Importante: el buscador automatico se queda con la PRIMERA. Con varias
    // cuentas, elegir por orden alfabetico de una carpeta con nombre generado
    // es elegir al azar.
    say(
      WARN,
      `Hay ${found.length} cuentas y el diario coge la primera`,
      found.map((f) => `  ${f}`).join('\n') +
        '\nFija cual quieres en .env:  QUANTOWER_TRADES_DB=<ruta completa>',
    );
  } else {
    say(
      WARN,
      'No hay ninguna user-trades.db todavia',
      'Quantower la crea al conectar la cuenta y descargar el historial.\n' +
        'Conecta la cuenta, abre el historial de operaciones y vuelve a pasar esto.',
    );
  }
} else {
  say(WARN, `No existe ${cacheRoot}`, 'Normal si Quantower no esta instalado en esta maquina.');
}

// ------------------------------------------------------------------ contexto

section('Contexto de los indicadores');

const ctxDir = env('CONTEXT_DIR', join(qwRoot, 'journal'));

if (existsSync(ctxDir)) {
  const files = readdirSync(ctxDir).filter((f) => /^context-\d{8}\.jsonl$/.test(f));
  if (files.length > 0) {
    const total = files.reduce((a, f) => a + statSync(join(ctxDir, f)).size, 0);
    files.sort();
    say(
      OK,
      `${files.length} dias de contexto en ${ctxDir}`,
      `${mb(total)} en total · del ${files[0].slice(8, 16)} al ${files[files.length - 1].slice(8, 16)}`,
    );
  } else {
    say(
      WARN,
      `${ctxDir} existe pero esta vacio`,
      'Enciende "Guardar contexto para el diario" en j_Flujo, en el grafico con\n' +
        'el que decides las entradas. Sin esto no hay velas, ni grafico por\n' +
        'operacion, ni MAE/MFE, ni tendencia de los marcos grandes.',
    );
  }
} else {
  say(WARN, `No existe ${ctxDir}`, 'Lo crea j_Flujo la primera vez que escribe.');
}

// ---------------------------------------------------------------- indicadores

section('Indicadores');

const scripts = join(qwRoot, 'Settings', 'Scripts', 'Indicators');

for (const name of ['j_Flujo', 'KillZones', 'QuaEmas']) {
  const dll = join(scripts, name, `${name}.dll`);
  if (existsSync(dll)) {
    const age = (Date.now() - statSync(dll).mtimeMs) / 86_400_000;
    say(OK, `${name}.dll instalado`, `compilado hace ${age.toFixed(1)} dias`);
  } else {
    say(
      WARN,
      `${name}.dll no esta en Quantower`,
      `Compila el proyecto en Visual Studio: el .csproj ya deja el DLL en\n${join(scripts, name)}`,
    );
  }
}

// ---------------------------------------------------------------------- base

section('Base del diario');

const journal = resolve(env('JOURNAL_DB', join(ROOT, 'data', 'journal.db')));

if (existsSync(journal)) {
  const size = statSync(journal).size;
  const wal = `${journal}-wal`;
  const walSize = existsSync(wal) ? statSync(wal).size : 0;
  say(
    OK,
    `Base en ${journal}`,
    `${mb(size)}${walSize ? ` + ${mb(walSize)} sin consolidar (-wal)` : ''}`,
  );

  try {
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    const d = new Database(journal, { readonly: true });
    const rows = (t) => {
      try {
        return d.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n;
      } catch {
        return null;
      }
    };
    const counts = ['fills', 'operations', 'context_snapshots', 'bars', 'economic_events']
      .map((t) => `${t}: ${rows(t) ?? 'no existe'}`)
      .join('\n');
    say(OK, 'Tablas', counts);
    d.close();
  } catch {
    /* ya se informo del binario nativo mas arriba */
  }
} else {
  say(
    WARN,
    'Todavia no hay base',
    'Se crea sola en la primera ingesta. Ejecuta:  pnpm ingest',
  );
}

// ----------------------------------------------------------------- calendario

section('Calendario economico');

const calDir = env('CALENDAR_DIR', join(qwRoot, 'journal', 'calendar'));
if (existsSync(calDir)) {
  const files = readdirSync(calDir).filter((f) => /\.(ics|csv)$/i.test(f));
  if (files.length) say(OK, `${files.length} ficheros en ${calDir}`, files.join(', '));
  else say(WARN, `${calDir} esta vacio`, 'Deja ahi el calendario en .ics o .csv. Es opcional.');
} else {
  say(WARN, `No existe ${calDir}`, 'Es opcional: sin el, la pestana Noticias sale vacia.');
}

// ------------------------------------------------------------------- resumen

console.log('');
if (fails === 0 && warns === 0) {
  console.log('Todo en orden. Arranca con:  pnpm dev');
} else if (fails === 0) {
  console.log(`Sin fallos graves. ${warns} aviso(s) arriba: se puede arrancar, pero mira si te afectan.`);
} else {
  console.log(`${fails} fallo(s) que hay que arreglar antes de arrancar, y ${warns} aviso(s).`);
}

process.exitCode = fails > 0 ? 1 : 0;
