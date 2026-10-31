#!/usr/bin/env node
/**
 * Mide A QUE HORA publica resultados cada empresa, de verdad.
 *
 *   node scripts/medir-horas-resultados.mjs
 *   node scripts/medir-horas-resultados.mjs --ver     (solo enseña, no guarda)
 *
 * Por que existe. Ni Finnhub ni Alpha Vantage dan la hora: dan el dia y, como
 * mucho, "antes de abrir" o "despues del cierre". El diario se apañaba con una
 * convencion unica de las 16:30 de Nueva York para todas, y esa convencion
 * resulto ser correcta SOLO para Apple:
 *
 *   GOOGL 16:01 · MU 16:02 · MSFT 16:04 · META 16:05 · AMZN 16:13
 *   TSLA 16:13 · AMD 16:16 · NVDA 16:21 · AAPL 16:30
 *
 * Con las 16:30 para todas, la alarma de "faltan 15 minutos" sonaba a las
 * 16:15, o sea DESPUES de que cuatro de ellas hubieran publicado ya.
 *
 * De donde sale el dato. De la API publica de la SEC, gratis y sin clave. Cada
 * vez que una empresa presenta resultados manda un formulario 8-K con el item
 * 2.02 -"Results of Operations and Financial Condition"-, y EDGAR le pone un
 * `acceptanceDateTime` con el SEGUNDO exacto en que entro. Es la hora oficial
 * de publicacion, no una estimacion de nadie.
 *
 * Lo que NO es. No es una prediccion: dice a que hora publico la empresa las
 * ultimas veces, no a que hora publicara la proxima. Por eso se guarda con el
 * numero de informes y el rango, para poder ver si una empresa es puntual
 * (GOOGL, diez de diez a las 16:01) o irregular (TSLA, de 16:06 a 16:41).
 *
 * Cada cuanto. Una vez por trimestre basta: las costumbres se mueven despacio.
 *
 * Node puro, sin dependencias mas alla de la base. La SEC exige identificarse
 * en el `User-Agent` o devuelve 403; el correo sale del .env o se pasa con
 * SEC_CONTACT.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Lee el .env sin pisar lo que ya haya en el entorno. */
function env(key, fallback) {
  if (process.env[key] !== undefined) return process.env[key];
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return fallback;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1 || line.slice(0, eq).trim() !== key) continue;
    let v = line.slice(eq + 1).trim();
    if (v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return fallback;
}

const CONTACTO = env('SEC_CONTACT', 'trading-journal diario@ejemplo.com');
const CABECERAS = { 'User-Agent': CONTACTO, Accept: 'application/json' };

/** Cuantos informes entran en la mediana. Seis son ano y medio. */
const MUESTRA = 6;

/** Cuantos se traen antes de filtrar, para que queden seis de tarde. */
const MAX_FILAS = 16;

// --------------------------------------------------------------- hora de NY

/**
 * Desfase de Nueva York en ese instante. Mismas reglas que
 * `src/domain/clock.ts`: segundo domingo de marzo a primer domingo de
 * noviembre. Duplicado aqui porque este script es Node puro y no importa nada
 * del diario; si alguna vez dejan de coincidir, este es el que esta mal.
 */
function offsetNY(ms) {
  const y = new Date(ms).getUTCFullYear();
  const domingo = (mes, n) => {
    const primero = Date.UTC(y, mes - 1, 1);
    const salto = (7 - new Date(primero).getUTCDay()) % 7;
    return primero + (salto + (n - 1) * 7) * 86_400_000;
  };
  const inicio = domingo(3, 2) + 7 * 3_600_000;
  const fin = domingo(11, 1) + 6 * 3_600_000;
  return ms >= inicio && ms < fin ? -4 : -5;
}

const minutosNY = (iso) => {
  const t = Date.parse(iso);
  const d = new Date(t + offsetNY(t) * 3_600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function mediana(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// ------------------------------------------------------------------- EDGAR

async function pedir(url) {
  const res = await fetch(url, { headers: CABECERAS });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** Ticker -> CIK, del fichero oficial de la SEC. */
async function cikDe(tickers) {
  const todos = await pedir('https://www.sec.gov/files/company_tickers.json');
  const mapa = {};
  for (const k of Object.keys(todos)) {
    const e = todos[k];
    if (tickers.includes(e.ticker)) mapa[e.ticker] = String(e.cik_str).padStart(10, '0');
  }
  return mapa;
}

/**
 * Las publicaciones de resultados de una empresa.
 *
 * Solo 8-K con el item 2.02, y SOLO las de la tarde. Tesla usa ese mismo item
 * para las cifras de produccion y entregas, que las publica por la mañana
 * sobre las 09:00: mezclarlas con los resultados daba una mediana de las 16:11
 * que no describia ninguna de las dos cosas.
 */
async function publicaciones(cik) {
  const d = await pedir(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = d.filings.recent;
  const filas = [];

  for (let i = 0; i < r.form.length && filas.length < MAX_FILAS; i += 1) {
    if (r.form[i] !== '8-K') continue;
    if (!(r.items[i] ?? '').includes('2.02')) continue;
    filas.push({ dia: r.filingDate[i], min: minutosNY(r.acceptanceDateTime[i]) });
  }

  return { nombre: d.name, tarde: filas.filter((f) => f.min >= 720), manana: filas.filter((f) => f.min < 720) };
}

// -------------------------------------------------------------------- main

const TICKERS = (env('MARKET_TICKERS', 'AAPL,AMD,AMZN,GOOG,GOOGL,META,MSFT,MU,NVDA,TSLA') || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const soloVer = process.argv.includes('--ver');

console.log(`Midiendo ${TICKERS.length} empresas contra EDGAR.`);
console.log(`User-Agent: ${CONTACTO}`);
console.log('(la SEC exige identificarse; cambialo con SEC_CONTACT en el .env)\n');

let cik;
try {
  cik = await cikDe(TICKERS);
} catch (e) {
  console.error(`No se pudo leer la lista de CIK: ${e.message}`);
  console.error('Si es un 403, el User-Agent no identifica a nadie. Pon SEC_CONTACT en el .env.');
  process.exit(1);
}

const medidas = {};
const avisos = [];

for (const tk of TICKERS) {
  if (!cik[tk]) { avisos.push(`${tk}: no esta en el listado de la SEC`); continue; }

  try {
    const { nombre, tarde, manana } = await publicaciones(cik[tk]);
    const ultimos = tarde.slice(0, MUESTRA).map((f) => f.min);

    if (ultimos.length === 0) {
      avisos.push(`${tk}: sin 8-K de resultados por la tarde`);
      continue;
    }

    const med = mediana(ultimos);
    medidas[tk] = {
      hhmm: hhmm(med),
      n: ultimos.length,
      rango: `${hhmm(Math.min(...ultimos))}-${hhmm(Math.max(...ultimos))}`,
    };

    const disperso = Math.max(...ultimos) - Math.min(...ultimos) >= 15;
    console.log(
      `  ${tk.padEnd(6)} ${medidas[tk].hhmm} NY   ${String(ultimos.length).padStart(2)} informes   ` +
        `rango ${medidas[tk].rango}${disperso ? '   ← irregular' : ''}`,
    );
    if (manana.length > 0) {
      console.log(`         ${manana.length} publicaciones de MAÑANA descartadas (${nombre} usa el 2.02 para otra cosa)`);
    }
  } catch (e) {
    avisos.push(`${tk}: ${e.message}`);
  }

  // La SEC pide no pasar de diez peticiones por segundo. Vamos muy por debajo.
  await new Promise((r) => setTimeout(r, 150));
}

for (const a of avisos) console.log(`  AVISO  ${a}`);

if (soloVer) {
  console.log('\n--ver: no se ha guardado nada.');
  process.exit(0);
}

try {
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const ruta = resolve(env('JOURNAL_DB', join(ROOT, 'data', 'journal.db')));
  const d = new Database(ruta);
  d.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run('earnings_hours', JSON.stringify(medidas));
  d.close();
  console.log(`\nGuardado en ${ruta} (meta.earnings_hours). Manda sobre la tabla del codigo.`);
  console.log('Reinicia el diario para que lo coja.');
} catch (e) {
  console.error(`\nNo se pudo guardar: ${e.message}`);
  console.log('Las cifras de arriba siguen valiendo; se pueden pegar a mano en HORA_MEDIDA.');
  process.exitCode = 1;
}
