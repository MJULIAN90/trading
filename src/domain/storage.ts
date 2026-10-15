import { CONTEXT_RETENTION_DAYS } from '../config.js';
import { db } from '../db/index.js';

/**
 * Tamano de la base y purga del crudo.
 *
 * El diario guarda el contexto DOS veces: el JSON tal cual lo escribe el
 * indicador (`context_snapshots`) y el mismo dato en columnas tipadas (`bars`).
 * No es un descuido: el crudo es la unica fuente desde la que se puede
 * reconstruir `bars` si manana se anade una columna o se cambia como se
 * interpreta algo. Pero cuesta seis veces mas espacio que la version derivada,
 * asi que pasado un tiempo deja de compensar.
 *
 * Por eso la purga viene APAGADA. Borrar datos del usuario por defecto, y
 * encima los unicos irrecuperables, no es una decision que deba tomar el
 * programa solo.
 */

export interface StorageReport {
  totalMb: number;
  tables: Array<{ name: string; mb: number; rows: number | null; share: number }>;
  /** Dias de los que se guarda el JSON crudo. */
  rawDays: number | null;
  retentionDays: number;
  /** Cuantas filas de crudo se borrarian ahora mismo con la retencion puesta. */
  prunable: number;
}

const MB = 1048576;

function rowsOf(name: string): number | null {
  try {
    return (db().prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n;
  } catch {
    return null;
  }
}

export function storageReport(): StorageReport {
  const target = db();

  let rows: Array<{ name: string; size: number }> = [];

  try {
    // dbstat es un modulo opcional de SQLite. Si la compilacion que trae
    // better-sqlite3 no lo incluye, se informa sin desglose en vez de reventar.
    rows = target
      .prepare('SELECT name, SUM(pgsize) AS size FROM dbstat GROUP BY name ORDER BY size DESC')
      .all() as Array<{ name: string; size: number }>;
  } catch {
    rows = [];
  }

  const total = rows.reduce((a, r) => a + r.size, 0);

  const cutoff = Date.now() - CONTEXT_RETENTION_DAYS * 86_400_000;

  const span = target
    .prepare('SELECT MIN(ts) AS a, MAX(ts) AS b FROM context_snapshots')
    .get() as { a: number | null; b: number | null };

  const prunable =
    CONTEXT_RETENTION_DAYS > 0
      ? (target.prepare('SELECT COUNT(*) AS n FROM context_snapshots WHERE ts < ?').get(cutoff) as {
          n: number;
        }).n
      : 0;

  return {
    totalMb: Number((total / MB).toFixed(1)),
    tables: rows
      .filter((r) => r.size > 0)
      .map((r) => ({
        name: r.name,
        mb: Number((r.size / MB).toFixed(2)),
        rows: rowsOf(r.name),
        share: total > 0 ? Number((r.size / total).toFixed(3)) : 0,
      })),
    rawDays:
      span.a !== null && span.b !== null ? Math.round((span.b - span.a) / 86_400_000) : null,
    retentionDays: CONTEXT_RETENTION_DAYS,
    prunable,
  };
}

/**
 * Borra el JSON crudo mas viejo que la retencion, pero SOLO el que ya esta
 * derivado a `bars`.
 *
 * La comprobacion contra el cursor de derivacion no es paranoia: sin ella, una
 * purga lanzada antes de que la derivacion se ponga al dia tiraria snapshots que
 * nunca llegaron a `bars`, y esos no se recuperan de ningun sitio.
 */
export function pruneContext(days: number = CONTEXT_RETENTION_DAYS): { deleted: number } {
  if (!days || days <= 0) return { deleted: 0 };

  const target = db();

  const cursor = Number(
    (target.prepare("SELECT value FROM meta WHERE key = 'bars_cursor_id'").get() as
      | { value: string }
      | undefined)?.value ?? '0',
  );

  if (cursor <= 0) return { deleted: 0 };

  const info = target
    .prepare('DELETE FROM context_snapshots WHERE ts < ? AND id <= ?')
    .run(Date.now() - days * 86_400_000, cursor);

  // SQLite no devuelve el espacio al sistema de ficheros al borrar: lo deja
  // como paginas libres para reutilizar. VACUUM es lo que encoge el fichero de
  // verdad, y se ejecuta aqui porque una purga que no reduce el tamano no
  // resuelve el problema por el que se lanzo.
  if (info.changes > 0) {
    try {
      target.exec('VACUUM');
    } catch {
      /* VACUUM falla si hay otra transaccion abierta; se reintentara la proxima vez */
    }
  }

  return { deleted: info.changes };
}
