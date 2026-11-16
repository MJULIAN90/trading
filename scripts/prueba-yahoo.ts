/**
 * Comprobacion de la segunda fuente.
 *
 *   npx tsx scripts/prueba-yahoo.ts
 *
 * SIN RED. El `fetch` se sustituye por uno falso que devuelve exactamente la
 * forma que devuelve Yahoo, incluidas las maneras en que falla. Una prueba que
 * sale a internet mide la conexion, no el codigo: falla en un avion, falla si
 * Yahoo tiene un mal dia, y cuando falla nadie sabe de quien es la culpa.
 *
 * Lo que de verdad se comprueba aqui:
 *
 *   - que un simbolo que falla NO se lleva por delante a los otros catorce
 *   - que un precio nulo no se escribe encima de un dato bueno de hace un rato
 *   - que las dos fuentes se ENFRENTAN y no se mezclan
 *   - que un par proxy (ETF contra futuro) NO se cuenta como discrepancia
 *
 * Escribe en una base temporal, nunca en la tuya.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.JOURNAL_DB = join(mkdtempSync(join(tmpdir(), 'tj-yf-')), 'prueba.db');
process.env.YAHOO_SIMBOLOS = [
  'CL=F|WTI futuro|WTI|1|materia',
  'USO|ETF del crudo|USO|0|materia',
  '^TNX|bono 10|US10Y|0|bono',
  'NQ=F|futuro Nasdaq||0|indice',
  'ROTO|el que falla|AAPL|0|accion',
].join(',');

// Pesos de mentira para la prueba, con su fecha, para que la seccion 9 pueda
// comprobar que el peso llega hasta la fila y que la fecha viaja con el.
process.env.QQQ_WEIGHTS = 'ROTO:4.2';
process.env.QQQ_WEIGHTS_FECHA = 'marzo de 2027';

const { db } = await import('../src/db/index.js');
const { traerYahoo, pedirUna } = await import('../src/ingest/yahoo.js');
const { vistaYahoo } = await import('../src/domain/yahoo.js');

function check(nombre: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${nombre}${extra ? ' · ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

const AHORA = Math.floor(Date.now() / 1000);

/** La forma EXACTA que devuelve el endpoint v8 de graficos de Yahoo. */
function respuesta(precio: number | null, previo: number, sello = AHORA) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      chart: {
        result: [
          {
            meta: {
              regularMarketPrice: precio,
              chartPreviousClose: previo,
              currency: 'USD',
              fullExchangeName: 'NYMEX',
              regularMarketTime: sello,
            },
          },
        ],
      },
    }),
  };
}

const original = globalThis.fetch;
let peticiones: string[] = [];

function fingir(mapa: Record<string, unknown>) {
  peticiones = [];
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url);
    const sym = decodeURIComponent(u.split('/chart/')[1]?.split('?')[0] ?? '');
    peticiones.push(sym);
    const r = mapa[sym];
    if (r === undefined) return { ok: false, status: 404, json: async () => ({}) } as never;
    if (r instanceof Error) throw r;
    return r as never;
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// 1. Leer una respuesta normal
// ---------------------------------------------------------------------------
{
  fingir({ 'CL=F': respuesta(58.42, 57.9) });
  const r = await pedirUna('CL=F');

  check('lee el precio', r.price === 58.42, String(r.price));
  check('y el cierre anterior', r.prevClose === 57.9, String(r.prevClose));
  check('la moneda y el mercado', r.currency === 'USD' && r.exchange === 'NYMEX');
  check('no hay error', r.error === null);
  check(
    'el sello pasa de segundos a milisegundos',
    r.quoteTs === AHORA * 1000,
    `${r.quoteTs} vs ${AHORA * 1000}`,
  );
}

// ---------------------------------------------------------------------------
// 2. Las tres formas de fallar, ninguna lanza
// ---------------------------------------------------------------------------
{
  fingir({});
  const r = await pedirUna('LOQUESEA');
  check('un 404 devuelve error, no lanza', r.error === 'HTTP 404', r.error ?? '');

  fingir({ X: new Error('se cayo la red') });
  const r2 = await pedirUna('X');
  check('una red caida devuelve error, no lanza', r2.error === 'se cayo la red', r2.error ?? '');

  fingir({
    Y: { ok: true, status: 200, json: async () => ({ chart: { error: { description: 'No data found' } } }) },
  });
  const r3 = await pedirUna('Y');
  check('un simbolo que no existe lo dice', r3.error === 'No data found', r3.error ?? '');
}

// ---------------------------------------------------------------------------
// 3. Un simbolo roto no se lleva a los demas
// ---------------------------------------------------------------------------
{
  fingir({
    'CL=F': respuesta(58.42, 57.9),
    USO: respuesta(71.3, 70.8),
    '^TNX': respuesta(4.12, 4.2),
    'NQ=F': respuesta(25010, 24900),
    // ROTO no esta en el mapa: devuelve 404.
  });

  const parte = await traerYahoo();

  check('se piden los cinco', parte.pedidos === 5, String(parte.pedidos));
  check('se guardan los cuatro buenos', parte.guardados === 4, String(parte.guardados));
  check('y el malo se reporta aparte', parte.fallos.length === 1 && parte.fallos[0]?.symbol === 'ROTO');
  check('el fallo no impidio pedir los siguientes', peticiones.length === 5, peticiones.join(', '));
}

// ---------------------------------------------------------------------------
// 4. Un precio nulo NO pisa un dato bueno
// ---------------------------------------------------------------------------
// Escribir un hueco encima de una cotizacion de hace diez minutos es perder
// informacion a cambio de nada.
{
  const antes = db().prepare("SELECT price FROM yahoo_quotes WHERE symbol = 'CL=F'").get() as { price: number };

  fingir({ 'CL=F': respuesta(null, 57.9), USO: respuesta(71.3, 70.8), '^TNX': respuesta(4.12, 4.2), 'NQ=F': respuesta(25010, 24900) });
  await traerYahoo();

  const despues = db().prepare("SELECT price FROM yahoo_quotes WHERE symbol = 'CL=F'").get() as { price: number };
  check('un precio nulo no borra el anterior', despues.price === antes.price, `${antes.price} -> ${despues.price}`);
}

// ---------------------------------------------------------------------------
// 5. LAS DOS FUENTES SE ENFRENTAN, NO SE MEZCLAN
// ---------------------------------------------------------------------------
{
  const d = db();

  // Lo que el diario ya tenia, de Finnhub y de Alpha.
  d.prepare(
    `INSERT INTO global_quotes (symbol, label, kind, price, change_pct, ts, prev_close, quote_ts)
     VALUES ('USO',   'USO',   'etf',  71.1, 0.4, ?, 70.8, ?),
            ('US10Y', 'US10Y', 'bono',  4.35, 3.6, ?,  4.2, ?),
            ('WTI',   'WTI',   'crudo', 57.0, 0.9, ?, 56.5, ?)
     ON CONFLICT (symbol) DO UPDATE SET price = excluded.price, prev_close = excluded.prev_close, quote_ts = excluded.quote_ts`,
  ).run(
    Date.now(), Date.now() - 6 * 60_000,
    Date.now(), Date.now() - 9 * 3600_000,
    Date.now(), Date.now() - 9 * 3600_000,
  );

  const v = vistaYahoo();
  const por = (s: string) => v.filas.find((f) => f.symbol === s);

  check('la vista trae las cinco filas', v.filas.length === 5, String(v.filas.length));

  // Yahoo NO escribe en global_quotes. Nunca.
  const g = d.prepare("SELECT price FROM global_quotes WHERE symbol = 'USO'").get() as { price: number };
  check('yahoo no toca global_quotes', g.price === 71.1, String(g.price));

  const uso = por('USO');
  check('USO enfrenta las dos', uso?.yahoo?.price === 71.3 && uso?.propio?.price === 71.1);
  check('  con su diferencia en %', uso?.difPct === 0.28, String(uso?.difPct));

  const tnx = por('^TNX');
  check('el bono tambien', tnx?.yahoo?.price === 4.12 && tnx?.propio?.price === 4.35);
  check('  y la diferencia sale negativa', (tnx?.difPct ?? 0) < 0, String(tnx?.difPct));

  // LA EDAD, que es lo que suele decidir.
  check('la edad de lo propio se calcula', (tnx?.propio?.edadMin ?? 0) >= 539, `${tnx?.propio?.edadMin} min`);
  check('  y la de Yahoo es de ahora', (tnx?.yahoo?.edadMin ?? 99) <= 1, `${tnx?.yahoo?.edadMin} min`);

  // EL PAR PROXY: un ETF y un futuro NO son comparables.
  const wti = por('CL=F');
  check('CL=F esta marcado como proxy', wti?.proxy === true);
  check('  y su diferencia se deja en null a proposito', wti?.difPct === null, String(wti?.difPct));
  check('  aunque los dos precios esten ahi', wti?.yahoo?.price !== null && wti?.propio?.price === 57.0);

  // Lo que no tiene con que compararse.
  const nq = por('NQ=F');
  check('un simbolo nuevo no tiene lado propio', nq?.propio === null);
  check('  pero si tiene precio', nq?.yahoo?.price === 25010, String(nq?.yahoo?.price));

  // El que fallo: sin lado Yahoo, pero la fila sigue estando.
  const roto = por('ROTO');
  check('el simbolo que fallo sale sin datos, no desaparece', roto !== undefined && roto.yahoo === null);

  check('cuenta las que discrepan mas de un 1%', v.discrepan === 1, `${v.discrepan} (el bono, 5,3%)`);
}

// ---------------------------------------------------------------------------
// 6. El cambio del dia
// ---------------------------------------------------------------------------
{
  const v = vistaYahoo();
  const uso = v.filas.find((f) => f.symbol === 'USO');
  // 71,3 contra 70,8 son +0,71 %.
  check('calcula el % del dia desde el cierre anterior', uso?.yahoo?.cambioPct === 0.71, String(uso?.yahoo?.cambioPct));
}

// ---------------------------------------------------------------------------
// 7. Los grupos, que es como se separa la tabla en pantalla
// ---------------------------------------------------------------------------
{
  const v = vistaYahoo();
  const grupo = (s: string) => v.filas.find((f) => f.symbol === s)?.grupo;

  check('el crudo va a materias primas', grupo('CL=F') === 'materia', String(grupo('CL=F')));
  check('el bono a bonos', grupo('^TNX') === 'bono', String(grupo('^TNX')));
  check('el futuro del Nasdaq a indices', grupo('NQ=F') === 'indice', String(grupo('NQ=F')));
  check('y la accion a acciones', grupo('ROTO') === 'accion', String(grupo('ROTO')));

  // Un grupo que no existe cae en 'indice' en vez de dejar la fila sin sitio:
  // una fila sin grupo no se pintaria en ninguna tabla y desapareceria.
  const antes = process.env.YAHOO_SIMBOLOS;
  process.env.YAHOO_SIMBOLOS = 'XX|prueba||0|inventado';
  const { YAHOO_SIMBOLOS: recargado } = await import('../src/config.js?grupos=1');
  check(
    'un grupo invalido cae en indices, no deja la fila sin sitio',
    (recargado as Array<{ grupo: string }>)[0]?.grupo === 'indice',
    String((recargado as Array<{ grupo: string }>)[0]?.grupo),
  );
  process.env.YAHOO_SIMBOLOS = antes;
}

// ---------------------------------------------------------------------------
// 8. Las acciones salen de MARKET_TICKERS, no de una segunda lista a mano
// ---------------------------------------------------------------------------
// Esto es lo que impide que las dos pantallas se separen. Si alguien vuelve a
// escribir las acciones a mano aqui, esta seccion se cae.
{
  const antes = process.env.YAHOO_SIMBOLOS;
  delete process.env.YAHOO_SIMBOLOS;
  process.env.MARKET_TICKERS = 'NVDA,AAPL,TSLA,ZZZZ';

  const cfg = (await import('../src/config.js?acciones=1')) as {
    YAHOO_SIMBOLOS: Array<{ symbol: string; que: string; compara: string; grupo: string }>;
    MARKET_TICKERS: string[];
  };

  const acciones = cfg.YAHOO_SIMBOLOS.filter((s) => s.grupo === 'accion');

  check(
    'hay una accion por cada MARKET_TICKER',
    acciones.length === cfg.MARKET_TICKERS.length,
    `${acciones.length} vs ${cfg.MARKET_TICKERS.length}`,
  );
  check(
    'y son exactamente esas, en el mismo orden',
    acciones.map((a) => a.symbol).join(',') === cfg.MARKET_TICKERS.join(','),
    acciones.map((a) => a.symbol).join(','),
  );
  check(
    'cada una se compara consigo misma: asi la guarda el diario',
    acciones.every((a) => a.compara === a.symbol),
  );
  check(
    'usa el nombre que ya tiene el diario',
    acciones.find((a) => a.symbol === 'NVDA')?.que === 'NVIDIA',
    acciones.find((a) => a.symbol === 'NVDA')?.que,
  );
  // Un ticker sin nombre en el mapa sale con su ticker, no en blanco: una fila
  // sin texto debajo del simbolo parece un fallo de carga.
  check(
    'un ticker sin nombre cae en su propio ticker, no en blanco',
    acciones.find((a) => a.symbol === 'ZZZZ')?.que === 'ZZZZ',
    acciones.find((a) => a.symbol === 'ZZZZ')?.que,
  );
  // Y lo demas sigue estando: anadir acciones no se lleva por delante el crudo.
  check(
    'el crudo y los bonos siguen ahi',
    cfg.YAHOO_SIMBOLOS.some((s) => s.symbol === 'CL=F') && cfg.YAHOO_SIMBOLOS.some((s) => s.symbol === '^TNX'),
  );

  delete process.env.MARKET_TICKERS;
  if (antes !== undefined) process.env.YAHOO_SIMBOLOS = antes;
}

// ---------------------------------------------------------------------------
// 9. El peso en el QQQ, y su fecha
// ---------------------------------------------------------------------------
// El peso se ensena al lado de precios con sello horario, pero NO es un dato
// medido: es una cifra copiada a mano. Lo que se comprueba aqui es que nunca
// viaja sin decir de cuando es.
{
  const v = vistaYahoo();
  const por = (s: string) => v.filas.find((f) => f.symbol === s);

  check('el peso llega hasta la fila', por('ROTO')?.peso === 4.2, String(por('ROTO')?.peso));
  check('el bono no tiene peso en el QQQ', por('^TNX')?.peso === null, String(por('^TNX')?.peso));
  check('y la vista dice de cuando es la foto', v.pesosFecha === 'marzo de 2027', String(v.pesosFecha));
  // Que falle la peticion no borra el peso: son cosas distintas y la columna
  // tiene que seguir ordenando aunque no haya precio.
  check('una fila sin precio conserva su peso', por('ROTO')?.yahoo === null && por('ROTO')?.peso === 4.2);

  // Un peso de 0 es un peso APUNTADO, no la ausencia de uno. Con `||` en vez de
  // `??` se convertiria en null y la pantalla diria "no se sabe" de algo que si
  // se sabe.
  const antesP = process.env.QQQ_WEIGHTS;
  const antesF = process.env.QQQ_WEIGHTS_FECHA;
  const antesS = process.env.YAHOO_SIMBOLOS;
  process.env.QQQ_WEIGHTS = 'CERO:0';
  delete process.env.QQQ_WEIGHTS_FECHA;
  process.env.YAHOO_SIMBOLOS = 'CERO|la que no pesa||0|accion';
  const c1 = (await import('../src/config.js?peso=1')) as {
    QQQ_WEIGHTS: Record<string, number>;
    QQQ_WEIGHTS_FECHA: string | null;
  };
  check('un peso de 0 se guarda como 0, no se pierde', c1.QQQ_WEIGHTS.CERO === 0, String(c1.QQQ_WEIGHTS.CERO));

  // Pesos puestos a mano SIN fecha: la fecha de fabrica no se hereda.
  check(
    'pesos del .env sin fecha dejan la fecha en null, no firman octubre',
    c1.QQQ_WEIGHTS_FECHA === null,
    String(c1.QQQ_WEIGHTS_FECHA),
  );

  // Con fecha puesta, se respeta.
  process.env.QQQ_WEIGHTS_FECHA = 'enero de 2027';
  const c2 = (await import('../src/config.js?peso=2')) as { QQQ_WEIGHTS_FECHA: string | null };
  check('y si se dice de cuando son, se dice', c2.QQQ_WEIGHTS_FECHA === 'enero de 2027', String(c2.QQQ_WEIGHTS_FECHA));

  // Un .env con pesos ilegibles NO deja el diario sin pesos: se siguen usando
  // los de fabrica, y entonces la fecha tiene que volver a ser la de fabrica.
  delete process.env.QQQ_WEIGHTS_FECHA;
  process.env.QQQ_WEIGHTS = 'esto no es un peso';
  const c3 = (await import('../src/config.js?peso=3')) as {
    QQQ_WEIGHTS: Record<string, number>;
    QQQ_WEIGHTS_FECHA: string | null;
  };
  check('unos pesos ilegibles caen en los de fabrica', c3.QQQ_WEIGHTS.NVDA === 8.3, String(c3.QQQ_WEIGHTS.NVDA));
  check(
    '  y con ellos vuelve su fecha, no un null heredado',
    c3.QQQ_WEIGHTS_FECHA === 'octubre de 2026',
    String(c3.QQQ_WEIGHTS_FECHA),
  );

  if (antesP === undefined) delete process.env.QQQ_WEIGHTS; else process.env.QQQ_WEIGHTS = antesP;
  if (antesF === undefined) delete process.env.QQQ_WEIGHTS_FECHA; else process.env.QQQ_WEIGHTS_FECHA = antesF;
  if (antesS === undefined) delete process.env.YAHOO_SIMBOLOS; else process.env.YAHOO_SIMBOLOS = antesS;
}

globalThis.fetch = original;
console.log('\nbase temporal:', process.env.JOURNAL_DB);
