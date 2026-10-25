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
  if (u.includes('TREASURY_YIELD') && u.includes('10year')) return ok({ data: [{ date: '2026-10-24', value: '4.12' }] });
  if (u.includes('TREASURY_YIELD') && u.includes('30year')) return ok({ data: [{ date: '2026-10-24', value: '4.61' }] });

  if (u.includes('NEWS_SENTIMENT') && sentimientoPremium)
    return ok({ Information: 'Thank you for using Alpha Vantage! This is a premium endpoint. You may subscribe to any of the premium plans at https://www.alphavantage.co/premium/ to instantly unlock all premium endpoints.' });

  if (u.includes('NEWS_SENTIMENT'))
    return ok({ feed: [{
      title: 'NVIDIA cae tras el recorte de guia', url: 'https://x/1', source: 'Reuters',
      time_published: '20261025T143000', summary: 'resumen',
      overall_sentiment_score: -0.3,
      ticker_sentiment: [
        { ticker: 'AMD', relevance_score: '0.2', ticker_sentiment_score: '-0.1' },
        { ticker: 'NVDA', relevance_score: '0.9', ticker_sentiment_score: '-0.45' },
      ],
    }] });

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
check('se gastaron 5 peticiones de Alpha', r1.alpha.used === 5, `${r1.alpha.used}/${r1.alpha.budget}`);

const rep1 = globalReport();
const nvda = rep1.news.find((n) => n.id.startsWith('av:'));
check('la noticia de Alpha guarda sentimiento del ticker mas relevante', nvda?.sentiment === -0.45, String(nvda?.sentiment));
check('y su relevancia', nvda?.relevance === 0.9, String(nvda?.relevance));
check('la fecha "20261025T143000" se lee bien', new Date(nvda?.ts ?? 0).toISOString().startsWith('2026-10-25T18:30'), new Date(nvda?.ts ?? 0).toISOString());
check('la noticia de Finnhub se queda SIN puntuar', rep1.news.find((n) => n.id.startsWith('fh:'))?.sentiment === null);
check('la ventana de dias deja fuera lo viejo', !rep1.news.some((n) => n.headline === 'titular viejo'), `${rep1.news.length} en pantalla`);
check('"actualizado" se mueve aunque fallara un bloque', rep1.updatedAt !== null);
check('el Brent no aparece con precio inventado', !rep1.quotes.some((q) => q.symbol === 'BRENT'));

// ---- 2o ciclo: ya no falla, el dia NO estaba dado por hecho -----------------
fallaBrent = false;
const r2 = await refreshGlobal(true);
check('al reintentar entran las cuatro series', r2.quotes >= 15, `${r2.quotes} cotizaciones`);
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

const r5 = await refreshGlobal(true);
check('y ya no se vuelve a pedir', !r5.did.includes('sentimiento'), r5.did.join(', '));
check('asi que deja de gastar cuota por el', r5.alpha.used - r4.alpha.used <= 4, `+${r5.alpha.used - r4.alpha.used}`);
check('la fuente sale apagada, no vieja', globalReport().blocks.find((b) => b.name === 'sentimiento')?.stale === false);
void gastoAntes;

console.log(`\nfase de mercado ahora: ${r3.fase} · alpha ${r3.alpha.used}/${r3.alpha.budget}`);
