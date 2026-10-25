import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Toda la configuracion sale de variables de entorno con valores por defecto que
 * funcionan en una instalacion normal de Quantower en Windows. La idea es que el
 * proyecto arranque sin tocar nada y solo haya que configurar si algo esta en
 * otra ruta.
 */

/**
 * Lee el fichero `.env` de la raiz del proyecto, si existe.
 *
 * Sin esto la configuracion solo se podia pasar como variables de entorno
 * sueltas por linea de comandos: funciona en la maquina donde se escribieron y
 * se pierde al cerrar la consola, que es justo lo que impide montar el proyecto
 * en otro ordenador. Se hace a mano y no con una libreria porque son quince
 * lineas y una dependencia menos que instalar.
 *
 * Lo que ya venga en el entorno MANDA sobre el fichero, para poder levantar una
 * segunda instancia en otro puerto sin tocar el `.env`.
 */
function loadDotEnv(): void {
  const file = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), '.env');
  if (!existsSync(file)) return;

  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Comillas opcionales, para rutas de Windows con espacios.
    const quoted =
      value.length > 1 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);

    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const QUANTOWER_ROOT = process.env.QUANTOWER_ROOT ?? 'C:\\Quantower';

/** Donde guardamos NUESTRA base de datos. Nunca escribimos dentro de Quantower. */
export const JOURNAL_DB = resolve(process.env.JOURNAL_DB ?? './data/journal.db');

/**
 * Carpeta donde los indicadores escriben el contexto: un fichero por dia,
 * context-YYYYMMDD.jsonl, con una linea JSON por evento.
 */
export const CONTEXT_DIR = resolve(process.env.CONTEXT_DIR ?? join(QUANTOWER_ROOT, 'journal'));

export const PORT = Number(process.env.PORT ?? 4321);

/**
 * Carpeta donde dejas los ficheros del calendario economico (.ics o .csv).
 * Quantower no tiene calendario economico, asi que los eventos entran por aqui.
 */
export const CALENDAR_DIR = resolve(
  process.env.CALENDAR_DIR ?? join(QUANTOWER_ROOT, 'journal', 'calendar'),
);

/**
 * Zona en la que vienen escritas las horas del calendario importado, como
 * desfase respecto a UTC.
 *
 * Importa mas de lo que parece: casi todas las webs de calendario exportan en
 * hora de Nueva York o en la local del navegador, y un CSV no lleva la zona
 * dentro. Leer "08:30" como UTC cuando era hora de Nueva York coloca el dato
 * cuatro horas antes, con lo que la ventana de silencio se abre cuando ya no
 * hace falta y no se abre cuando toca. Por defecto se asume la misma hora de
 * mercado que usa el resto del diario, que es lo que se ve en el grafico.
 */
export const CALENDAR_TZ_OFFSET_HOURS = Number(
  process.env.CALENDAR_TZ_OFFSET_HOURS ?? process.env.MARKET_UTC_OFFSET_HOURS ?? -4,
);

/**
 * Ventana de silencio alrededor de un dato de alto impacto, en minutos.
 *
 * No es simetrica a proposito: ANTES del dato el libro se vacia y los
 * diferenciales se abren, DESPUES llega el movimiento. Son dos problemas
 * distintos y no duran lo mismo.
 */
/**
 * Dias de JSON crudo que se conservan en `context_snapshots`. 0 = todo.
 *
 * Viene APAGADO a proposito. El crudo es la unica fuente desde la que se puede
 * reconstruir la tabla `bars` si manana se anade una columna, asi que borrarlo
 * es la unica operacion irreversible del diario y no la debe tomar el programa
 * por su cuenta. Medido sobre datos reales: el crudo ocupa seis veces mas que
 * su version derivada, asi que a partir de unos meses compensa activarlo.
 */
/**
 * HORA A LA QUE CAMBIA LA JORNADA, en hora de mercado (Nueva York).
 *
 * No es medianoche, y la diferencia no es cosmetica.
 *
 * La sesion de futuros del CME abre a las 18:00 ET y corre hasta las 17:00 ET
 * del dia siguiente: lo que operas el lunes a las 22:00 pertenece a la jornada
 * del MARTES para el mercado y para la mesa de fondeo, que es quien cuenta tu
 * limite de perdida diaria.
 *
 * Con el corte a medianoche que habia antes, sobre 248 operaciones reales:
 *   - 80 (el 32%) caian en la jornada equivocada
 *   - una jornada entera (16-oct-2026, 15 operaciones) no existia en el diario
 *   - el 19-oct pasaba de 8 operaciones a 39
 *
 * CONFIRMA LA HORA CON TU MESA. 18 es el estandar del CME y lo que usan la
 * mayoria de las firmas de futuros, pero si la tuya resetea a otra hora, ponla
 * aqui y todas las metricas por fecha se recolocan solas.
 */
export const MARKET_DAY_ROLL_HOUR = Number(process.env.MARKET_DAY_ROLL_HOUR ?? 18);

export const CONTEXT_RETENTION_DAYS = Number(process.env.CONTEXT_RETENTION_DAYS ?? 0);

export const NEWS_BLACKOUT_BEFORE_MIN = Number(process.env.NEWS_BLACKOUT_BEFORE_MIN ?? 5);
export const NEWS_BLACKOUT_AFTER_MIN = Number(process.env.NEWS_BLACKOUT_AFTER_MIN ?? 10);

/**
 * Temporalidad del contexto que se usa al cruzar con las operaciones, en
 * segundos (60 = graficos de un minuto). Vacio acepta cualquiera.
 *
 * Importa cuando el indicador esta activo en varios graficos: un snapshot de 4h
 * y uno de 1m describen cosas distintas, y su "rango medio reciente" se mide
 * sobre periodos que no tienen nada que ver. Fijar la temporalidad del grafico
 * con el que de verdad decides evita comparar peras con manzanas.
 */
export const CONTEXT_BAR_SECONDS = process.env.CONTEXT_BAR_SECONDS
  ? Number(process.env.CONTEXT_BAR_SECONDS)
  : null;

/**
 * Con esto activado el servidor se mantiene al dia solo: vigila la base de
 * Quantower y el log de los indicadores, e ingiere cuando cambian. Basta con
 * dejarlo levantado mientras operas.
 */
export const AUTO_INGEST = process.env.AUTO_INGEST !== 'false';
export const AUTO_INGEST_INTERVAL_MS = Number(process.env.AUTO_INGEST_INTERVAL_MS ?? 15_000);

/**
 * Fecha a partir de la cual las operaciones cuentan como operativa real. Todo lo
 * anterior se marca como prueba y queda fuera de las metricas: mezclarlas
 * distorsiona cualquier conclusion, que es justo lo que nos paso al principio.
 */
export const REAL_TRADING_SINCE = process.env.REAL_TRADING_SINCE ?? '2026-10-12';

/**
 * Desfase de la hora de mercado respecto a UTC. Nueva York es -4 en horario de
 * verano y -5 en invierno; las sesiones se clasifican con esta referencia para
 * que coincidan con lo que marca el indicador KillZones en el grafico.
 */
export const MARKET_UTC_OFFSET_HOURS = Number(process.env.MARKET_UTC_OFFSET_HOURS ?? -4);

/**
 * Quantower guarda la cache de operaciones en una carpeta por cuenta, con un
 * nombre generado que incluye el id del broker. Como no se puede adivinar, se
 * busca la primera que exista en vez de pedirla configurada.
 */
export function findQuantowerTradesDb(): string | null {
  const explicit = process.env.QUANTOWER_TRADES_DB;
  if (explicit) return existsSync(explicit) ? explicit : null;

  const cacheRoot = join(QUANTOWER_ROOT, 'UserTradesCache');
  if (!existsSync(cacheRoot)) return null;

  for (const dir of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const candidate = join(cacheRoot, dir.name, 'user-trades.db');
    if (existsSync(candidate)) return candidate;
  }

  return null;
}


// ---------------------------------------------------------------------------
// Contexto de mercado (materias primas, bonos, indices, resultados, noticias)
// ---------------------------------------------------------------------------

/**
 * Claves de los dos proveedores. SIN ELLAS NO SE PIDE NADA, y es deliberado:
 * el diario funciona entero sin esta pieza, que es la unica que sale a
 * internet. Quien no las configure no nota que existe.
 *
 * Van en el .env, que esta en .gitignore: nunca viajan al repositorio.
 */
export const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY ?? '';
export const ALPHA_API_KEY = process.env.ALPHA_API_KEY ?? '';

/**
 * CADENCIA DEL BLOQUE RAPIDO (Finnhub): cotizaciones y titulares.
 *
 * No es un intervalo fijo, y la razon es simple: un precio no se mueve cuando
 * la bolsa esta cerrada. Pedir cada diez minutos a las tres de la madrugada
 * gasta cuota para recibir once veces el mismo numero, y de paso deja la
 * alerta sonora despierta toda la noche.
 *
 * Tres velocidades segun el reloj de NUEVA YORK:
 *
 *   abierto     09:30-16:00 L-V     cada  5 min   es cuando operas
 *   extendido   04:00-09:30 y
 *               16:00-20:00 L-V     cada 15 min   resultados y pre-apertura
 *   cerrado     noches y findes     cada 60 min   solo por si entra noticia
 *
 * Finnhub limita POR MINUTO (60 llamadas) y no por dia, asi que esto no es por
 * ahorrar cuota suya: es para que lo que ves en pantalla sea de hace cinco
 * minutos cuando importa, y no de hace diez.
 *
 * MARKET_REFRESH_MIN anula las tres y vuelve al intervalo fijo de antes. Si lo
 * tienes puesto en el .env, borralo para que esto funcione.
 */
export const MARKET_REFRESH_FIXED_MIN = process.env.MARKET_REFRESH_MIN
  ? Number(process.env.MARKET_REFRESH_MIN)
  : null;

export const MARKET_REFRESH_OPEN_MIN = Number(process.env.MARKET_REFRESH_OPEN_MIN ?? 5);
export const MARKET_REFRESH_EXT_MIN = Number(process.env.MARKET_REFRESH_EXT_MIN ?? 15);
export const MARKET_REFRESH_CLOSED_MIN = Number(process.env.MARKET_REFRESH_CLOSED_MIN ?? 60);

/**
 * Cada cuantas horas se piden petroleo, bonos y calendario de resultados.
 *
 * Aparte del refresco rapido porque Alpha Vantage tiene una cuota diaria corta
 * y estas series son DIARIAS de todas formas: pedirlas cada diez minutos
 * gastaria la cuota antes del desayuno para recibir el mismo numero.
 */
export const MARKET_SLOW_HOURS = Number(process.env.MARKET_SLOW_HOURS ?? 6);

/**
 * TECHO DE PETICIONES AL DIA A ALPHA VANTAGE.
 *
 * Su plan gratuito son 25 peticiones diarias para TODO: petroleo, los dos
 * bonos y las noticias con sentimiento. No es un limite por minuto que se
 * recupera solo; cuando se acaba, se acabo hasta el dia siguiente, y lo peor
 * es como se acaba: contesta 200 con un texto dentro en vez de un error, asi
 * que sin contar las peticiones nos quedariamos sin datos creyendo que no hay
 * novedades.
 *
 * Por eso el diario lleva su PROPIA cuenta y para cuando llega al techo. Son
 * 20 y no 25 a proposito: el contador se reinicia a medianoche UTC y el de
 * ellos puede no reiniciarse exactamente a la vez, asi que cinco de margen
 * evitan empezar el dia ya castigado.
 *
 * Las series diarias se piden UNA vez al dia (4 peticiones) y las noticias con
 * sentimiento cada MARKET_SENTIMENT_HOURS. Con los valores por defecto son
 * unas 12 al dia, bien dentro del techo.
 */
export const ALPHA_DAILY_BUDGET = Number(process.env.ALPHA_DAILY_BUDGET ?? 20);

/** Cada cuantas horas se piden noticias con sentimiento a Alpha Vantage. */
export const MARKET_SENTIMENT_HOURS = Number(process.env.MARKET_SENTIMENT_HOURS ?? 3);

/**
 * Movimiento del dia, en porcentaje, a partir del cual suena la alerta.
 *
 * Dos por ciento no es magico: es aproximadamente lo que el Nasdaq se mueve en
 * un dia agitado, asi que por debajo sonaria casi a diario y acabarias
 * silenciandolo.
 */
export const MARKET_MOVE_PCT = Number(process.env.MARKET_MOVE_PCT ?? 2);

/**
 * CUANTOS DIAS DE TITULARES SE ENSEÑAN.
 *
 * El canal general de Finnhub escupe del orden de cien titulares al dia, asi
 * que sin ventana la lista no termina nunca y acabas sin leer ninguno. Y una
 * noticia de hace una semana no te cambia una sesion de MNQ: o la viste
 * entonces, o ya esta en el precio.
 *
 * Lo que queda fuera NO se borra, solo deja de salir en pantalla.
 */
export const NEWS_WINDOW_DAYS = Number(process.env.NEWS_WINDOW_DAYS ?? 3);

/**
 * Tope duro de titulares que viaja a la pantalla, por si un dia el proveedor
 * se vuelve loco. La pestaña los pagina de 25 en 25 y busca sobre todos.
 */
export const NEWS_MAX = Number(process.env.NEWS_MAX ?? 300);

/** Los simbolos que te importan: filtran resultados y noticias. */
export const MARKET_TICKERS = (
  process.env.MARKET_TICKERS ?? 'NVDA,AAPL,MSFT,MU,AMD,AMZN,META,GOOGL,GOOG,TSLA'
)
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

/**
 * Nombre de cada empresa. Lo ponemos nosotros, no el proveedor.
 *
 * El endpoint de nombres de Finnhub es una peticion mas POR SIMBOLO y devuelve
 * algo que no cambia nunca: once peticiones al dia para leer que NVDA se llama
 * NVIDIA. Un mapa de texto cuesta cero y nunca se cae. El que no este sale con
 * su ticker, que tampoco impide leer la tabla.
 */
export const COMPANY_NAMES: Record<string, string> = {
  NVDA: 'NVIDIA', AAPL: 'Apple', MSFT: 'Microsoft', MU: 'Micron',
  AMD: 'Advanced Micro Devices', AMZN: 'Amazon', META: 'Meta Platforms',
  GOOGL: 'Alphabet (A)', GOOG: 'Alphabet (C)', TSLA: 'Tesla',
  AVGO: 'Broadcom', NFLX: 'Netflix', COST: 'Costco', PEP: 'PepsiCo',
  ADBE: 'Adobe', INTC: 'Intel', QCOM: 'Qualcomm', CSCO: 'Cisco',
  TMUS: 'T-Mobile', AMAT: 'Applied Materials', LRCX: 'Lam Research',
  KLAC: 'KLA', PANW: 'Palo Alto Networks', ARM: 'Arm Holdings',
  MRVL: 'Marvell', PLTR: 'Palantir', CRWD: 'CrowdStrike', ASML: 'ASML',
  QQQ: 'Nasdaq 100 (QQQ)',
};

/**
 * Peso de cada empresa dentro del QQQ, en porcentaje.
 *
 * ESTO ES UNA FOTO A MANO Y SE QUEDA VIEJA. El fichero de posiciones del ETF
 * no lo da ninguna API gratuita -el script de tu amigo lo sacaba de Yahoo, que
 * aqui no se puede usar- asi que esta copiado de la pantalla de octubre de
 * 2026. Los pesos se mueven despacio (decimas al mes, salvo subida fuerte de
 * una de ellas), asi que sirve para lo que lo quieres: saber cual de las diez
 * mueve mas el indice cuando publica resultados. Repasalo cada pocos meses.
 *
 * Se puede sobreescribir sin tocar codigo:
 *   QQQ_WEIGHTS=NVDA:8.6,AAPL:7.1,...
 */
export const QQQ_WEIGHTS: Record<string, number> = (() => {
  const base: Record<string, number> = {
    NVDA: 8.3, AAPL: 7.4, MSFT: 5.8, MU: 5.0, AMD: 4.2,
    AMZN: 4.1, META: 3.3, GOOGL: 3.1, GOOG: 2.8, TSLA: 2.8,
  };

  const crudo = process.env.QQQ_WEIGHTS;
  if (!crudo) return base;

  const out: Record<string, number> = {};
  for (const par of crudo.split(',')) {
    const [s, w] = par.split(':');
    const peso = Number(w);
    if (s && Number.isFinite(peso)) out[s.trim().toUpperCase()] = peso;
  }
  return Object.keys(out).length > 0 ? out : base;
})();
