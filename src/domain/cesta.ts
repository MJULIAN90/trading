import { QQQ_WEIGHTS } from '../config.js';
import { db } from '../db/index.js';

/**
 * La cesta: las diez empresas que mas pesan en el Nasdaq, como UNA linea.
 *
 * Para que sirve: ver si el MNQ se esta yendo por su cuenta o si sus pesos
 * pesados van con el. Cuando el precio rompe y la cesta no le sigue, el
 * rompimiento lo esta haciendo el futuro solo.
 *
 * -------------------------------------------------------------------------
 * POR QUE ES UN PORCENTAJE Y NO UN PRECIO
 * -------------------------------------------------------------------------
 * Las diez cotizan entre 200 y 900 dolares y el MNQ ronda los 28.800 puntos.
 * Un promedio de sus precios da unos 400 y no cabe en el grafico. Lo unico
 * comparable entre cosas de escalas distintas es CUANTO SE HAN MOVIDO, asi
 * que la cesta es un porcentaje: cuanto lleva subiendo o bajando el conjunto
 * desde su cierre anterior. Ese porcentaje luego se pinta sobre el grafico
 * aplicandolo al cierre anterior del MNQ.
 *
 * -------------------------------------------------------------------------
 * POR QUE PONDERADA Y NO UNA MEDIA A SECAS
 * -------------------------------------------------------------------------
 * NVDA pesa 8,3 en el QQQ y TSLA 2,8: un 1% de NVDA mueve el indice tres
 * veces mas. Medido contra el QQQ del 30 de octubre, la cesta ponderada dio
 * -3,14% con el QQQ en -3,47%. La media simple de ese mismo dia habria dado
 * -2,98%, mas lejos.
 *
 * -------------------------------------------------------------------------
 * UNA SOLA EMA, Y DA IGUAL EL ORDEN
 * -------------------------------------------------------------------------
 * No hay que elegir entre "la EMA de la cesta" y "la cesta de las diez EMAs":
 * son la MISMA linea. La EMA es un filtro lineal, asi que promediar y luego
 * suavizar da identico a suavizar y luego promediar. Comprobado
 * numericamente: la diferencia maxima entre las dos es de 5,7e-14, que es
 * ruido de coma flotante. Asi que se promedia primero, que es una serie en
 * vez de diez.
 */

/** Una muestra de la cesta: el porcentaje del conjunto en un instante. */
export interface PuntoCesta {
  /** Instante al que se atribuye la muestra. */
  ts: number;
  /** Cambio ponderado del conjunto, en porcentaje. */
  pct: number;
  /** Cuantas de las diez tenian dato en ese momento. */
  empresas: number;
  /** Peso del QQQ cubierto por esas empresas. */
  peso: number;
}

/**
 * Cuanto pesa cada empresa, normalizado a 1 sobre las que de verdad hay.
 *
 * Importa normalizar sobre las PRESENTES y no sobre el total del QQQ: las
 * diez cubren el 46,8% del indice, asi que dividir entre 100 daria un
 * porcentaje aplastado a la mitad y la linea no se parecería a nada.
 */
function pesoDe(symbol: string): number {
  return QQQ_WEIGHTS[symbol.toUpperCase()] ?? 0;
}

/**
 * La serie de la cesta, agregada al marco que se pida.
 *
 * `minutos` agrupa las muestras crudas. Se guardan cada 5 minutos y se mira a
 * 15, pero el marco es un parametro y no una constante a proposito: la
 * agregacion se decide AL LEER. Si mañana resulta que 15 no era el marco, se
 * cambia el numero; si se hubiera agregado al guardar, el detalle ya no
 * estaria.
 *
 * De cada grupo se toma la ULTIMA muestra de cada empresa, no el promedio del
 * grupo: lo que se quiere es el estado al cierre de ese tramo, igual que una
 * vela cierra con su ultimo precio y no con la media de los que paso.
 */
export function cesta(desde: number, hasta: number, minutos = 15): PuntoCesta[] {
  const simbolos = Object.keys(QQQ_WEIGHTS);
  if (simbolos.length === 0 || minutos < 1) return [];

  const ancho = minutos * 60_000;

  // El CAST a INTEGER del bucket NO es decorativo, y costo un fallo.
  //
  // Los numeros de JavaScript son todos coma flotante, asi que al enlazar
  // `@ancho` llega a SQLite como un real. Y `entero / real` en SQLite es una
  // division REAL: `quote_ts / 900000.0 * 900000.0` devuelve exactamente
  // `quote_ts`, cada muestra cae en su propio grupo y la agregacion no agrupa
  // nada. La linea sale igual de bonita, con tres veces mas puntos de los que
  // deberia y sin haber mirado el marco para nada.
  //
  // Lo caza `prueba-cesta.ts` contando cuantos puntos salen de tres muestras
  // dentro del mismo tramo.

  // El bucket se calcula en SQL y la ultima de cada grupo se saca con una
  // ventana: hacerlo en JavaScript obligaria a traerse todas las filas crudas
  // a memoria, y con un año de muestras cada cinco minutos son cientos de
  // miles por empresa.
  const filas = db()
    .prepare(
      `WITH marcadas AS (
         SELECT symbol,
                change_pct,
                CAST(quote_ts / @ancho AS INTEGER) * @ancho AS bucket,
                ROW_NUMBER() OVER (
                  PARTITION BY symbol, CAST(quote_ts / @ancho AS INTEGER) * @ancho
                  ORDER BY quote_ts DESC
                ) AS n
           FROM global_quotes_history
          WHERE quote_ts >= @desde AND quote_ts <= @hasta
            AND change_pct IS NOT NULL
       )
       SELECT symbol, change_pct, bucket FROM marcadas WHERE n = 1 ORDER BY bucket`,
    )
    .all({ ancho, desde, hasta }) as Array<{ symbol: string; change_pct: number; bucket: number }>;

  const grupos = new Map<number, Array<{ symbol: string; pct: number }>>();
  for (const f of filas) {
    if (pesoDe(f.symbol) <= 0) continue;
    const g = grupos.get(f.bucket);
    if (g) g.push({ symbol: f.symbol, pct: f.change_pct });
    else grupos.set(f.bucket, [{ symbol: f.symbol, pct: f.change_pct }]);
  }

  const out: PuntoCesta[] = [];
  for (const [bucket, xs] of [...grupos.entries()].sort((a, b) => a[0] - b[0])) {
    let peso = 0;
    let acc = 0;
    for (const x of xs) {
      const w = pesoDe(x.symbol);
      peso += w;
      acc += w * x.pct;
    }
    if (peso <= 0) continue;

    // El instante del punto es el FINAL del tramo, no el principio: a las
    // 10:15 lo que se sabe es lo que paso entre las 10:00 y las 10:15, y
    // fecharlo a las 10:00 adelantaria la informacion quince minutos. Esa es
    // la forma mas facil de que un estudio salga bien por mirar al futuro.
    out.push({ ts: bucket + ancho, pct: acc / peso, empresas: xs.length, peso });
  }

  return out;
}

/**
 * Media exponencial de una serie de numeros.
 *
 * Se siembra con el primer valor y no con cero: sembrando en cero la linea
 * tarda varios periodos en despegar y lo que se ve al principio es el
 * arranque del filtro, no el dato.
 */
export function ema(xs: number[], periodo: number): number[] {
  if (xs.length === 0 || periodo < 1) return [];

  const a = 2 / (periodo + 1);
  let y = xs[0]!;
  return xs.map((x, i) => (i === 0 ? (y = x) : (y = a * x + (1 - a) * y)));
}

/**
 * Cuanto retraso mete una EMA, en minutos de reloj.
 *
 * Existe porque un periodo NO significa lo mismo sobre marcos distintos, y es
 * el error que mas facil se comete al traer un numero de otro grafico. Su
 * EMA 21 sobre velas de un minuto retrasa 10 minutos; una EMA 21 sobre
 * muestras de 15 minutos retrasa 150, que son 21 de las 26 barras que tiene
 * una sesion de cotizacion. Eso ya no es un indicador intradia, es la media
 * de la sesion entera.
 *
 * El centro de masa de una EMA esta en (periodo - 1) / 2 barras.
 */
export function retrasoMinutos(periodo: number, minutosPorBarra: number): number {
  return ((periodo - 1) / 2) * minutosPorBarra;
}
