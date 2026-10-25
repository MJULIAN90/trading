import {
  ALPHA_API_KEY,
  ALPHA_DAILY_BUDGET,
  COMPANY_NAMES,
  FINNHUB_API_KEY,
  MARKET_MOVE_PCT,
  MARKET_REFRESH_CLOSED_MIN,
  MARKET_REFRESH_EXT_MIN,
  MARKET_REFRESH_FIXED_MIN,
  MARKET_REFRESH_OPEN_MIN,
  MARKET_SENTIMENT_HOURS,
  MARKET_SLOW_HOURS,
  MARKET_TICKERS,
} from '../config.js';
import { marketOffsetAt } from '../domain/clock.js';
import {
  alertsFor,
  alphaSpend,
  alphaUsage,
  blockDisabled,
  disableBlock,
  globalReport,
  markBlock,
  markRefresh,
  markSchedule,
  saveDailyClose,
  saveEarnings,
  saveNews,
  saveQuotes,
  type Alert,
  type Earning,
  type NewsItem,
  type Quote,
} from '../domain/global.js';
import { calendarDate } from '../domain/sessions.js';

/**
 * Contexto de mercado. Es la UNICA parte del diario que sale a internet.
 *
 * DOS PROVEEDORES, Y CADA UNO DONDE ES BUENO:
 *
 *   FINNHUB        cotizaciones de acciones, noticias y calendario de
 *                  resultados. Su limite es por MINUTO y es generoso, asi que
 *                  aguanta el refresco de diez minutos sin despeinarse.
 *
 *   ALPHA VANTAGE  petroleo (WTI y Brent) y tipos del Tesoro. Tiene endpoints
 *                  dedicados para eso, que nadie mas da tan limpios, pero su
 *                  plan gratuito son UNAS POCAS DECENAS DE PETICIONES AL DIA.
 *
 * De ahi que haya DOS CADENCIAS. Pedirlo todo cada diez minutos agotaria Alpha
 * Vantage antes del desayuno, y tampoco haria falta: el endpoint del Tesoro es
 * diario y el petroleo no te cambia un scalp en MNQ de un cuarto de hora al
 * siguiente.
 *
 *   rapido  cada MARKET_REFRESH_MIN minutos: cotizaciones y noticias
 *   lento   cada MARKET_SLOW_HOURS horas: petroleo, bonos y resultados
 *
 * EL NASDAQ SE MIDE CON QQQ. Los indices de verdad (^IXIC, ^NDX) no entran en
 * el plan gratuito de Finnhub, pero el ETF si, porque es una accion como otra
 * cualquiera. QQQ replica el Nasdaq-100, asi que su variacion del dia sirve
 * igual para saber si el terreno se movio.
 *
 * ESCRITO SIN PODER PROBARLO: el entorno donde se escribio no tiene salida a
 * internet. Por eso cada bloque se pide por separado y su fallo se guarda CON
 * NOMBRE: si caen las noticias, los precios siguen, y el aviso dice cual fallo
 * en vez de un "no se pudo actualizar" que no deja arreglar nada.
 */

const FINNHUB = 'https://finnhub.io/api/v1';
const ALPHA = 'https://www.alphavantage.co/query';

const TIMEOUT_MS = 15_000;

async function pedir<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const data = (await res.json()) as unknown;

    // Los dos proveedores contestan 200 con un objeto de error dentro cuando
    // la clave no vale o se acabo la cuota. Sin esto, quedarse sin cuota se
    // guardaria como "cero resultados" y pareceria un dia tranquilo.
    if (data && !Array.isArray(data) && typeof data === 'object') {
      const o = data as Record<string, unknown>;
      const msg = o['Error Message'] ?? o['Note'] ?? o['Information'] ?? o.error;
      // 240 y no 160: el aviso de Alpha Vantage dice al final si es el limite
      // por segundo o la cuota del dia, que son dos problemas distintos, y
      // cortarlo antes dejaba justo esa parte fuera.
      if (typeof msg === 'string' && msg) throw new Error(msg.slice(0, 240));
    }

    return data as T;
  } finally {
    clearTimeout(t);
  }
}

/**
 * ALPHA VANTAGE TIENE DOS LIMITES, Y EL QUE NOS MORDIO ES EL PEQUEÑO.
 *
 * Aparte de las peticiones al dia, pide COMO MUCHO UNA POR SEGUNDO. Las cuatro
 * series iban en serie, si, pero una detras de otra sin pausa: cuatro en medio
 * segundo. Su respuesta a eso no es un error HTTP sino un 200 con un texto
 * dentro -"consider spreading out your free API requests more sparingly"- que
 * tumbaba el bloque entero.
 *
 * Esta funcion es el unico sitio por el que se le habla a Alpha Vantage, y
 * espera lo que haga falta desde la peticion anterior. Un segundo y medio en
 * vez de uno porque el limite lo cuenta su servidor, no el nuestro, y la
 * latencia de la red no juega a nuestro favor.
 */
const ALPHA_GAP_MS = 1_500;
let ultimaAlpha = 0;

async function pedirAlpha<T>(url: string): Promise<T> {
  const espera = ALPHA_GAP_MS - (Date.now() - ultimaAlpha);
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));

  // Se marca ANTES de pedir: si se marcara despues, dos peticiones lentas
  // seguidas se solaparian en el contador y volverian a juntarse.
  ultimaAlpha = Date.now();
  return pedir<T>(url);
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const diasISO = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------- el reloj de mercado

export type Fase = 'abierto' | 'extendido' | 'cerrado';

export const FASE_MIN: Record<Fase, number> = {
  abierto: MARKET_REFRESH_OPEN_MIN,
  extendido: MARKET_REFRESH_EXT_MIN,
  cerrado: MARKET_REFRESH_CLOSED_MIN,
};

/**
 * En que fase esta el mercado americano de ACCIONES en ese instante.
 *
 * Ojo: no es el mismo horario que el de tu MNQ. Los futuros cotizan casi 24
 * horas y la jornada rueda a las 18:00; la bolsa de contado abre a las 09:30 y
 * cierra a las 16:00, y es de ella de donde salen estos precios y estos
 * titulares. Mezclar los dos horarios aqui pondria el refresco rapido en mitad
 * de la noche, cuando AAPL lleva ocho horas valiendo lo mismo.
 *
 * No contempla festivos: un 4 de julio se pedira a ritmo de dia abierto y
 * devolvera once veces el cierre del dia anterior. Son nueve dias al ano y
 * tenerlos en cuenta obligaria a mantener un calendario a mano, que es
 * exactamente la clase de fichero que se queda sin actualizar.
 */
export function faseDeMercado(tsMs: number = Date.now()): Fase {
  const ny = new Date(tsMs + marketOffsetAt(tsMs) * 3_600_000);

  const dia = ny.getUTCDay();
  if (dia === 0 || dia === 6) return 'cerrado';

  const min = ny.getUTCHours() * 60 + ny.getUTCMinutes();

  if (min >= 9 * 60 + 30 && min < 16 * 60) return 'abierto';
  if (min >= 4 * 60 && min < 20 * 60) return 'extendido';
  return 'cerrado';
}

/** Cada cuantos minutos toca el bloque rapido ahora mismo. */
export function minutosDeEspera(tsMs: number = Date.now()): { fase: Fase; min: number } {
  const fase = faseDeMercado(tsMs);
  return { fase, min: MARKET_REFRESH_FIXED_MIN ?? FASE_MIN[fase] };
}

// -------------------------------------------------- presupuesto Alpha Vantage

/**
 * Pide permiso para gastar `n` peticiones de Alpha Vantage.
 *
 * Se apunta ANTES de pedir y no despues: si la peticion falla porque la cuota
 * ya estaba agotada, se la cobraron igual. Apuntarla solo al tener exito haria
 * que el contador se quedara corto justo el dia en que hace falta.
 */
function puedoGastarAlpha(n: number): boolean {
  if (!ALPHA_API_KEY) return false;
  if (alphaUsage().used + n > ALPHA_DAILY_BUDGET) return false;
  alphaSpend(n);
  return true;
}

// ----------------------------------------------------- FINNHUB: cotizaciones

interface FhQuote { c?: number; dp?: number }

/**
 * Finnhub pide UN simbolo por peticion, asi que son once llamadas por ciclo
 * (diez acciones mas QQQ). Con su limite por minuto no es problema; agruparlas
 * en Promise.all podria serlo, asi que van en tandas pequeñas.
 */
async function traerCotizaciones(): Promise<Quote[]> {
  const simbolos = ['QQQ', ...MARKET_TICKERS];
  const now = Date.now();
  const out: Quote[] = [];

  for (let i = 0; i < simbolos.length; i += 5) {
    const tanda = simbolos.slice(i, i + 5);
    const res = await Promise.all(
      tanda.map(async (s) => {
        const q = await pedir<FhQuote>(`${FINNHUB}/quote?symbol=${encodeURIComponent(s)}&token=${FINNHUB_API_KEY}`);
        return { s, q };
      }),
    );

    for (const { s, q } of res) {
      const price = num(q.c);
      // Finnhub devuelve c = 0 para un simbolo que no cubre, no un error.
      if (price === null || price === 0) continue;

      out.push({
        symbol: s,
        // "QQQ (ETF)" y no "Nasdaq 100": el ETF cotiza sobre 700 y el indice
        // sobre 25.000, asi que llamarlo Nasdaq 100 hace pensar que el dato
        // esta roto. Lo que SI vale del ETF es su variacion del dia, que es
        // practicamente la del indice, y es lo que se mira aqui.
        label: s === 'QQQ' ? 'QQQ · ETF del Nasdaq 100' : s,
        kind: s === 'QQQ' ? 'indice' : 'accion',
        price,
        changePct: num(q.dp),
        ts: now,
      });
    }
  }

  return out;
}

// --------------------------------------------------------- FINNHUB: noticias

interface FhNews {
  id?: number;
  datetime?: number;
  headline?: string;
  source?: string;
  url?: string;
  summary?: string;
  related?: string;
}

/**
 * Noticias generales del mercado en UNA peticion, en vez de una por empresa.
 *
 * Once peticiones de noticias por ciclo serian 950 al dia solo de titulares, y
 * la mayoria repetidos. El canal general trae lo que mueve al mercado entero,
 * que es justo lo que puede cambiarte la sesion, y luego se marca cuales
 * mencionan uno de tus simbolos.
 */
async function traerNoticias(): Promise<NewsItem[]> {
  const rows = await pedir<FhNews[]>(`${FINNHUB}/news?category=general&token=${FINNHUB_API_KEY}`);
  if (!Array.isArray(rows)) return [];

  const mios = new Set(MARKET_TICKERS);

  return rows.flatMap((r) => {
    if (!r.headline || !r.datetime) return [];

    // `related` viene como "AAPL,MSFT" o vacio. Solo se guardan los que te
    // interesan: son los que deciden si suena la alerta.
    const rel = (r.related ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => mios.has(s));

    return [{
      id: r.id ? `fh:${r.id}` : (r.url ?? `${r.headline}:${r.datetime}`),
      ts: r.datetime * 1000,
      headline: r.headline,
      source: r.source ?? null,
      url: r.url ?? null,
      summary: r.summary ? r.summary.slice(0, 400) : null,
      symbols: rel.length > 0 ? rel.join(', ') : null,
      // Finnhub no puntua. Se deja en null, no en 0: "sin puntuar" y "neutro"
      // no son lo mismo y pintarlos igual seria inventarse el dato.
      sentiment: null,
      relevance: null,
    }];
  });
}

// ------------------------------------------ ALPHA VANTAGE: noticias + animo

interface AvNews {
  feed?: Array<{
    title?: string;
    url?: string;
    time_published?: string;
    summary?: string;
    source?: string;
    overall_sentiment_score?: number;
    ticker_sentiment?: Array<{
      ticker?: string;
      relevance_score?: string;
      ticker_sentiment_score?: string;
    }>;
  }>;
}

/**
 * Lo UNICO que Finnhub no da y aqui si: cada titular viene puntuado.
 *
 * Dos numeros por noticia y simbolo: cuanto habla de ESE simbolo (relevancia)
 * y si lo hace bien o mal (sentimiento, de -1 a +1). Es la diferencia entre
 * "hay cuarenta titulares" y "hay uno muy negativo que va de NVDA", que es la
 * pregunta que de verdad te haces antes de abrir.
 *
 * UNA SOLA PETICION para los diez simbolos. Con 20 al dia de techo, pedir una
 * por empresa seria media jornada de cuota para una pasada.
 *
 * La fecha viene como "20261025T143000", sin guiones y en hora de Nueva York.
 * Tratarla como ISO daria Invalid Date y la noticia se ordenaria en 1970.
 */
function fechaAlpha(s: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;

  const p = m.slice(1).map(Number);
  const utc = Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), Number(p[3]), Number(p[4]), Number(p[5]));

  // Viene en hora de mercado, asi que se le QUITA el desfase para pasarla a
  // UTC. El desfase se calcula sobre la propia fecha por el cambio de hora.
  return utc - marketOffsetAt(utc) * 3_600_000;
}

async function traerSentimiento(): Promise<NewsItem[]> {
  const url =
    `${ALPHA}?function=NEWS_SENTIMENT&tickers=${MARKET_TICKERS.join(',')}` +
    `&limit=50&sort=LATEST&apikey=${ALPHA_API_KEY}`;

  const data = await pedirAlpha<AvNews>(url);
  const mios = new Set(MARKET_TICKERS);

  return (data.feed ?? []).flatMap((n) => {
    if (!n.title || !n.time_published) return [];

    const ts = fechaAlpha(n.time_published);
    if (ts === null) return [];

    // De todos los simbolos que menciona nos quedamos con el MAS relevante de
    // los tuyos: es el que explica por que esta noticia te sale a ti.
    let mejor: { ticker: string; rel: number; sent: number } | null = null;
    for (const t of n.ticker_sentiment ?? []) {
      const tk = (t.ticker ?? '').toUpperCase();
      if (!mios.has(tk)) continue;

      const rel = Number(t.relevance_score);
      const sent = Number(t.ticker_sentiment_score);
      if (!Number.isFinite(rel)) continue;
      if (mejor === null || rel > mejor.rel)
        mejor = { ticker: tk, rel, sent: Number.isFinite(sent) ? sent : 0 };
    }

    const propios = (n.ticker_sentiment ?? [])
      .map((t) => (t.ticker ?? '').toUpperCase())
      .filter((t) => mios.has(t));

    return [{
      // La URL como id: Alpha Vantage no da uno. Es estable y, cuando la misma
      // noticia llega tambien por Finnhub con otro id, se guardan las dos; no
      // es ideal, pero inventar una clave por titular juntaria notas distintas
      // del mismo medio.
      id: `av:${n.url ?? n.title}`,
      ts,
      headline: n.title,
      source: n.source ?? null,
      url: n.url ?? null,
      summary: n.summary ? n.summary.slice(0, 400) : null,
      symbols: propios.length > 0 ? [...new Set(propios)].join(', ') : null,
      sentiment: mejor?.sent ?? (Number.isFinite(n.overall_sentiment_score) ? n.overall_sentiment_score! : null),
      relevance: mejor?.rel ?? null,
    }];
  });
}

// ------------------------------------------------------ FINNHUB: resultados

interface FhEarning {
  date?: string;
  epsActual?: number | null;
  epsEstimate?: number | null;
  hour?: string;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
  symbol?: string;
}

/**
 * El calendario, PREGUNTANDO POR CADA EMPRESA, no pidiendo el de todas.
 *
 * Antes se pedia el calendario entero de la bolsa americana para 37 dias y se
 * filtraban las diez tuyas. Sobre el papel es una peticion en vez de diez;
 * en la practica salia una tabla con nueve rayas y solo NVDA con fecha. Esa
 * llamada devuelve miles de empresas y el plan gratuito la recorta, asi que
 * las tuyas caian fuera del recorte por puro azar alfabetico.
 *
 * Diez peticiones no son problema aqui: el limite de Finnhub es por minuto y
 * este bloque corre cada MARKET_SLOW_HOURS horas, o sea unas cuarenta al dia.
 * Y preguntando por simbolo la respuesta es exacta.
 */
async function traerResultados(): Promise<Earning[]> {
  const out: Earning[] = [];
  const desde = diasISO(-7);
  const hasta = diasISO(60);

  for (let i = 0; i < MARKET_TICKERS.length; i += 5) {
    const tanda = MARKET_TICKERS.slice(i, i + 5);

    const res = await Promise.all(
      tanda.map(async (s) => {
        const d = await pedir<{ earningsCalendar?: FhEarning[] }>(
          `${FINNHUB}/calendar/earnings?from=${desde}&to=${hasta}` +
            `&symbol=${encodeURIComponent(s)}&token=${FINNHUB_API_KEY}`,
        );
        return d.earningsCalendar ?? [];
      }),
    );

    for (const filas of res) {
      for (const r of filas) {
        if (!r.symbol || !r.date) continue;
        out.push({
          symbol: r.symbol,
          name: COMPANY_NAMES[r.symbol] ?? r.symbol,
          date: r.date.slice(0, 10),
          when: r.hour ?? null,
          epsEstimate: num(r.epsEstimate),
          epsActual: num(r.epsActual),
          revenueEstimate: num(r.revenueEstimate),
          revenueActual: num(r.revenueActual),
        });
      }
    }
  }

  return out;
}

// --------------------------------------- ALPHA VANTAGE: petroleo y Tesoro

interface AvSeries { data?: Array<{ date?: string; value?: string }> }

/**
 * Los endpoints de Alpha Vantage devuelven una serie diaria completa. Solo
 * interesa el ultimo valor que no venga como ".", que es como marcan los dias
 * sin dato (festivos). Un "." pasado a numero da NaN y pintaria un hueco.
 */
async function ultimoValor(url: string): Promise<number | null> {
  const s = await pedirAlpha<AvSeries>(url);
  for (const row of s.data ?? []) {
    const v = num(row.value);
    if (v !== null) return v;
  }
  return null;
}

/** Cuantas series pide este bloque. Es lo que se descuenta de la cuota. */
export const SERIES_LENTAS = 4;

interface Lento {
  quotes: Quote[];
  errors: string[];
  /** True solo si llegaron LAS CUATRO. Decide si el dia se da por hecho. */
  completo: boolean;
}

async function traerLento(): Promise<Lento> {
  const now = Date.now();
  const out: Quote[] = [];
  const errors: string[] = [];

  const piezas: Array<{ symbol: string; label: string; kind: Quote['kind']; url: string }> = [
    { symbol: 'WTI', label: 'WTI', kind: 'materia', url: `${ALPHA}?function=WTI&interval=daily&apikey=${ALPHA_API_KEY}` },
    { symbol: 'BRENT', label: 'Brent', kind: 'materia', url: `${ALPHA}?function=BRENT&interval=daily&apikey=${ALPHA_API_KEY}` },
    { symbol: 'US10Y', label: 'EE.UU. 10 anios', kind: 'bono', url: `${ALPHA}?function=TREASURY_YIELD&interval=daily&maturity=10year&apikey=${ALPHA_API_KEY}` },
    { symbol: 'US30Y', label: 'EE.UU. 30 anios', kind: 'bono', url: `${ALPHA}?function=TREASURY_YIELD&interval=daily&maturity=30year&apikey=${ALPHA_API_KEY}` },
  ];

  // Cada serie con su propio try y no uno para las cuatro: antes, que el Brent
  // fallara dejaba tambien sin petroleo y sin los dos bonos, cuando tres de
  // ellas habian llegado o podian llegar. `pedirAlpha` se encarga de la pausa
  // entre una y otra.
  for (const p of piezas) {
    try {
      const v = await ultimoValor(p.url);
      if (v === null) { errors.push(`${p.label}: sin valor`); continue; }

      // Sin variacion del dia a proposito: estas series son DIARIAS, el ultimo
      // valor puede ser el de ayer, e inventarle un porcentaje seria mentir.
      out.push({ symbol: p.symbol, label: p.label, kind: p.kind, price: v, changePct: null, ts: now });
    } catch (e) {
      errors.push(`${p.label}: ${(e as Error).message}`);
    }
  }

  return { quotes: out, errors, completo: out.length === piezas.length };
}

// -------------------------------------------------------------- el refresco

export interface RefreshResult {
  quotes: number;
  earnings: number;
  newsNew: number;
  alerts: Alert[];
  errors: string[];
  /** Que bloques se pidieron en este ciclo. */
  did: string[];
  fase: Fase;
  /** Peticiones de Alpha Vantage gastadas hoy y techo. */
  alpha: { used: number; budget: number };
}

/**
 * Cuando corrio cada bloque lento por ultima vez. En memoria a proposito:
 * reiniciar el servidor y repetirlos cuesta unas pocas peticiones, y
 * persistirlo seria estado que mantener para ahorrar casi nada.
 */
let ultimoCalendario = 0;

/**
 * Cuando se puede volver a intentar cada bloque de Alpha Vantage.
 *
 * ESTO ERA UN FALLO Y LO PAGO CARO: antes el dia se daba por hecho AUNQUE la
 * peticion hubiera fallado, con la idea de que un proveedor caido no se comiera
 * la cuota reintentando. El efecto real es el contrario de lo que se quiere:
 * el primer intento del dia falla por lo que sea -un limite por segundo, un
 * corte de red- y te quedas sin petroleo ni bonos HASTA MAÑANA, con 20
 * peticiones sin gastar.
 *
 * Lo que de verdad protege la cuota es el presupuesto diario, no el no
 * reintentar. Asi que ahora el dia solo se marca cuando llegan LAS CUATRO
 * series, y un fallo espera una hora y vuelve a probar.
 */
const REINTENTO_MS = 60 * 60_000;
let proximoSeries = 0;
let proximoSentimiento = 0;
/** Dia UTC en el que las series diarias llegaron COMPLETAS. */
let diaSeries = '';

export async function refreshGlobal(forzarLento = false): Promise<RefreshResult> {
  const errors: string[] = [];
  const did: string[] = [];
  const ahora = Date.now();
  const hoy = new Date(ahora).toISOString().slice(0, 10);

  /**
   * Corre un bloque y APUNTA como le fue, con nombre.
   *
   * Lo de apuntarlo es lo que convierte "el ultimo refresco fallo" -que no
   * deja arreglar nada- en "las noticias entraron hace 4 min, el petroleo
   * lleva dos dias sin contestar", que si.
   */
  const bloque = async <T>(name: string, fn: () => Promise<T[]>): Promise<T[]> => {
    did.push(name);
    try {
      const filas = await fn();
      markBlock(name, true, filas.length);
      return filas;
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(`${name}: ${msg}`);
      markBlock(name, false, 0, msg);
      return [];
    }
  };

  // --- bloque rapido (Finnhub): sin cuota diaria, va en cada ciclo ---------
  const [cotiz, noticias] = await Promise.all([
    bloque('cotizaciones', traerCotizaciones),
    bloque('noticias', traerNoticias),
  ]);

  // --- calendario de resultados (Finnhub): cada MARKET_SLOW_HOURS ----------
  // No gasta cuota de Alpha, pero devuelve fechas que no cambian en el dia.
  let resultados: Earning[] = [];
  if (forzarLento || ahora - ultimoCalendario > MARKET_SLOW_HOURS * 3_600_000) {
    resultados = await bloque('resultados', traerResultados);
    ultimoCalendario = ahora;
  }

  // --- series diarias (Alpha Vantage): UNA VEZ AL DIA ----------------------
  //
  // Petroleo y tipos del Tesoro son series DIARIAS: el valor de las 10:00 y el
  // de las 16:00 son el mismo numero. Antes se pedian cuatro veces al dia -16
  // peticiones de las 25- para no enterarse de nada nuevo. Pidiendolas una vez
  // quedan 16 libres para lo que si cambia.
  let lentos: Quote[] = [];
  const tocaSeries = forzarLento || (diaSeries !== hoy && ahora >= proximoSeries);

  if (tocaSeries) {
    if (puedoGastarAlpha(SERIES_LENTAS)) {
      const r = await traerLento();
      lentos = r.quotes;
      for (const e of r.errors) errors.push(`petroleo/bonos · ${e}`);

      did.push('petroleo/bonos');
      markBlock('petroleo/bonos', r.quotes.length > 0, r.quotes.length, r.errors.join(' · '));

      // El dia solo se da por hecho si llegaron las cuatro. Si falto alguna,
      // se reintenta dentro de una hora: lo que protege la cuota es el
      // presupuesto, no resignarse.
      if (r.completo) diaSeries = hoy;
      else proximoSeries = ahora + REINTENTO_MS;
    } else if (ALPHA_API_KEY) {
      const msg = `cuota diaria agotada (${alphaUsage().used}/${ALPHA_DAILY_BUDGET})`;
      errors.push(`petroleo/bonos: ${msg}`);
      markBlock('petroleo/bonos', false, 0, msg);
    }
  }

  // --- noticias con sentimiento (Alpha Vantage): cada pocas horas ----------
  //
  // ESTE BLOQUE SE APAGA SOLO SI RESULTA SER DE PAGO. Alpha Vantage no dice en
  // su documentacion que NEWS_SENTIMENT sea premium; lo descubres cuando
  // contesta 200 con "This is a premium endpoint" dentro. Sin recordarlo, el
  // diario lo reintentaria cada hora para siempre, gastando cuota en una
  // respuesta que no va a cambiar.
  let animo: NewsItem[] = [];
  if (!blockDisabled('sentimiento') && (forzarLento || ahora >= proximoSentimiento)) {
    if (puedoGastarAlpha(1)) {
      did.push('sentimiento');
      try {
        animo = await traerSentimiento();
        markBlock('sentimiento', true, animo.length);
        proximoSentimiento = ahora + MARKET_SENTIMENT_HOURS * 3_600_000;
      } catch (e) {
        const msg = (e as Error).message;
        errors.push(`sentimiento: ${msg}`);
        markBlock('sentimiento', false, 0, msg);

        if (/premium|subscribe/i.test(msg)) {
          // No es un fallo pasajero: es que no esta en el plan. Se apaga.
          disableBlock('sentimiento', msg);
        } else {
          // Un fallo normal espera una hora, no el intervalo entero.
          proximoSentimiento = ahora + REINTENTO_MS;
        }
      }
    } else if (ALPHA_API_KEY) {
      const msg = `cuota diaria agotada (${alphaUsage().used}/${ALPHA_DAILY_BUDGET})`;
      errors.push(`sentimiento: ${msg}`);
      markBlock('sentimiento', false, 0, msg);
    }
  }

  const quotes = [...cotiz, ...lentos];
  saveQuotes(quotes);

  // El historico para la variacion a 5 dias nos lo hacemos nosotros.
  //
  // El endpoint de velas diarias de Finnhub salio del plan gratuito y pedir
  // diez series a Alpha Vantage se come su cuota diaria entera. Guardando el
  // ultimo precio visto de cada jornada, a la quinta sesion la columna sale
  // sola y no depende de ningun proveedor. Antes de eso sale "—", y eso es
  // honesto: no tenemos el dato.
  //
  // Jornada de CALENDARIO, no la de futuros: estas son acciones y su sesion
  // termina a las 16:00 de Nueva York, no a las 18:00.
  if (quotes.length > 0) saveDailyClose(quotes, calendarDate(Date.now()));

  saveEarnings(resultados);

  const titulares = [...noticias, ...animo];
  const nuevas = saveNews(titulares);

  // Las nuevas son las que acaban de entrar, no las mas recientes por fecha:
  // las noticias llegan desordenadas y por fecha se avisaria de las que ya
  // habias visto.
  const idsRecibidos = new Set(titulares.map((n) => n.id));
  const report = globalReport();
  const candidatas = report.news.filter((n) => idsRecibidos.has(n.id)).slice(0, nuevas);

  const alerts = alertsFor(report, candidatas, MARKET_MOVE_PCT);

  // "Actualizado" se mueve si llego ALGO, aunque otro bloque fallara: los
  // precios que acaban de entrar son de ahora mismo, y marcarlos de hace
  // horas porque el petroleo no contesto seria mentir en la direccion mala.
  markRefresh(quotes.length > 0 || nuevas > 0, errors.join(' · '));

  return {
    quotes: quotes.length,
    earnings: resultados.length,
    newsNew: nuevas,
    alerts,
    errors,
    did,
    fase: faseDeMercado(ahora),
    alpha: { used: alphaUsage().used, budget: ALPHA_DAILY_BUDGET },
  };
}

/**
 * El bucle. Temporizador recalculado en cada vuelta, no `setInterval`.
 *
 * Con un intervalo fijo el ritmo se decide una vez al arrancar y ya no cambia:
 * el diario que abriste el domingo seguiria pidiendo cada hora el lunes a las
 * diez de la mañana. Replanteando la espera despues de cada ciclo, la apertura
 * acelera sola y el cierre frena sola.
 */
export function startMarketRefresh(onDone?: (r: RefreshResult) => void): () => void {
  if (!FINNHUB_API_KEY && !ALPHA_API_KEY) {
    console.log('[mercado] sin claves configuradas: el contexto de mercado no se actualiza');
    return () => {};
  }

  let corriendo = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let vivo = true;

  const programar = () => {
    if (!vivo) return;

    const { fase, min } = minutosDeEspera();
    markSchedule(fase, Date.now() + min * 60_000);
    timer = setTimeout(() => void tick(), min * 60_000);
  };

  const tick = async () => {
    if (corriendo) return;
    corriendo = true;

    try {
      const r = await refreshGlobal();
      const partes = [
        `${r.quotes} cotizaciones`,
        `${r.newsNew} noticias nuevas`,
        r.did.includes('resultados') ? `${r.earnings} resultados` : null,
        `alpha ${r.alpha.used}/${r.alpha.budget}`,
        `mercado ${r.fase}`,
      ].filter(Boolean);

      const resumen = partes.join(', ');
      if (r.errors.length > 0) console.log(`[mercado] ${resumen} · FALLOS: ${r.errors.join(' · ')}`);
      else console.log(`[mercado] ${resumen}`);

      onDone?.(r);
    } catch (e) {
      console.log(`[mercado] fallo: ${(e as Error).message}`);
    } finally {
      corriendo = false;
      programar();
    }
  };

  void tick();

  return () => {
    vivo = false;
    if (timer !== null) clearTimeout(timer);
  };
}
