import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Toda la configuracion sale de variables de entorno con valores por defecto que
 * funcionan en una instalacion normal de Quantower en Windows. La idea es que el
 * proyecto arranque sin tocar nada y solo haya que configurar si algo esta en
 * otra ruta.
 */

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
