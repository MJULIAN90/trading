import {
  QQQ_WEIGHTS,
  QQQ_WEIGHTS_FECHA,
  YAHOO_REFRESH_MIN,
  YAHOO_SIMBOLOS,
  type GrupoYahoo,
} from '../config.js';
import { db } from '../db/index.js';

/**
 * Lo que la pestana Yahoo ensena: las dos fuentes, una al lado de la otra.
 *
 * No es un panel de cotizaciones. Un panel de cotizaciones ya lo hay. Esto
 * existe para contestar UNA pregunta que hasta ahora no se podia contestar:
 * ¿de las dos fuentes que tiene el diario, cual va mejor servida en cada
 * serie? Y para contestarla hacen falta tres cosas a la vez, no una:
 *
 *   el precio ..... que dice cada una
 *   la diferencia . cuanto se separan
 *   la EDAD ....... de cuando es cada numero
 *
 * La edad es la que suele decidir, y es la que nadie mira. Hoy el barril del
 * diario viene de Alpha Vantage una vez al dia porque su cuota son 25
 * peticiones; un numero exacto de hace nueve horas es peor que uno aproximado
 * de hace cinco minutos para alguien que opera intradia.
 */

export interface FilaYahoo {
  symbol: string;
  que: string;
  grupo: GrupoYahoo;
  /** Si lo que se compara son instrumentos distintos (ETF contra futuro). */
  proxy: boolean;

  /**
   * Peso dentro del QQQ, en %. Null si no se tiene apuntado.
   *
   * NO es un dato del proveedor y no se trata como tal: sale de `QQQ_WEIGHTS`,
   * que es una foto copiada a mano y que envejece sola. Viaja con su fecha
   * (`pesosFecha`) para que la pantalla pueda decir de cuando es. Un peso sin
   * fecha al lado de precios con sello horario se lee como si fuera medido.
   */
  peso: number | null;

  yahoo: {
    price: number | null;
    prevClose: number | null;
    cambioPct: number | null;
    currency: string;
    exchange: string;
    /** Minutos desde que se formo el dato en el mercado. Null si no lo dice. */
    edadMin: number | null;
    /** Minutos desde que lo pedimos nosotros. */
    pedidoHaceMin: number | null;
  } | null;

  /** Lo mismo, de la fuente que ya usaba el diario. Null si no hay con que comparar. */
  propio: {
    symbol: string;
    price: number | null;
    cambioPct: number | null;
    edadMin: number | null;
  } | null;

  /** Diferencia de Yahoo respecto a lo propio, en %. Null si falta alguno. */
  difPct: number | null;
}

export interface VistaYahoo {
  filas: FilaYahoo[];
  /** Cuando se refresco por ultima vez, de lo mas reciente que haya guardado. */
  ultimo: number | null;
  refrescoMin: number;
  /** Cuantas de las filas comparables se separan mas de un 1 %. */
  discrepan: number;
  /** De cuando es la foto de pesos. Null = no se sabe, y se dice. */
  pesosFecha: string | null;
}

const pct = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : Number((((a - b) / Math.abs(b)) * 100).toFixed(2));

const minutosDesde = (ts: number | null | undefined): number | null =>
  ts === null || ts === undefined ? null : Math.max(0, Math.round((Date.now() - ts) / 60_000));

export function vistaYahoo(): VistaYahoo {
  const target = db();

  const yahoo = new Map(
    (
      target
        .prepare('SELECT symbol, price, prev_close, currency, exchange, quote_ts, fetched_at FROM yahoo_quotes')
        .all() as Array<{
        symbol: string;
        price: number;
        prev_close: number | null;
        currency: string | null;
        exchange: string | null;
        quote_ts: number | null;
        fetched_at: number;
      }>
    ).map((r) => [r.symbol, r]),
  );

  // Lo que ya tiene el diario. Se lee entero de una vez: son unas decenas de
  // filas y preguntar una por simbolo seria quince consultas para nada.
  const propio = new Map(
    (
      target.prepare('SELECT symbol, price, prev_close, quote_ts FROM global_quotes').all() as Array<{
        symbol: string;
        price: number | null;
        prev_close: number | null;
        quote_ts: number | null;
      }>
    ).map((r) => [r.symbol, r]),
  );

  let ultimo: number | null = null;
  let discrepan = 0;

  const filas: FilaYahoo[] = YAHOO_SIMBOLOS.map((s) => {
    const y = yahoo.get(s.symbol);
    const p = s.compara ? propio.get(s.compara) : undefined;

    if (y && (ultimo === null || y.fetched_at > ultimo)) ultimo = y.fetched_at;

    const ladoYahoo = y
      ? {
          price: y.price,
          prevClose: y.prev_close,
          cambioPct: pct(y.price, y.prev_close),
          currency: y.currency ?? '',
          exchange: y.exchange ?? '',
          edadMin: minutosDesde(y.quote_ts),
          pedidoHaceMin: minutosDesde(y.fetched_at),
        }
      : null;

    const ladoPropio = p
      ? {
          symbol: s.compara,
          price: p.price,
          cambioPct: pct(p.price, p.prev_close),
          edadMin: minutosDesde(p.quote_ts),
        }
      : null;

    // En los pares proxy la diferencia de PRECIO no significa nada: un ETF y un
    // futuro del mismo subyacente cotizan a niveles distintos por construccion.
    // Se deja en null para que la pantalla no pueda pintarla como discrepancia.
    const difPct = s.proxy ? null : pct(ladoYahoo?.price ?? null, ladoPropio?.price ?? null);

    if (difPct !== null && Math.abs(difPct) > 1) discrepan++;

    return {
      symbol: s.symbol,
      que: s.que,
      grupo: s.grupo,
      proxy: s.proxy,
      // `?? null` y no `|| null`: un peso de 0 es un peso apuntado, no la
      // ausencia de uno, y con `||` se convertiria en "no se sabe".
      peso: QQQ_WEIGHTS[s.symbol] ?? null,
      yahoo: ladoYahoo,
      propio: ladoPropio,
      difPct,
    };
  });

  return { filas, ultimo, refrescoMin: YAHOO_REFRESH_MIN, discrepan, pesosFecha: QQQ_WEIGHTS_FECHA };
}
