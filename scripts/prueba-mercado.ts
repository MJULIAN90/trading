/**
 * Comprobacion del bloque de mercado SIN salir a internet.
 *
 *   npx tsx scripts/prueba-mercado.ts
 *
 * Sustituye `fetch` por uno falso que imita lo que de verdad contesta cada
 * proveedor, incluido el aviso de Alpha Vantage que tumbo el refresco del 25
 * de octubre. Sirve para tocar la cadencia, el presupuesto o el parseo sin
 * gastar una sola peticion de la cuota, y para no volver a descubrir en
 * produccion que un 200 traia un error dentro.
 *
 * Escribe en una base temporal, nunca en la tuya.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Ayer a las 14:30 de mercado, en el formato de Alpha Vantage. */
function ayerAlpha(): string {
  const d = new Date(Date.now() - 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T143000`;
}

/** El instante que deberia salir de `ayerAlpha()` una vez pasado a UTC. */
function esperadoAyer(): number {
  const s = ayerAlpha();
  const utc = Date.UTC(
    Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)), 14, 30, 0,
  );
  // Mismo ajuste que hace `fechaAlpha`: viene en hora de mercado.
  const nov = new Date(utc).getUTCMonth();
  const desfase = nov >= 10 || nov < 2 ? -5 : -4;
  return utc - desfase * 3_600_000;
}

// Antes de importar nada del diario: `config.ts` lee el entorno al cargarse.
process.env.JOURNAL_DB = join(mkdtempSync(join(tmpdir(), 'tj-prueba-')), 'prueba.db');
process.env.FINNHUB_API_KEY ??= 'prueba';
process.env.ALPHA_API_KEY ??= 'prueba';

const llamadas: Array<{ url: string; t: number }> = [];
let fallaBrent = true;
let sentimientoPremium = false;

globalThis.fetch = (async (url: string) => {
  const u = String(url);
  llamadas.push({ url: u, t: Date.now() });

  const ok = (data: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => data });

  // El aviso real de Alpha Vantage: 200 con texto dentro, no un error HTTP.
  if (u.includes('BRENT') && fallaBrent)
    return ok({ Information: 'Thank you for using Alpha Vantage! Please consider spreading out your free API requests more sparingly (1 request per second). You may subscribe to any of the premium plans at https://www.alphavantage.co/premium/ to instantly remove all daily rate limits.' });

  if (u.includes('function=WTI')) return ok({ data: [{ date: '2026-10-24', value: '71.43' }] });
  if (u.includes('function=BRENT')) return ok({ data: [{ date: '2026-10-24', value: '75.12' }] });
  // El de 5 anios se aniadio despues y el simulador no lo cubria: la peticion
  // caia al final del fichero y contaba como una llamada mas, que es por lo
  // que "se gastaron 5" fallaba enseniando 6.
  if (u.includes('TREASURY_YIELD') && u.includes('5year')) return ok({ data: [{ date: '2026-10-24', value: '3.88' }] });
  if (u.includes('TREASURY_YIELD') && u.includes('10year')) return ok({ data: [{ date: '2026-10-24', value: '4.12' }] });
  if (u.includes('TREASURY_YIELD') && u.includes('30year')) return ok({ data: [{ date: '2026-10-24', value: '4.61' }] });

  if (u.includes('NEWS_SENTIMENT') && sentimientoPremium)
    return ok({ Information: 'Thank you for using Alpha Vantage! This is a premium endpoint. You may subscribe to any of the premium plans at https://www.alphavantage.co/premium/ to instantly unlock all premium endpoints.' });

  if (u.includes('NEWS_SENTIMENT'))
    return ok({ feed: [{
      title: 'NVIDIA cae tras el recorte de guia', url: 'https://x/1', source: 'Reuters',
      // RELATIVA A HOY, no una fecha fija.
      //
      // Estaba puesta a mano en '20261025T143000'. El panel solo enseña los
      // titulares de los ultimos NEWS_WINDOW_DAYS dias (tres), asi que el 28
      // de octubre la noticia se salio de la ventana y tres comprobaciones se
      // pusieron en rojo solas, sin que nadie tocara nada. Una prueba con una
      // fecha fija comparada contra `Date.now()` caduca sin avisar.
      time_published: ayerAlpha(), summary: 'resumen',
      overall_sentiment_score: -0.3,
      ticker_sentiment: [
        { ticker: 'AMD', relevance_score: '0.2', ticker_sentiment_score: '-0.1' },
        { ticker: 'NVDA', relevance_score: '0.9', ticker_sentiment_score: '-0.45' },
      ],
    }] });

  // Los ETFs del petroleo: cotizan en sesion, los da Finnhub como cualquier
  // accion. Se simula USO con dato y BNO SIN cobertura (c = 0), que es como
  // Finnhub contesta a un simbolo que no cubre.
  if (u.includes('/quote?') && u.includes('symbol=USO'))
    return ok({ c: 78.4, dp: 2.15, pc: 76.75, t: Math.floor(Date.now() / 1000) });
  if (u.includes('/quote?') && u.includes('symbol=BNO'))
    return ok({ c: 0, dp: 0, pc: 0, t: 0 });

  if (u.includes('/quote?')) {
    const s = /symbol=([A-Z]+)/.exec(u)?.[1] ?? '';
    return ok({ c: 100 + s.length, dp: 1.5 });
  }
  if (u.includes('/news?')) return ok([
    { id: 10, datetime: Math.floor(Date.now() / 1000) - 600, headline: 'Sri Lanka rescues 40 Iranian sailors, spokesman says', source: 'Reuters', url: 'https://x/10', summary: '', related: '' },
    { id: 11, datetime: Math.floor(Date.now() / 1000) - 700, headline: 'I paid off $11,000 of credit card debt in 18 months', source: 'CNBC', url: 'https://x/11', summary: '', related: '' },
    { id: 12, datetime: Math.floor(Date.now() / 1000) - 800, headline: 'Here are 4 big things we are watching in the stock market this week', source: 'CNBC', url: 'https://x/12', summary: '', related: '' },
    { id: 13, datetime: Math.floor(Date.now() / 1000) - 900, headline: 'Houthis say they targeted Saudi oil sites; attacks reported in Aden', source: 'Reuters', url: 'https://x/13', summary: '', related: '' },
    { id: 14, datetime: Math.floor(Date.now() / 1000) - 1000, headline: 'Nvidia slips as investors weigh capex guidance', source: 'Reuters', url: 'https://x/14', summary: '', related: '' },
    { id: 15, datetime: Math.floor(Date.now() / 1000) - 1100, headline: 'A museum in Lyon reopens after four years', source: 'Reuters', url: 'https://x/15', summary: '', related: '' },
    { id: 1, datetime: Math.floor(Date.now() / 1000) - 3600, headline: 'titular de hoy', source: 'FH', url: 'https://x/2', summary: 's', related: 'NVDA' },
    // Una de hace diez dias: tiene que guardarse pero NO salir en pantalla.
    { id: 2, datetime: Math.floor(Date.now() / 1000) - 10 * 86400, headline: 'titular viejo', source: 'FH', url: 'https://x/3', summary: 's', related: 'NVDA' },
  ]);
  if (u.includes('/calendar/earnings')) {
    // Ahora se pregunta por simbolo. El falso contesta como el de verdad:
    // solo la empresa que le piden.
    const s = /symbol=([A-Z]+)/.exec(u)?.[1] ?? '';
    const fechas: Record<string, string> = {
      NVDA: '2026-11-18', AAPL: '2026-10-29', MSFT: '2026-10-28', AMZN: '2026-10-30',
    };
    const f = fechas[s];
    return ok({ earningsCalendar: f ? [{ symbol: s, date: f, hour: 'amc', epsEstimate: 1.4 }] : [] });
  }

  return ok({});
}) as unknown as typeof fetch;

const { refreshGlobal } = await import('../src/ingest/market.js');
const { globalReport } = await import('../src/domain/global.js');

function check(nombre: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${nombre}${extra ? ' · ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

// ---- 1er ciclo: Brent falla ------------------------------------------------
const r1 = await refreshGlobal(true);

const alpha = llamadas.filter((l) => l.url.includes('alphavantage'));
let minGap = Infinity;
for (let i = 1; i < alpha.length; i += 1) minGap = Math.min(minGap, alpha[i]!.t - alpha[i - 1]!.t);

check('las peticiones a Alpha van espaciadas >= 1.4 s', minGap >= 1400, `minimo ${minGap} ms`);
check('el aviso de Alpha se detecta como fallo', r1.errors.some((e) => e.includes('Brent')), r1.errors.join(' | '));
check('un fallo NO tumba las otras tres series', r1.quotes >= 13, `${r1.quotes} cotizaciones`);
check('el sentimiento entra aunque fallara el Brent', r1.did.includes('sentimiento'));
// Las series lentas MAS el sentimiento. Se saca de la constante y no se
// escribe a mano: al aniadir el bono de 5 anios, un 5 escrito aqui paso a
// estar mal sin que el codigo tuviera nada que ver.
const { SERIES_LENTAS } = await import('../src/ingest/market.js');
check(
  `se gastaron ${SERIES_LENTAS + 1} peticiones de Alpha`,
  r1.alpha.used === SERIES_LENTAS + 1,
  `${r1.alpha.used}/${r1.alpha.budget}`,
);

const rep1 = globalReport();
const nvda = rep1.news.find((n) => n.id.startsWith('av:'));
check('la noticia de Alpha guarda sentimiento del ticker mas relevante', nvda?.sentiment === -0.45, String(nvda?.sentiment));
check('y su relevancia', nvda?.relevance === 0.9, String(nvda?.relevance));
check(
  'la fecha de Alpha se lee bien y en hora de mercado',
  nvda !== undefined && Math.abs((nvda.ts ?? 0) - esperadoAyer()) < 1000,
  new Date(nvda?.ts ?? 0).toISOString(),
);
check('la noticia de Finnhub se queda SIN puntuar', rep1.news.find((n) => n.id.startsWith('fh:'))?.sentiment === null);
check('la ventana de dias deja fuera lo viejo', !rep1.news.some((n) => n.headline === 'titular viejo'), `${rep1.news.length} en pantalla`);
check('"actualizado" se mueve aunque fallara un bloque', rep1.updatedAt !== null);
check('el Brent no aparece con precio inventado', !rep1.quotes.some((q) => q.symbol === 'BRENT'));

// ---- 2o ciclo: ya no falla, el dia NO estaba dado por hecho -----------------
fallaBrent = false;
const r2 = await refreshGlobal(true);
// Se comprueba el RESULTADO, no el volumen. Antes decia "entran las cuatro
// series" contando cotizaciones, y eso media que se habian vuelto a pedir
// TODAS — que es justo lo que se dejo de hacer para no gastar la cuota en
// datos que ya se tenian. Lo que importa es que el que faltaba llegue y que
// la pantalla quede completa.
{
  const tras = globalReport();
  check('al reintentar llega el que faltaba', tras.quotes.some((q) => q.symbol === 'BRENT'));
  for (const s of ['WTI', 'BRENT', 'US5Y', 'US10Y', 'US30Y']) {
    check(`y la pantalla tiene ${s}`, tras.quotes.some((q) => q.symbol === s));
  }
}
void r2;
check('ahora si esta el Brent', globalReport().quotes.some((q) => q.symbol === 'BRENT'));
check('y no se repiten las noticias ya guardadas', r2.newsNew === 0, `${r2.newsNew} nuevas`);

// ---- 3er ciclo: con el dia hecho, no vuelve a pedir las series -------------
const r3 = await refreshGlobal(false);
check('con el dia completo ya no pide petroleo/bonos', !r3.did.includes('petroleo/bonos'), r3.did.join(', '));

// ---- clasificacion de titulares -------------------------------------------
const rep3 = globalReport();
const tema = (trozo: string) => rep3.news.find((n) => n.headline.includes(trozo))?.topic;

check('un rescate de marineros queda fuera', tema('Sri Lanka') === 'otra', String(tema('Sri Lanka')));
check('la deuda de la tarjeta queda fuera', tema('credit card') === 'otra', String(tema('credit card')));
check('un museo NO se confunde con MU', tema('museum') === 'otra', String(tema('museum')));
check('"stock market" es macro', tema('stock market') === 'macro', String(tema('stock market')));
check('el petroleo saudi es macro', tema('Saudi oil') === 'macro', String(tema('Saudi oil')));
check('"Nvidia" sin etiqueta se reconoce como NVDA', tema('Nvidia slips') === 'empresa', String(tema('Nvidia slips')));
check('y se le pone el simbolo', rep3.news.find((n) => n.headline.includes('Nvidia slips'))?.symbols === 'NVDA');

const relevantes = rep3.news.filter((n) => n.topic !== 'otra').length;
check('el filtro deja fuera mas de la mitad del ruido', relevantes < rep3.news.length, `${relevantes} de ${rep3.news.length}`);

// ---- resultados por simbolo ------------------------------------------------
check('el calendario trae las cuatro que publican', rep3.earnings.length === 4, `${rep3.earnings.length}`);
check('y con su nombre, no el ticker', rep3.earnings.find((e) => e.symbol === 'AAPL')?.name === 'Apple');

// ---- estado por fuente -----------------------------------------------------
const porFuente = new Map(rep3.blocks.map((b) => [b.name, b]));
check('se apunta el estado de las cinco fuentes', rep3.blocks.length === 5, rep3.blocks.map((b) => b.name).join(', '));
check('cotizaciones consta como recien traida', porFuente.get('cotizaciones')?.stale === false);
check('y con el numero de filas', (porFuente.get('cotizaciones')?.rows ?? 0) > 0, String(porFuente.get('cotizaciones')?.rows));
check('el fallo del Brent quedo apuntado en su fuente', (porFuente.get('petroleo/bonos')?.failAt ?? 0) > 0);
check('pero petroleo/bonos NO esta vieja: luego trajo las cuatro', porFuente.get('petroleo/bonos')?.stale === false);

// ---- un endpoint de pago se apaga solo ------------------------------------
//
// Alpha Vantage contesta 200 con "This is a premium endpoint" dentro. Si no se
// recordara, el diario lo reintentaria cada hora para siempre.
sentimientoPremium = true;
const { blockDisabled } = await import('../src/domain/global.js');
const { disableBlock } = await import('../src/domain/global.js');
disableBlock('__prueba__', 'reinicio'); // asegura que la tabla meta existe

const gastoAntes = globalReport().alpha.used;
const r4 = await refreshGlobal(true);
check('un endpoint de pago queda apagado', blockDisabled('sentimiento'), 'sigue activo');

llamadas.length = 0;
const r5 = await refreshGlobal(true);
check('y ya no se vuelve a pedir', !r5.did.includes('sentimiento'), r5.did.join(', '));
// Se cuentan las llamadas a NEWS_SENTIMENT, no el gasto total: el gasto
// total incluye el petroleo y los bonos, que no tienen nada que ver con que
// el sentimiento este apagado. Antes colaba porque los numeros cuadraban por
// casualidad.
check(
  'asi que deja de gastar cuota por el',
  !llamadas.some((l) => l.url.includes('NEWS_SENTIMENT')),
  'volvio a pedir el sentimiento',
);
void r4;
check('la fuente sale apagada, no vieja', globalReport().blocks.find((b) => b.name === 'sentimiento')?.stale === false);
void gastoAntes;

// ---- las jornadas que no se fabrican --------------------------------------
//
// EL FALLO QUE ESTA PARTE EXISTE PARA EVITAR. El cierre diario de las series
// de Alpha -petroleo y bonos- se guardaba con la fecha del RELOJ. Esas series
// se publican con retraso, asi que cada refresco sin dato nuevo volvia a
// escribir el mismo numero en un dia nuevo: el WTI acabo con el mismo 103,37
// como cierre del 28, 30, 31, 1, 2 y 3 de noviembre.
//
// Lo que rompia: la variacion del dia comparaba el numero CONSIGO MISMO y
// salia 0,00 %, y el contador decia "9 jornadas" de historico. Un cero que
// significa "no lo sabemos" pintado igual que uno que significa "no se ha
// movido", que es el peor de los dos.
{
  const { saveDailyClose } = await import('../src/domain/global.js');
  const { db } = await import('../src/db/index.js');

  const cierres = (s: string) =>
    db().prepare('SELECT day, close FROM global_daily_close WHERE symbol = ? ORDER BY day').all(s) as
      Array<{ day: string; close: number }>;

  // Una serie de Alpha que trae SU dia: se guarda ahi, no en el de hoy.
  saveDailyClose(
    [{ symbol: 'XWTI', label: 'x', kind: 'materia', price: 100, changePct: null, ts: Date.now(), quoteTs: null, prevClose: null, day: '2026-10-28' }],
    '2026-11-03',
  );
  check('una serie diaria se guarda en SU dia, no en el de hoy', cierres('XWTI')[0]?.day === '2026-10-28', cierres('XWTI')[0]?.day);

  // Y refrescar otra vez sin dato nuevo NO crea una jornada.
  saveDailyClose(
    [{ symbol: 'XWTI', label: 'x', kind: 'materia', price: 100, changePct: null, ts: Date.now(), quoteTs: null, prevClose: null, day: '2026-10-28' }],
    '2026-11-04',
  );
  check('refrescar sin dato nuevo NO aniade jornada', cierres('XWTI').length === 1, `${cierres('XWTI').length} jornadas`);

  // Una accion, que no trae dia, si usa el de hoy: cotiza hoy por definicion.
  saveDailyClose(
    [{ symbol: 'XACC', label: 'x', kind: 'accion', price: 50, changePct: null, ts: Date.now(), quoteTs: null, prevClose: null }],
    '2026-11-03',
  );
  check('una accion sin dia propio usa la jornada de hoy', cierres('XACC')[0]?.day === '2026-11-03', cierres('XACC')[0]?.day);
}

// ---- el reintento NO vuelve a pedir lo que ya llego -----------------------
//
// EL FALLO: el dia solo se cierra cuando llegan las cinco series. Si una
// falla -el WTI llevaba fallando desde el 28 de octubre- el bloque reintenta
// cada hora, y reintentaba pidiendo LAS CINCO: cinco peticiones para traer
// cuatro datos que ya teniamos y fallar otra vez en la quinta.
//
// Con presupuesto de 20, cuatro intentos y se acabo el dia para TODO lo de
// Alpha. Es el 20/20 que aparecia en su base.
//
// Se prueba `traerLento` DIRECTAMENTE y no a traves de `refreshGlobal`: el
// reintento esta detras de un temporizador de una hora, asi que por la via
// larga la comprobacion saldria verde sin haber pedido nada. Ya paso al
// escribirla -"0 peticiones de 5"- y una prueba que pasa porque el codigo no
// llego a ejecutarse es peor que no tenerla.
{
  const { traerLento, SERIES_LENTAS } = await import('../src/ingest/market.js');

  llamadas.length = 0;
  const soloWti = await traerLento(new Set(['WTI']));
  const pedidas = llamadas.filter((l) => l.url.includes('alphavantage')).length;

  check('reintentar una serie pide UNA peticion', pedidas === 1, `${pedidas} de ${SERIES_LENTAS}`);
  check('y declara cuantas pidio, que es lo que se descuenta', soloWti.pedidas === 1, String(soloWti.pedidas));
  check(
    'sin volver a pedir las que ya estaban',
    !llamadas.some((l) => l.url.includes('TREASURY_YIELD')),
    'volvio a pedir un bono',
  );

  llamadas.length = 0;
  const todas = await traerLento();
  check(
    'sin lista, las pide todas (es el refresco a mano)',
    llamadas.filter((l) => l.url.includes('alphavantage')).length === SERIES_LENTAS,
    `${llamadas.filter((l) => l.url.includes('alphavantage')).length}`,
  );
  check('y tambien lo declara', todas.pedidas === SERIES_LENTAS, String(todas.pedidas));
}

// ---- el petroleo que si se mueve dentro del dia ---------------------------
//
// Las series de Alpha son DIARIAS: pedirlas mas a menudo no las hace mas
// frescas. Para ver el crudo moverse en sesion hay que mirar algo que cotice
// en sesion, y USO/BNO son fondos cotizados estadounidenses — la misma clase
// de instrumento que el QQQ que el diario ya pide cada cinco minutos.
{
  const rep = globalReport();
  const uso = rep.quotes.find((q) => q.symbol === 'USO');

  check('la fuente del crudo entra con el bloque rapido', uso !== undefined, 'no llego');
  check('y va al telon de fondo, no con las acciones', uso?.kind === 'materia', String(uso?.kind));
  check('con su variacion del dia EN VIVO, la del proveedor', uso?.changePct === 2.15, String(uso?.changePct));
  check('y se ve que SIGUE al crudo, que no es el barril', (uso?.label ?? '').includes('sigue al WTI'), uso?.label);

  // Finnhub contesta c = 0 a un simbolo que no cubre. Si algun dia deja de dar
  // uno de estos, la fila tiene que desaparecer sola y no entrar a cero.
  check('una fuente sin cobertura se descarta sola', !rep.quotes.some((q) => q.symbol === 'BNO'));

  // Y lo que NO debe pasar: que el ETF se cuele en la cesta de las diez.
  const { QQQ_WEIGHTS, PETROLEO_FUENTES } = await import('../src/config.js');
  check('la fuente del crudo no entra en los pesos del QQQ', !('USO' in QQQ_WEIGHTS));

  // Es una LISTA ampliable: ese es el sentido de "traerlo de varios lados".
  // Una candidata que el proveedor no cubra se descarta sola, asi que probar
  // una cuesta cero.
  check('la lista admite varias fuentes', PETROLEO_FUENTES.length >= 2, `${PETROLEO_FUENTES.length}`);
  check('y cada una declara a que sigue', PETROLEO_FUENTES.every((f) => f.sigue !== ''));
}

console.log(`\nfase de mercado ahora: ${r3.fase} · alpha ${r3.alpha.used}/${r3.alpha.budget}`);
