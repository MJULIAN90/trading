import { YAHOO_SIMBOLOS, type SimboloYahoo } from '../config.js';
import { db } from '../db/index.js';
import { num } from './market.js';

/**
 * Yahoo Finance como SEGUNDA fuente. Nunca como la unica.
 *
 * Por que entra y por que asi.
 *
 * Lo que mas falta hace no es precision, es el INSTRUMENTO CORRECTO. El diario
 * guarda el petroleo mirando USO y BNO, que son ETF -- un proxy -- y el nivel
 * del barril sale de Alpha Vantage UNA VEZ AL DIA, porque su plan gratuito son
 * 25 peticiones diarias para todo. Yahoo da `CL=F` y `BZ=F`, que son el futuro
 * de verdad, sin clave y sin cuota diaria. Eso no es afinar un decimal.
 *
 * LO QUE HAY QUE SABER ANTES DE CONFIAR EN ESTO:
 *
 * Yahoo **no tiene API publica oficial**. Esto llama a un endpoint que ellos
 * usan para su propia web y que no documentan ni se comprometen a mantener. Se
 * rompe cada cierto tiempo -- al endpoint de cotizaciones v7 le pasó en 2023,
 * cuando le pusieron cookie y "crumb". No es un riesgo hipotetico, es
 * mantenimiento recurrente.
 *
 * Por eso:
 *   - se usa el endpoint de GRAFICOS (v8/finance/chart) y no el de
 *     cotizaciones: el v8 todavia no pide cookie ni token.
 *   - lo que llega se guarda en SU PROPIA tabla, `yahoo_quotes`, y NO se
 *     mezcla con `global_quotes`. Las dos fuentes se enfrentan en pantalla; no
 *     se promedian ni se sustituyen a escondidas. Es el mismo criterio que ya
 *     hay con `broker_pnl` al lado del PnL calculado, y con la polaridad de una
 *     etiqueta al lado de su impacto medido.
 *   - si Yahoo no contesta, no pasa nada: el resto del diario no se entera.
 */

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

export interface CotizacionYahoo {
  symbol: string;
  price: number | null;
  prevClose: number | null;
  currency: string;
  exchange: string;
  /** Cuando se formo el dato EN EL MERCADO, no cuando lo pedimos. */
  quoteTs: number | null;
  error: string | null;
}

/**
 * Una cotizacion. Devuelve el error dentro en vez de lanzarlo.
 *
 * Que un simbolo falle no puede llevarse los otros catorce: con quince
 * peticiones sueltas, la unica forma de que una mala tarde la estropee entera
 * es dejarla lanzar.
 */
export async function pedirUna(symbol: string, timeoutMs = 8000): Promise<CotizacionYahoo> {
  const vacio: CotizacionYahoo = {
    symbol,
    price: null,
    prevClose: null,
    currency: '',
    exchange: '',
    quoteTs: null,
    error: null,
  };

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE}${encodeURIComponent(symbol)}?interval=1d&range=5d`, {
      signal: control.signal,
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
    });

    if (!res.ok) return { ...vacio, error: `HTTP ${res.status}` };

    const j = (await res.json()) as {
      chart?: { result?: Array<{ meta?: Record<string, unknown> }>; error?: { description?: string } };
    };

    const meta = j.chart?.result?.[0]?.meta;
    if (!meta) return { ...vacio, error: j.chart?.error?.description ?? 'sin resultado' };

    // `num` se importa de `market.ts` en vez de escribirlo otra vez aqui, y el
    // motivo lo acaba de encontrar la prueba: la version ingenua -- convertir y
    // mirar si es finito -- convierte `null` en CERO, porque `Number(null)` es
    // 0 y 0 es finito. Ese fallo exacto ya costo un disgusto: la previsión de
    // AAPL llego a null desde Finnhub, se guardo como 0 y el diario anuncio un
    // -100 % el dia antes de que la empresa publicara.
    //
    // Aqui habria sido peor: un precio nulo guardado como 0 se pinta como una
    // cotizacion de cero dolares y hunde cualquier porcentaje que lo use.
    const sello = num(meta.regularMarketTime);

    return {
      symbol,
      price: num(meta.regularMarketPrice),
      prevClose: num(meta.chartPreviousClose) ?? num(meta.previousClose),
      currency: typeof meta.currency === 'string' ? meta.currency : '',
      exchange:
        typeof meta.fullExchangeName === 'string'
          ? meta.fullExchangeName
          : typeof meta.exchangeName === 'string'
            ? meta.exchangeName
            : '',
      // Yahoo lo da en segundos; el resto del diario trabaja en milisegundos.
      quoteTs: sello === null ? null : sello * 1000,
      error: null,
    };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    return { ...vacio, error: e.name === 'AbortError' ? 'tiempo agotado' : (e.message ?? 'fallo') };
  } finally {
    clearTimeout(reloj);
  }
}

export interface ResultadoYahoo {
  pedidos: number;
  guardados: number;
  fallos: Array<{ symbol: string; error: string }>;
  ms: number;
}

/**
 * Pide todos los simbolos configurados y los guarda.
 *
 * EN SERIE y con una pausa, no en paralelo. Son quince peticiones a un servicio
 * que no cobra, no pide clave y no se ha comprometido a nada: dispararle quince
 * a la vez cada pocos minutos es la forma de acabar con un 429 y de merecerlo.
 * En serie tarda unos cuatro segundos y no molesta a nadie.
 */
export async function traerYahoo(simbolos: SimboloYahoo[] = YAHOO_SIMBOLOS): Promise<ResultadoYahoo> {
  const t0 = Date.now();
  const fallos: Array<{ symbol: string; error: string }> = [];
  let guardados = 0;

  const target = db();
  const guardar = target.prepare(
    `INSERT INTO yahoo_quotes (symbol, price, prev_close, currency, exchange, quote_ts, fetched_at)
     VALUES (@symbol, @price, @prev_close, @currency, @exchange, @quote_ts, @fetched_at)
     ON CONFLICT (symbol) DO UPDATE SET
       price = excluded.price, prev_close = excluded.prev_close,
       currency = excluded.currency, exchange = excluded.exchange,
       quote_ts = excluded.quote_ts, fetched_at = excluded.fetched_at`,
  );

  for (const s of simbolos) {
    const r = await pedirUna(s.symbol);

    if (r.error !== null) {
      fallos.push({ symbol: s.symbol, error: r.error });
      continue;
    }

    // Un precio nulo no se guarda. Escribir un hueco encima de un dato bueno de
    // hace diez minutos es perder informacion a cambio de nada.
    if (r.price === null) {
      fallos.push({ symbol: s.symbol, error: 'sin precio' });
      continue;
    }

    guardar.run({
      symbol: r.symbol,
      price: r.price,
      prev_close: r.prevClose,
      currency: r.currency,
      exchange: r.exchange,
      quote_ts: r.quoteTs,
      fetched_at: Date.now(),
    });

    guardados++;
    await new Promise((listo) => setTimeout(listo, 150));
  }

  return { pedidos: simbolos.length, guardados, fallos, ms: Date.now() - t0 };
}
