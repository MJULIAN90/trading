/**
 * SONDA: que devuelve Yahoo Finance, y en que se diferencia de lo que ya
 * tienes guardado.
 *
 *   node scripts/sonda-yahoo.mjs
 *
 * No instala nada y no toca la base: solo pide y compara. Existe porque la
 * pregunta "¿Yahoo es mas exacto?" no se contesta opinando, y porque desde mi
 * contenedor no puedo llamar a Yahoo (el DNS esta filtrado). Esto lo corres tu
 * y decidimos con lo que salga.
 *
 * Se usa `fetch` contra el endpoint publico de graficos (v8/finance/chart) a
 * proposito, sin librerias: asi puedes correrlo HOY sin anadir una dependencia
 * al proyecto. La libreria `yahoo-finance2` solo entra si esto sale bien.
 *
 * El v8 se elige sobre el v7 de cotizaciones porque el v7 pide cookie y
 * "crumb" desde 2023 y se rompe cada pocos meses; el v8 todavia no.
 */
import Database from 'better-sqlite3';
import { existsSync, writeFileSync } from 'node:fs';

/**
 * Todo lo que se imprime se guarda tambien en un fichero.
 *
 * El log de Quantower pasa de los 500 MB y no cabe por el puente; esta salida
 * es pequena pero obligaba a copiarla y pegarla a mano, que es friccion
 * suficiente para que una medicion no se haga nunca. Ahora queda en disco y
 * Claude la lee directa.
 */
const lineas = [];
const di = (txt = '') => {
  lineas.push(String(txt));
  console.log(txt);
};

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

/**
 * Lo que de verdad se quiere comprobar, y por que cada uno.
 *
 * `compara` es el simbolo con el que el diario guarda hoy ese mismo dato: si
 * esta, la sonda enfrenta las dos cifras. Vacio = no hay con que comparar.
 */
const PRUEBAS = [
  // EL CASO FUERTE. Hoy el barril sale de Alpha Vantage (una vez al dia) y el
  // movimiento de los ETF USO/BNO, que son un PROXY, no el crudo.
  { sym: 'CL=F', que: 'WTI, futuro real', compara: 'WTI' },
  { sym: 'BZ=F', que: 'Brent, futuro real', compara: 'BRENT' },
  { sym: 'USO', que: 'el ETF que usas ahora de proxy', compara: 'USO' },
  { sym: 'BNO', que: 'el otro ETF proxy', compara: 'BNO' },

  // Bonos: hoy series diarias de Alpha, las que fabricaron 21 cierres falsos.
  { sym: '^FVX', que: 'bono 5 anos', compara: 'US5Y' },
  { sym: '^TNX', que: 'bono 10 anos', compara: 'US10Y' },
  { sym: '^TYX', que: 'bono 30 anos', compara: 'US30Y' },

  // Las diez del Nasdaq: hoy Finnhub.
  { sym: 'AAPL', que: 'accion', compara: 'AAPL' },
  { sym: 'MSFT', que: 'accion', compara: 'MSFT' },
  { sym: 'NVDA', que: 'accion', compara: 'NVDA' },

  // Lo que hoy NO tienes y seria nuevo.
  { sym: 'NQ=F', que: 'futuro Nasdaq (lo que operas)', compara: '' },
  { sym: '^IXIC', que: 'indice Nasdaq Composite', compara: '' },
  { sym: 'DX-Y.NYB', que: 'indice del dolar', compara: '' },
  { sym: 'GC=F', que: 'oro', compara: '' },
  { sym: '^VIX', que: 'volatilidad', compara: '' },
];

async function pedir(sym) {
  const url = `${BASE}${encodeURIComponent(sym)}?interval=1d&range=5d`;
  const t0 = Date.now();

  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
  });

  const ms = Date.now() - t0;
  if (!res.ok) return { sym, error: `HTTP ${res.status}`, ms };

  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r) return { sym, error: j?.chart?.error?.description ?? 'sin resultado', ms };

  const m = r.meta ?? {};
  const cierres = (r.indicators?.quote?.[0]?.close ?? []).filter((x) => x !== null);

  return {
    sym,
    ms,
    precio: m.regularMarketPrice ?? null,
    previo: m.chartPreviousClose ?? m.previousClose ?? null,
    moneda: m.currency ?? '',
    mercado: m.fullExchangeName ?? m.exchangeName ?? '',
    // La hora del dato es lo que decide si "mas exacto" significa algo: un
    // numero bueno de hace nueve horas es peor que uno regular de hace cinco
    // minutos.
    sello: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    dias: cierres.length,
    ultimos: cierres.slice(-3),
  };
}

// --- lo que ya hay guardado, para poder enfrentarlo -------------------------
function loQueTengo() {
  const ruta = process.env.JOURNAL_DB ?? './data/journal.db';
  if (!existsSync(ruta)) return null;

  try {
    const d = new Database(ruta, { readonly: true });
    const filas = d
      .prepare('SELECT symbol, price, prev_close, quote_ts FROM global_quotes')
      .all();
    d.close();
    return new Map(filas.map((f) => [f.symbol, f]));
  } catch (err) {
    console.log(`  (no se pudo leer la base: ${err.message})`);
    return null;
  }
}

const mio = loQueTengo();
di(`base del diario: ${mio ? `${mio.size} simbolos guardados` : 'no encontrada, solo se pedira a Yahoo'}\n`);

di('SIMBOLO     PRECIO YAHOO   EL TUYO     DIFERENCIA  EDAD DEL DATO   ms   QUE ES');
di('-'.repeat(118));

let ok = 0;
let fallos = 0;

for (const p of PRUEBAS) {
  let r;
  try {
    r = await pedir(p.sym);
  } catch (err) {
    r = { sym: p.sym, error: err.message };
  }

  if (r.error) {
    fallos++;
    di(`${p.sym.padEnd(11)} ERROR: ${r.error}`);
    continue;
  }

  ok++;

  const guardado = p.compara && mio ? mio.get(p.compara) : null;
  const suyo = guardado?.price ?? null;

  const dif =
    suyo !== null && r.precio !== null && suyo !== 0
      ? `${(((r.precio - suyo) / Math.abs(suyo)) * 100).toFixed(2)}%`
      : '—';

  const edad = r.sello
    ? `${Math.round((Date.now() - Date.parse(r.sello)) / 60000)} min`
    : '—';

  di(
    p.sym.padEnd(11) +
      String(r.precio ?? '—').padStart(13) +
      String(suyo ?? '—').padStart(11) +
      dif.padStart(14) +
      edad.padStart(14) +
      String(r.ms).padStart(6) +
      '   ' +
      p.que,
  );

  // Cortesia con un servicio que no cobra ni pide clave: no se le disparan
  // quince peticiones en el mismo segundo.
  await new Promise((s) => setTimeout(s, 250));
}

di('-'.repeat(118));
di(`${ok} responden, ${fallos} fallan.`);
di(`
COMO SE LEE ESTO

  "EL TUYO" es lo que hay ahora mismo en global_quotes. Si la diferencia pasa
  del 1 % en una accion, una de las dos fuentes esta equivocada o una de las
  dos va con retraso: miralo con la EDAD al lado antes de culpar a nadie.

  Para CL=F y BZ=F la comparacion NO es de exactitud: tu guardas USO y BNO,
  que son ETF. Son instrumentos distintos y tienen que dar numeros distintos.
  Lo que hay que mirar ahi es si Yahoo trae el barril de verdad y con que
  frescura, porque eso es lo que hoy no tienes.

  Si algo falla con HTTP 429, es limite de peticiones: espera y repite. Si
  falla con 401 o 404 en TODOS, el endpoint cambio y hablamos.
`);

// --- el fichero, para que Claude lo lea sin que copies nada ----------------
{
  const salida = new URL('sonda-yahoo.txt', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  try {
    writeFileSync(salida, `${new Date().toISOString()}\n\n${lineas.join('\n')}\n`, 'utf8');
    console.log(`\nGuardado en:\n  ${salida}`);
    console.log('  Dile a Claude "ya corri la sonda" y el lo lee.');
  } catch (err) {
    console.log(`\n(no se pudo escribir el fichero: ${err.message})`);
    console.log('  Copia la tabla de arriba y pegasela a Claude.');
  }
}
