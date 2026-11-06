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
    // Si la ruta lleva un espacio, se dice PRIMERO: en Windows es la causa
    // mas habitual y la menos evidente, porque el error de "bindings" no
    // menciona ni la ruta ni el compilador.
    const conEspacio = ROOT.includes(' ');

    const arreglo = [
      'Arreglo:  pnpm rebuild better-sqlite3   (o  npm rebuild better-sqlite3)',
      '',
      'Si eso tambien falla, son una de estas dos:',
      conEspacio
        ? `  1. LA RUTA TIENE UN ESPACIO, y suele ser esto:\n     ${ROOT}\n` +
          '     El compilador nativo de Windows se atraganta con los espacios.\n' +
          '     Mueve el proyecto a algo como C:\\trading-journal.'
        : '  1. La ruta no tiene espacios, asi que no es eso.',
      `  2. Falta el compilador de C++ de Windows. Node ${process.version} puede no\n` +
        '     traer binario precompilado y entonces hay que compilarlo aqui.\n' +
        "     Instala 'Herramientas de compilacion de Visual Studio' con la\n" +
        "     carga 'Desarrollo para el escritorio con C++'.",
    ].join('\n');

    say(FAIL, 'better-sqlite3 no puede cargar su binario nativo', `${String(e).split('\n')[0]}\n${arreglo}`);
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
  const rutas = explicitDb.split(';').map((p) => p.trim()).filter(Boolean);
  const validas = rutas.filter((p) => existsSync(p));
  if (validas.length === rutas.length && validas.length > 0) {
    say(OK, `user-trades.db fijado a mano (${validas.length})`, validas.join('\n'));
  } else {
    say(FAIL, 'QUANTOWER_TRADES_DB apunta a algo que no existe', rutas.join('\n'));
  }
} else if (existsSync(cacheRoot)) {
  for (const d of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const c = join(cacheRoot, d.name, 'user-trades.db');
    if (existsSync(c)) found.push(c);
  }

  if (found.length === 1) {
    say(OK, 'Una cuenta encontrada', `${found[0]}  (${mb(statSync(found[0]).size)})`);
  } else if (found.length > 1) {
    // Desde la ingesta multi-cuenta se leen TODAS, no la primera. El aviso
    // antiguo decia lo contrario y hacia pensar que faltaba configurar algo.
    say(
      OK,
      `Hay ${found.length} cuentas y el diario las ingiere todas`,
      found.map((f) => `  ${f}`).join('\n') +
        '\nPara limitar la ingesta, en .env:  QUANTOWER_TRADES_DB=<ruta1>;<ruta2>',
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

for (const name of ['j_Flujo', 'KillZones', 'QuaEmas', 'j_Guardia']) {
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
    const counts = [
      'fills', 'operations', 'context_snapshots', 'bars', 'economic_events',
      'global_quotes', 'global_news', 'global_earnings',
    ]
      .map((t) => `${t}: ${rows(t) ?? 'no existe'}`)
      .join('\n');
    say(OK, 'Tablas', counts);

    // NUESTRO PNL CONTRA EL DEL BROKER.
    //
    // `gross_pnl` lo calculamos desde los precios de los fills; `broker_pnl` es
    // lo que suma Quantower. Deberian coincidir, y cuando no coinciden el que
    // falla es el broker: el 28 oct 2026 dejo cuatro ejecuciones de cierre con
    // el PnL a NULL y se perdieron 622,50 $ que la cuenta si cobraba.
    //
    // Por eso esto es un AVISO y no un FALLO: no hay nada que arreglar en la
    // instalacion. Es el numero que explica por que el saldo del broker y el
    // total del diario pueden no cuadrar, y conviene tenerlo a mano.
    try {
      const t = d
        .prepare(
          `SELECT COUNT(*) n,
                  SUM(gross_pnl) nuestro,
                  SUM(COALESCE(broker_pnl, gross_pnl)) broker,
                  SUM(CASE WHEN broker_pnl IS NOT NULL
                            AND ABS(gross_pnl - broker_pnl) > 0.005 THEN 1 ELSE 0 END) discrepan
             FROM operations`,
        )
        .get();

      if (t.n > 0) {
        const dif = (t.nuestro ?? 0) - (t.broker ?? 0);
        const linea =
          `nuestro (desde los precios): ${(t.nuestro ?? 0).toFixed(2)} USD\n` +
          `Quantower (gross_pnl):       ${(t.broker ?? 0).toFixed(2)} USD\n` +
          `diferencia:                  ${dif.toFixed(2)} USD en ${t.discrepan} operacion(es)`;
        if (t.discrepan > 0) {
          say(WARN, 'El PnL del broker no cuadra con el calculado', linea);
        } else {
          say(OK, 'PnL calculado y PnL del broker coinciden', linea);
        }
      }
    } catch {
      say(WARN, 'Sin columna broker_pnl todavia', 'Se anade sola en la proxima ingesta.');
    }

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
  say(WARN, `No existe ${calDir}`, 'Es opcional: sin el, la pestana Calendario sale vacia.');
}

// --------------------------------------------------- contexto de mercado (News)

section('Pestana News (contexto de mercado)');

const finnhub = env('FINNHUB_API_KEY', '');
const alpha = env('ALPHA_API_KEY', '');

// Se dice si la clave ESTA, nunca cual es: este informe se pega en chats y en
// incidencias, y una clave filtrada ahi no se puede recoger.
if (!finnhub && !alpha) {
  say(
    WARN,
    'Sin claves: la pestana News no pide nada',
    'Es opcional y el resto funciona igual. Si la quieres, saca dos claves\n' +
      'gratuitas (sin tarjeta) y ponlas en el .env:\n' +
      '  FINNHUB_API_KEY=   https://finnhub.io/register\n' +
      '  ALPHA_API_KEY=     https://www.alphavantage.co/support/#api-key',
  );
} else {
  if (finnhub) say(OK, 'FINNHUB_API_KEY configurada', 'cotizaciones, titulares y resultados');
  else say(WARN, 'Falta FINNHUB_API_KEY', 'Sin ella no hay cotizaciones, ni titulares, ni resultados.');

  if (alpha) say(OK, 'ALPHA_API_KEY configurada', 'petroleo (WTI y Brent) y bonos a 10 y 30 anios');
  else say(WARN, 'Falta ALPHA_API_KEY', 'Sin ella no hay petroleo ni tipos del Tesoro.');
}

// Esta variable no falta: SOBRA. Puesta, anula la cadencia que se adapta al
// reloj de Nueva York, y el sintoma es que la pantalla va lenta en la apertura
// sin que nada parezca roto.
if (env('MARKET_REFRESH_MIN', '')) {
  say(
    WARN,
    'MARKET_REFRESH_MIN esta puesta en el .env',
    'Fija un intervalo constante y anula la cadencia por horario\n' +
      '(5 min con el mercado abierto, 15 fuera de horas, 60 de noche).\n' +
      'Comentala salvo que quieras ritmo fijo a proposito.',
  );
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
