import {
  ALPHA_DAILY_BUDGET,
  COMPANY_NAMES,
  NEWS_MAX,
  NEWS_WINDOW_DAYS,
  QQQ_WEIGHTS,
} from '../config.js';
import { db } from '../db/index.js';
import { getEarningsSettings, horasMedidas, momentoDe, type HoraMedida } from './earnings.js';
import { marketOffsetAt } from './clock.js';
import { clasificar, type Topic } from './news-topic.js';

/**
 * Contexto de mercado: materias primas, bonos, indices, resultados y noticias.
 *
 * LA PIEZA NUEVA DEL DIARIO: es lo primero que sale a internet. Todo lo demas
 * lee la base de Quantower o ficheros que ya estan en el disco; el calendario
 * economico tampoco se descarga, se lee de `C:\\Quantower\\journal\\calendar`.
 * Eso significa que aqui hay dos modos de fallo que no existian:
 *
 *   1. El proveedor esta caido, cambia el formato o se acaba la cuota. Por eso
 *      nada de lo que llega sustituye a lo guardado: se escribe encima solo
 *      cuando la peticion fue bien. Una pantalla con datos de hace veinte
 *      minutos es util; una pantalla en blanco porque el proveedor se cayo, no.
 *   2. Los datos son de FUERA. No se mezclan nunca con tus operaciones ni con
 *      las velas: viven en sus propias tablas y ninguna metrica del diario los
 *      lee. Si manana se borra todo esto, ninguna cifra tuya se mueve.
 *
 * LA FORMA DE AQUI DENTRO ES MIA, NO DEL PROVEEDOR. El adaptador traduce lo que
 * devuelva cada servicio a estos tipos. Asi cambiar de proveedor es reescribir
 * un fichero y no toda la pantalla, que con APIs gratuitas que cambian de plan
 * cada pocos meses no es una precaucion teorica.
 */

export type QuoteKind = 'materia' | 'bono' | 'indice' | 'accion';

export interface Quote {
  /** Simbolo tal cual lo pide el proveedor. */
  symbol: string;
  /** Como se enseña en pantalla: "Brent", "EE.UU. 10 años". */
  label: string;
  kind: QuoteKind;
  price: number;
  /** Variacion del dia en porcentaje. null si el proveedor no la da. */
  changePct: number | null;
  /** Cuando lo LEIMOS nosotros. */
  ts: number;
  /**
   * El dia al que pertenece el dato, cuando el proveedor lo dice (YYYY-MM-DD).
   *
   * Solo lo traen las series DIARIAS de Alpha Vantage -petroleo y bonos-, que
   * se publican con retraso: el ultimo valor puede ser del martes pasado. Sin
   * este campo, el cierre se guardaba con la fecha del reloj y se fabricaba
   * una jornada cada vez que se refrescaba sin dato nuevo.
   *
   * Las cotizaciones de acciones lo dejan en null: son de hoy por definicion,
   * y su dia es la jornada de calendario.
   */
  day?: string | null;
  /**
   * Cuando COTIZO ese precio, segun el proveedor. null si no lo dice.
   *
   * Es otra cosa que `ts` y la diferencia importa: con el mercado cerrado,
   * `ts` dice "hace dos minutos" y `quoteTs` dice "ayer a las 16:00". Lo
   * segundo es lo que hay que enseñar.
   */
  quoteTs: number | null;
  /** Cierre de la jornada anterior, si el proveedor lo da. */
  prevClose: number | null;
}

/** Lo que se enseña en la tabla: la cotizacion mas lo que sabemos de ella. */
export interface Row extends Quote {
  /** Nombre de la empresa. Sale de un mapa propio, no del proveedor. */
  name: string;
  /** Peso en el QQQ, en porcentaje. null si no esta en la lista. */
  weight: number | null;
  /** Dia del ultimo cierre guardado (YYYY-MM-DD), o null si no hay ninguno. */
  ultimaJornada?: string | null;
  /** Variacion a 5 jornadas en porcentaje, de nuestro propio historico. */
  changePct5d: number | null;
  /**
   * Variacion a 1 y 5 jornadas en las UNIDADES DE LA SERIE, no en porcentaje.
   *
   * Para los bonos es lo unico que se puede leer: un 10 anios de 4,98 a 5,05
   * son +7 puntos basicos. El porcentaje de un porcentaje no dice nada.
   */
  change1d: number | null;
  change5d: number | null;
  /** Cuantas jornadas de cierre llevamos guardadas. Con menos de 6 no hay 5d. */
  dias: number;
}

export interface Earning {
  symbol: string;
  name: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Antes o despues del cierre, si se sabe. */
  when: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
}

export interface NewsItem {
  /** Identificador del proveedor. Es la clave: evita duplicar al refrescar. */
  id: string;
  ts: number;
  headline: string;
  source: string | null;
  url: string | null;
  summary: string | null;
  /** Simbolos mencionados, separados por comas. */
  symbols: string | null;
  /**
   * De -1 (muy negativo) a +1 (muy positivo). null = nadie lo ha puntuado.
   *
   * null NO es neutro, y la diferencia importa: Finnhub no puntua nada, asi
   * que pintar sus titulares como "neutros" seria inventarse un dato.
   */
  sentiment: number | null;
  /** Cuanto habla la noticia de tus simbolos, de 0 a 1. null si no se sabe. */
  relevance: number | null;
  /**
   * De que va: una de tus empresas, el terreno de juego, u otra cosa.
   *
   * NO se guarda en la base, se calcula al leer. Asi, el dia que afines la
   * lista de palabras, el cambio se nota en todo el historico sin volver a
   * pedir nada ni migrar nada.
   */
  topic?: Topic;
}

// ---------------------------------------------------------------- guardado

export function saveQuotes(rows: Quote[]): void {
  if (rows.length === 0) return;

  const stmt = db().prepare(
    `INSERT INTO global_quotes (symbol, label, kind, price, change_pct, ts, quote_ts, prev_close)
     VALUES (@symbol, @label, @kind, @price, @changePct, @ts, @quoteTs, @prevClose)
     ON CONFLICT (symbol) DO UPDATE SET
       label = excluded.label, kind = excluded.kind, price = excluded.price,
       change_pct = excluded.change_pct, ts = excluded.ts,
       quote_ts = excluded.quote_ts, prev_close = excluded.prev_close`,
  );

  db().transaction((xs: Quote[]) => { for (const q of xs) stmt.run(q); })(rows);

  saveQuotesHistory(rows);
}

/**
 * Apunta cada cotizacion en el historico, sin pisar la anterior.
 *
 * Va pegado a `saveQuotes` y no en una ruta aparte a proposito: si fuera un
 * paso suelto que hay que acordarse de llamar, el dia que se añada otra
 * fuente de cotizaciones se olvidaria, y lo que se pierde no se recupera.
 *
 * Solo las ACCIONES. El petroleo, los bonos y el QQQ se refrescan por el
 * mismo camino pero no entran en el indice ponderado, y guardarlos aqui seria
 * llenar la tabla con filas que nadie va a leer. Si algun dia hacen falta, se
 * quita este filtro y se empieza a guardar desde ese dia — igual que esto.
 *
 * `quote_ts` puede no venir. Cuando falta se usa `ts`, porque la alternativa
 * -descartar la fila- pierde el dato, y una marca de tiempo aproximada sirve
 * para lo que se va a hacer con ella.
 */
export function saveQuotesHistory(rows: Quote[]): void {
  const acciones = rows.filter((q) => q.kind === 'accion');
  if (acciones.length === 0) return;

  const stmt = db().prepare(
    `INSERT INTO global_quotes_history (symbol, quote_ts, ts, price, change_pct)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (symbol, quote_ts) DO UPDATE SET
       price = excluded.price,
       change_pct = excluded.change_pct,
       ts = excluded.ts`,
  );

  db().transaction((xs: Quote[]) => {
    for (const q of xs) stmt.run(q.symbol, q.quoteTs ?? q.ts, q.ts, q.price, q.changePct ?? null);
  })(acciones);
}

/**
 * Guarda el ultimo precio visto de cada simbolo como cierre de la jornada.
 *
 * Se sobreescribe en cada refresco, asi que al acabar el dia la fila tiene el
 * ultimo precio de esa jornada. No es el cierre oficial -es el ultimo que
 * vimos- y para una variacion a cinco dias da igual.
 *
 * CADA UNO EN SU DIA. El `day` que se pasa es el de las acciones, que cotizan
 * hoy por definicion. Las series diarias de Alpha Vantage -petroleo y bonos-
 * traen el suyo en `q.day` y manda ese, porque se publican con retraso.
 *
 * Sin esto se fabricaban jornadas: si Alpha no traia nada nuevo, el mismo
 * valor se guardaba otra vez con la fecha de hoy. El WTI acabo con el mismo
 * 103,37 como cierre del 28, 30, 31, 1, 2 y 3 de noviembre — seis jornadas
 * que nunca ocurrieron, una variacion del dia de 0,00 % calculada contra si
 * mismo, y un "9 jornadas" de historico que sonaba a que habia datos.
 */
export function saveDailyClose(rows: Quote[], day: string): void {
  if (rows.length === 0) return;

  const stmt = db().prepare(
    `INSERT INTO global_daily_close (symbol, day, close) VALUES (?, ?, ?)
     ON CONFLICT (symbol, day) DO UPDATE SET close = excluded.close`,
  );

  db().transaction((xs: Quote[]) => {
    for (const q of xs) stmt.run(q.symbol, q.day ?? day, q.price);
  })(rows);
}

/**
 * El cierre guardado hace `atras` jornadas, o null si no llega el historico.
 *
 * Devuelve tambien SU DIA, y eso decide si la comparacion vale.
 */
function cierreAtras(symbol: string, atras: number): { close: number; day: string } | null {
  const row = db()
    .prepare(
      `SELECT close, day FROM global_daily_close
        WHERE symbol = ? ORDER BY day DESC LIMIT 1 OFFSET ?`,
    )
    .get(symbol, atras) as { close: number; day: string } | undefined;
  return row ?? null;
}

/**
 * Dias de calendario entre dos fechas YYYY-MM-DD.
 */
function diasEntre(a: string, b: string): number {
  return Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86_400_000;
}

/**
 * Hasta que distancia en dias de calendario una comparacion sigue siendo lo
 * que dice la cabecera de la columna.
 *
 * Cuatro dias y no uno: la jornada anterior a un lunes es el viernes, que son
 * tres dias de calendario, y con un festivo por medio cuatro. Mas alla de ahi
 * la cuenta ya no es "ayer" ni "hace cinco jornadas" en ningun sentido util.
 *
 * Importa porque sin este corte el WTI enseniaba un "1d" de -4,52 que en
 * realidad iba del 25 al 28 de octubre: la serie llevaba seis dias sin dato
 * nuevo, y la unica comparacion posible era contra un cierre de tres dias
 * antes. Un numero con la etiqueta equivocada es peor que un hueco.
 */
const MARGEN_JORNADA_DIAS = 4;

function cambio5d(symbol: string, price: number): number | null {
  const antes = cierreAtras(symbol, 5);
  if (antes === null || antes.close === 0) return null;
  return Number(((price / antes.close - 1) * 100).toFixed(2));
}

/**
 * Variacion ABSOLUTA, en las unidades de la propia serie.
 *
 * Hace falta porque un bono NO se lee en porcentaje. El 10 anios pasando de
 * 4,98 a 5,05 es "+7 puntos basicos", que es como lo dice todo el mundo; el
 * "+1,4%" que saldria de dividir es un porcentaje DE un porcentaje y no
 * significa nada para nadie. El petroleo si se lee en porcentaje. Por eso se
 * calculan las dos y cada tipo de fila enseña la suya.
 */
function cambioAbs(symbol: string, price: number, atras: number): number | null {
  const antes = cierreAtras(symbol, atras);
  if (antes === null) return null;

  // La referencia tiene que estar donde dice la columna. Si la serie lleva
  // dias sin dato nuevo, el cierre "de ayer" es de la semana pasada y la
  // resta no es una variacion diaria: mejor un hueco.
  const hoy = cierreAtras(symbol, 0);
  if (hoy !== null && diasEntre(hoy.day, antes.day) > atras + MARGEN_JORNADA_DIAS) return null;

  return Number((price - antes.close).toFixed(4));
}

/** Cuantas jornadas de cierre llevamos guardadas de ese simbolo. */
function jornadasGuardadas(symbol: string): number {
  const row = db()
    .prepare('SELECT COUNT(*) AS n FROM global_daily_close WHERE symbol = ?')
    .get(symbol) as { n: number };
  return row.n;
}

/**
 * El dia del ultimo cierre guardado, o null si no hay ninguno.
 *
 * Hace falta porque un numero quieto no dice por que esta quieto. El WTI
 * estuvo seis dias enseniando 103,37 con una variacion de 0,00 %, y las dos
 * lecturas posibles -"no se ha movido" y "no tenemos dato nuevo"- se pintaban
 * exactamente igual. Con la fecha delante, la segunda se ve sola.
 */
function ultimaJornada(symbol: string): string | null {
  const row = db()
    .prepare('SELECT day FROM global_daily_close WHERE symbol = ? ORDER BY day DESC LIMIT 1')
    .get(symbol) as { day: string } | undefined;
  return row?.day ?? null;
}

/**
 * Guarda el calendario de resultados y RETIRA lo que el proveedor ya no dice.
 *
 * El upsert solo aniade. La clave es (simbolo, fecha), asi que cuando una
 * empresa mueve su fecha de presentacion entra una fila nueva y la vieja se
 * queda: NVDA acabo con el 17 y el 25 de noviembre a la vez, con la misma
 * estimacion. Como la agenda ordena por cercania, el aviso habria saltado
 * ocho dias antes de tiempo, y ademas para la que mas pesa del indice.
 *
 * Asi que despues de guardar se limpia el FUTURO: de cada simbolo que el
 * proveedor ha contestado, se borran las fechas futuras que ya no estan en su
 * respuesta. La foto de lo que viene pasa a ser la suya, no la acumulacion de
 * todas las suyas.
 *
 * Tres cuidados, y los tres importan:
 *
 *   - Solo el FUTURO. Las filas pasadas llevan lo presentado, que es el unico
 *     dato de esta tabla que no se puede volver a pedir.
 *   - Solo los simbolos que han CONTESTADO. Si una peticion falla y vuelve
 *     vacia, ese simbolo no aparece en `rows` y no se toca nada suyo. Borrar
 *     por una respuesta vacia seria dejar sin aviso a quien presenta maniana.
 *   - La fecha de corte se pasa como argumento y no se saca de `date('now')`,
 *     para que la prueba pueda situarse en un dia concreto.
 */
export function saveEarnings(rows: Earning[], hoy = new Date().toISOString().slice(0, 10)): void {
  if (rows.length === 0) return;

  const stmt = db().prepare(
    `INSERT INTO global_earnings (symbol, name, date, when_, eps_estimate, eps_actual,
                                  revenue_estimate, revenue_actual)
     VALUES (@symbol, @name, @date, @when, @epsEstimate, @epsActual,
             @revenueEstimate, @revenueActual)
     ON CONFLICT (symbol, date) DO UPDATE SET
       name = excluded.name, when_ = excluded.when_,
       eps_estimate = excluded.eps_estimate,
       revenue_estimate = excluded.revenue_estimate,
       -- Lo PRESENTADO no se pisa con un null, igual que en el calendario
       -- economico. La estimacion se revisa y debe actualizarse; el resultado
       -- ya no cambia, y si el proveedor deja de mandarlo un dia, perderlo
       -- seria tirar el unico dato que no se puede volver a calcular.
       eps_actual = COALESCE(excluded.eps_actual, global_earnings.eps_actual),
       revenue_actual = COALESCE(excluded.revenue_actual, global_earnings.revenue_actual)`,
  );

  const borrar = db().prepare(
    `DELETE FROM global_earnings
      WHERE symbol = ? AND date > ? AND date NOT IN (SELECT value FROM json_each(?))`,
  );

  db().transaction((xs: Earning[]) => {
    for (const e of xs) stmt.run(e);

    const porSimbolo = new Map<string, string[]>();
    for (const e of xs) {
      const f = porSimbolo.get(e.symbol);
      if (f) f.push(e.date);
      else porSimbolo.set(e.symbol, [e.date]);
    }

    for (const [symbol, fechas] of porSimbolo) borrar.run(symbol, hoy, JSON.stringify(fechas));
  })(rows);
}

/** @returns cuantas noticias eran NUEVAS. Es lo que decide si suena la alerta. */
export function saveNews(rows: NewsItem[]): number {
  if (rows.length === 0) return 0;

  // INSERT OR IGNORE y contar el cambio real: `changes` devuelve 1 solo cuando
  // la fila entro de verdad. Comparar contra un "ultimo visto" por fecha fallaria
  // con noticias que llegan desordenadas, que es lo normal.
  const stmt = db().prepare(
    `INSERT INTO global_news (id, ts, headline, source, url, summary, symbols, sentiment, relevance)
     VALUES (@id, @ts, @headline, @source, @url, @summary, @symbols, @sentiment, @relevance)
     ON CONFLICT (id) DO UPDATE SET
       -- Una noticia ya guardada no se reescribe, salvo para ANADIRLE lo que no
       -- tenia: la misma noticia puede llegar primero por Finnhub sin puntuar y
       -- despues por Alpha Vantage con sentimiento. COALESCE deja lo que ya
       -- habia y solo rellena los huecos, y como no cuenta como fila nueva,
       -- tampoco vuelve a sonar la alerta.
       sentiment = COALESCE(global_news.sentiment, excluded.sentiment),
       relevance = COALESCE(global_news.relevance, excluded.relevance),
       symbols   = COALESCE(global_news.symbols, excluded.symbols)`,
  );

  let nuevas = 0;
  db().transaction((xs: NewsItem[]) => {
    for (const n of xs) {
      // `changes` vale 1 tanto al insertar como al actualizar, asi que no sirve
      // para contar novedades con un UPSERT. Se pregunta antes si existe.
      const yaEsta = db().prepare('SELECT 1 FROM global_news WHERE id = ?').get(n.id) !== undefined;
      stmt.run(n);
      if (!yaEsta) nuevas += 1;
    }
  })(rows);

  return nuevas;
}

// ------------------------------------------------- cuota de Alpha Vantage

const KEY_ALPHA_DAY = 'alpha_day';
const KEY_ALPHA_USED = 'alpha_used';

export interface AlphaUsage {
  /** Dia UTC al que corresponde la cuenta. */
  day: string;
  used: number;
}

/**
 * Peticiones gastadas hoy. Se reinicia solo al cambiar de dia UTC, que es
 * cuando Alpha Vantage reinicia la suya.
 */
export function alphaUsage(): AlphaUsage {
  const hoy = new Date().toISOString().slice(0, 10);
  if (metaValue(KEY_ALPHA_DAY) !== hoy) return { day: hoy, used: 0 };
  return { day: hoy, used: Number(metaValue(KEY_ALPHA_USED) ?? 0) };
}

/** Apunta `n` peticiones gastadas. Se llama ANTES de pedir, no despues: una
 *  peticion que falla por cuota agotada tambien se la cobraron. */
export function alphaSpend(n: number): void {
  const { day, used } = alphaUsage();
  const meta = db().prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  meta.run(KEY_ALPHA_DAY, day);
  meta.run(KEY_ALPHA_USED, String(used + n));
}

// ----------------------------------------------------------------- lectura

export interface GlobalReport {
  /** Cotizaciones ya enriquecidas: nombre, peso en el QQQ y variacion a 5 dias. */
  quotes: Row[];
  /**
   * `at` y `hhmm` son la hora de CONVENCION (amc/bmo pasados a reloj de Nueva
   * York), no un dato publicado. Van aqui para que la tabla de acciones diga
   * exactamente la misma hora que la franja de alarmas.
   */
  earnings: Array<
    Earning & { daysTo: number; at: number | null; hhmm: string | null; medido: HoraMedida | null }
  >;
  news: NewsItem[];
  /** Cuando termino bien el ultimo refresco. null si nunca. */
  updatedAt: number | null;
  /** Que fallo en el ultimo intento, si fallo. */
  error: string | null;
  /** Cuanta cuota diaria de Alpha Vantage llevamos gastada. */
  alpha: AlphaUsage & { budget: number };
  /** En que fase esta el mercado y cuando toca el siguiente refresco. */
  phase: string | null;
  nextAt: number | null;
  /** Cuantos dias de titulares trae `news`. La pantalla lo dice en voz alta. */
  newsWindowDays: number;
  /** Como le fue a cada fuente por separado. */
  blocks: BlockState[];
}

const KEY_OK = 'global_updated_at';
const KEY_ERR = 'global_error';
const KEY_PHASE = 'global_phase';
const KEY_NEXT = 'global_next_at';

/**
 * Como fue el ultimo ciclo. Dos cosas SEPARADAS, y antes estaban juntas.
 *
 * `llegoAlgo` mueve la hora de "actualizado"; `error` cuenta que fallo. Antes
 * un solo booleano hacia las dos cosas, asi que si fallaba un bloque de cuatro
 * la pantalla seguia diciendo "actualizado" de hace horas aunque los precios
 * acabaran de llegar frescos, y el aviso daba a entender que nada servia.
 */
export function markRefresh(llegoAlgo: boolean, error = ''): void {
  const meta = db().prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );

  if (llegoAlgo) meta.run(KEY_OK, String(Date.now()));
  meta.run(KEY_ERR, error);
}

// ------------------------------------------------- estado de cada fuente

export interface BlockState {
  name: string;
  /** Cuando trajo datos por ultima vez, y cuantos. */
  okAt: number | null;
  rows: number | null;
  /** Cuando fallo por ultima vez, y con que mensaje. */
  failAt: number | null;
  error: string | null;
  /**
   * La fuente esta APAGADA porque el proveedor no la da en el plan gratuito.
   * No es un fallo que se vaya a arreglar solo, asi que no avisa ni se
   * reintenta: se dice y punto.
   */
  disabled?: boolean;
  /**
   * Si lo que tenemos de esta fuente ya es VIEJO.
   *
   * Es lo unico que merece un aviso en pantalla. Un fallo suelto no: la red
   * se cae treinta segundos, el ciclo siguiente lo arregla y nadie tiene que
   * enterarse. Lo que importa es que lleve demasiado sin traer nada.
   */
  stale: boolean;
}

/**
 * Cuanto puede estar cada fuente sin traer datos antes de que sea un problema,
 * en horas. Salen de su propia cadencia, no de un numero redondo: las
 * cotizaciones entran cada pocos minutos y una hora sin ellas ya es raro; el
 * petroleo se pide una vez al dia, asi que hasta 36 horas es normal.
 */
const CADUCA_HORAS: Record<string, number> = {
  cotizaciones: 1,
  noticias: 3,
  resultados: 24,
  'petroleo/bonos': 36,
  sentimiento: 12,
};

/**
 * Apunta como le fue a una fuente.
 *
 * ACIERTO Y FALLO NO SON EXCLUYENTES, y darlo por hecho costo una comprobacion
 * en rojo: el bloque de petroleo y bonos son cuatro series, y el dia que
 * entran tres y falla una, el bloque "fue bien" -trajo datos- y a la vez tiene
 * un fallo que hay que poder leer. Si el acierto borrara el fallo, esa serie
 * caida no aparece en ninguna parte.
 *
 * Por eso se guardan las dos marcas por separado. El error solo se limpia
 * cuando un ciclo va bien SIN ningun fallo.
 */
export function markBlock(name: string, ok: boolean, rows: number, error?: string): void {
  const ahora = Date.now();
  const d = db();

  d.prepare('INSERT INTO global_blocks (name) VALUES (?) ON CONFLICT (name) DO NOTHING').run(name);

  if (ok) d.prepare('UPDATE global_blocks SET ok_at = ?, rows = ? WHERE name = ?').run(ahora, rows, name);

  if (error) d.prepare('UPDATE global_blocks SET fail_at = ?, error = ? WHERE name = ?').run(ahora, error, name);
  else if (ok) d.prepare('UPDATE global_blocks SET error = NULL WHERE name = ?').run(name);
}

/**
 * Fuentes apagadas porque resultaron ser de pago.
 *
 * Alpha Vantage no documenta que NEWS_SENTIMENT sea premium: lo descubres
 * cuando contesta 200 con "This is a premium endpoint" dentro. Si eso no se
 * recuerda, el diario lo reintenta cada tres horas para siempre, gastando
 * cuota en una respuesta que nunca va a cambiar y dejando una fila en rojo
 * que no se puede arreglar.
 *
 * Se guarda en la base y no en memoria a proposito: reiniciar no deberia
 * volver a aprenderlo. Para reactivarla -si algun dia pagas el plan- basta
 * con borrar la fila:
 *   DELETE FROM meta WHERE key = 'bloque_apagado_sentimiento';
 */
const claveApagado = (name: string) => `bloque_apagado_${name}`;

export function blockDisabled(name: string): boolean {
  return metaValue(claveApagado(name)) !== null;
}

export function disableBlock(name: string, motivo: string): void {
  db()
    .prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    )
    .run(claveApagado(name), motivo.slice(0, 200));
}

export function blockStates(): BlockState[] {
  const filas = db()
    .prepare(
      `SELECT name, ok_at AS okAt, rows, fail_at AS failAt, error FROM global_blocks`,
    )
    .all() as Array<Omit<BlockState, 'stale'>>;

  const ahora = Date.now();

  // Se enseñan TODAS las fuentes, tambien las que nunca han contestado: una
  // fila que falta es justo la que hay que ver.
  const todas = Object.keys(CADUCA_HORAS);
  const porNombre = new Map(filas.map((f) => [f.name, f]));

  return todas.map((name) => {
    const f = porNombre.get(name);
    const okAt = f?.okAt ?? null;
    const limite = (CADUCA_HORAS[name] ?? 24) * 3_600_000;
    const apagada = blockDisabled(name);

    return {
      name,
      okAt,
      rows: f?.rows ?? null,
      failAt: f?.failAt ?? null,
      error: f?.error ?? null,
      disabled: apagada,
      // Nunca contesto, o su ultimo acierto se paso de viejo. Una fuente
      // apagada NUNCA esta vieja: no se espera nada de ella.
      stale: !apagada && (okAt === null || ahora - okAt > limite),
    };
  });
}

/** En que fase esta el mercado y cuando toca el siguiente ciclo. Lo guarda el
 *  bucle del servidor para que la pantalla pueda enseñarlo sin adivinarlo. */
export function markSchedule(phase: string, nextAt: number): void {
  const meta = db().prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  meta.run(KEY_PHASE, phase);
  meta.run(KEY_NEXT, String(nextAt));
}

function metaValue(key: string): string | null {
  const row = db().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/** Dias desde hoy hasta la fecha, en jornadas de calendario. Negativo = ya paso. */
function daysTo(date: string): number {
  const hoy = new Date();
  const base = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return 0;
  return Math.round((Date.UTC(y, m - 1, d) - base) / 86_400_000);
}

export function globalReport(newsLimit = NEWS_MAX): GlobalReport {
  const crudas = db()
    .prepare(
      `SELECT symbol, label, kind, price, change_pct AS changePct, ts,
              quote_ts AS quoteTs, prev_close AS prevClose
         FROM global_quotes ORDER BY kind, label`,
    )
    .all() as Quote[];

  // El nombre y el peso se pegan AQUI y no al guardar: son datos nuestros, no
  // del proveedor, y asi cambiar un peso en el .env se nota en el siguiente
  // refresco de la pantalla sin volver a pedir nada ni tocar la base.
  const quotes: Row[] = crudas.map((q) => ({
    ...q,
    name: COMPANY_NAMES[q.symbol] ?? q.label,
    weight: QQQ_WEIGHTS[q.symbol] ?? null,
    changePct5d: cambio5d(q.symbol, q.price),
    change1d: cambioAbs(q.symbol, q.price, 1),
    change5d: cambioAbs(q.symbol, q.price, 5),
    dias: jornadasGuardadas(q.symbol),
    ultimaJornada: ultimaJornada(q.symbol),
  }));

  // Los resultados de los ultimos dias siguen interesando: el movimiento de
  // ayer se explica con lo que presentaron anteanoche.
  const ajustesHora = getEarningsSettings();
  const horas = horasMedidas();

  const earnings = (
    db()
      .prepare(
        `SELECT symbol, name, date, when_ AS "when", eps_estimate AS epsEstimate,
                eps_actual AS epsActual, revenue_estimate AS revenueEstimate,
                revenue_actual AS revenueActual
           FROM global_earnings
          -- Hasta 90 dias: los resultados son trimestrales, asi que con una
          -- ventana de 30 la columna "Prox. resultados" sale vacia la mayor
          -- parte del trimestre y parece que el dato no se trae.
          WHERE date >= date('now', '-7 day') AND date <= date('now', '+90 day')
          ORDER BY date`,
      )
      .all() as Earning[]
  ).map((e) => {
    // La misma hora de CONVENCION que usa la franja de arriba, calculada en el
    // mismo sitio. Si cada pantalla se la inventara por su cuenta, la tabla y
    // la alarma podrian decir horas distintas del mismo informe.
    const at = momentoDe(e.date, e.when, ajustesHora, e.symbol, horas);
    const ny = at === null ? null : new Date(at + marketOffsetAt(at) * 3_600_000);
    return {
      ...e,
      daysTo: daysTo(e.date),
      at,
      medido: (e.when ?? '').toLowerCase().includes('bmo') ? null : (horas[e.symbol] ?? null),
      hhmm:
        ny === null
          ? null
          : `${String(ny.getUTCHours()).padStart(2, '0')}:${String(ny.getUTCMinutes()).padStart(2, '0')}`,
    };
  });

  // VENTANA DE DIAS, no solo un tope de filas. Con cien titulares diarios, un
  // LIMIT de 300 a secas seria "los ultimos tres dias" hoy y "el ultimo dia y
  // medio" el dia que el proveedor hable mas. La ventana la fija el reloj, y
  // el LIMIT queda como red de seguridad.
  //
  // Lo que cae fuera sigue en la base: deja de enseñarse, no se borra.
  const desde = Date.now() - NEWS_WINDOW_DAYS * 86_400_000;

  const titulares = db()
    .prepare(
      `SELECT id, ts, headline, source, url, summary, symbols, sentiment, relevance
         FROM global_news WHERE ts >= ? ORDER BY ts DESC LIMIT ?`,
    )
    .all(desde, newsLimit) as NewsItem[];

  // Se clasifica al leer, no al guardar. El reconocimiento de simbolos tambien
  // mejora lo que vino del proveedor: Finnhub solo etiqueta algunas, y un
  // titular que dice "Nvidia" sin etiqueta sigue siendo de NVDA.
  const news: NewsItem[] = titulares.map((n) => {
    const c = clasificar(n.headline, n.summary, n.symbols);
    return { ...n, topic: c.topic, symbols: c.symbols ?? n.symbols };
  });

  const err = metaValue(KEY_ERR);
  const at = metaValue(KEY_OK);
  const next = metaValue(KEY_NEXT);

  return {
    quotes,
    earnings,
    news,
    updatedAt: at ? Number(at) : null,
    error: err ? err : null,
    alpha: { ...alphaUsage(), budget: ALPHA_DAILY_BUDGET },
    phase: metaValue(KEY_PHASE),
    nextAt: next ? Number(next) : null,
    newsWindowDays: NEWS_WINDOW_DAYS,
    blocks: blockStates(),
  };
}

// ------------------------------------------------------------------ alertas

export type AlertKind = 'noticia' | 'movimiento' | 'resultados';

export interface Alert {
  kind: AlertKind;
  text: string;
  /** Para no repetir la misma alerta en cada refresco. */
  key: string;
}

/**
 * Que merece un sonido. Tres reglas y ninguna es "se actualizo".
 *
 * Una alerta cada diez minutos se silencia en dos dias, y entonces no avisa de
 * nada el dia que importa. Estas tres solo saltan cuando el terreno cambia:
 *
 *   NOTICIA     una noticia nueva que menciona uno de tus simbolos.
 *   MOVIMIENTO  una cotizacion que se mueve mas del umbral en el dia.
 *   RESULTADOS  una empresa de la lista presenta hoy o maniana.
 */
export function alertsFor(
  report: GlobalReport,
  noticiasNuevas: NewsItem[],
  movePct: number,
): Alert[] {
  const out: Alert[] = [];

  for (const n of noticiasNuevas) {
    if (!n.symbols) continue;

    // El sentimiento se cuela en el texto solo cuando es claro. Un -0,05 no
    // dice nada y poner "neutro" en cada aviso es ruido.
    const tono =
      n.sentiment === null ? ''
        : n.sentiment <= -0.2 ? ' [negativa]'
        : n.sentiment >= 0.2 ? ' [positiva]'
        : '';

    out.push({
      kind: 'noticia',
      text: `${n.symbols}${tono}: ${n.headline}`,
      key: `noticia:${n.id}`,
    });
  }

  for (const q of report.quotes) {
    if (q.changePct === null || Math.abs(q.changePct) < movePct) continue;
    out.push({
      kind: 'movimiento',
      text: `${q.label} ${q.changePct > 0 ? '+' : ''}${q.changePct.toFixed(2)}% en el dia`,
      // La clave lleva el DIA y el signo del tramo, no el valor: si no, el
      // mismo movimiento sonaria otra vez en cada refresco por variar un
      // decimal.
      key: `mov:${q.symbol}:${new Date().toISOString().slice(0, 10)}:${Math.trunc(q.changePct / movePct)}`,
    });
  }

  for (const e of report.earnings) {
    if (e.daysTo < 0 || e.daysTo > 1) continue;
    out.push({
      kind: 'resultados',
      text: `${e.symbol} presenta resultados ${e.daysTo === 0 ? 'hoy' : 'maniana'}`,
      key: `res:${e.symbol}:${e.date}`,
    });
  }

  return out;
}
