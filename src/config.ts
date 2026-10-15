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
