import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOURNAL_DB } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));

let instance: Database.Database | null = null;

/**
 * Conexion a nuestra base. WAL para poder leer desde la API mientras el
 * ingestor escribe, que es el caso normal: dejas el servidor levantado y
 * lanzas la ingesta cuando quieres.
 */
export function db(): Database.Database {
  if (instance) return instance;

  mkdirSync(dirname(JOURNAL_DB), { recursive: true });

  instance = new Database(JOURNAL_DB);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  instance.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));

  return instance;
}

/** Abre la base de Quantower en solo lectura. Nunca escribimos ahi. */
export function openReadOnly(path: string): Database.Database {
  return new Database(path, { readonly: true, fileMustExist: true });
}
