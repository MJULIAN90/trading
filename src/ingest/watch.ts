import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONTEXT_DIR, findQuantowerTradesDb } from '../config.js';
import { ingestContextLog } from './context.js';
import { ingestQuantower } from './quantower.js';

/**
 * Mantiene la base al dia sola mientras el servidor este levantado.
 *
 * Se vigila por fecha de modificacion y no con fs.watch a proposito: la base de
 * Quantower usa WAL, asi que muchas escrituras no tocan el fichero principal
 * sino el -wal, y fs.watch acaba disparando de mas o de menos segun el sistema.
 * Mirar el mtime cada pocos segundos es menos elegante pero no falla, y el coste
 * es una llamada a stat.
 */
export interface AutoIngestOptions {
  intervalMs?: number;
  onIngest?: (info: { source: string; operationsNew: number; contextNew: number }) => void;
}

export function startAutoIngest(opts: AutoIngestOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? 15_000;

  let lastTradesMtime = 0;
  let lastContextMtime = 0;
  let running = false;

  /**
   * La carpeta solo cambia de mtime cuando se crea el fichero del dia, no cuando
   * se le anaden lineas al que ya existe. Hay que mirar los ficheros.
   */
  const newestContextMtime = (): number => {
    try {
      let newest = statSync(CONTEXT_DIR).mtimeMs;
      for (const f of readdirSync(CONTEXT_DIR)) {
        if (!f.startsWith('context-') || !f.endsWith('.jsonl')) continue;
        newest = Math.max(newest, statSync(join(CONTEXT_DIR, f)).mtimeMs);
      }
      return newest;
    } catch {
      return 0;
    }
  };

  /**
   * Con WAL activo, SQLite escribe en el fichero -wal y el principal puede
   * quedarse con el mismo mtime durante minutos, hasta que hace checkpoint. Por
   * eso se mira el mas reciente de los tres: db, -wal y -shm. Mirar solo el
   * principal hace que las operaciones nuevas tarden en aparecer, que es
   * exactamente el fallo que tenia esto la primera vez.
   */
  const mtimeOf = (path: string | null): number => {
    if (!path) return 0;

    let newest = 0;
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      try {
        newest = Math.max(newest, statSync(candidate).mtimeMs);
      } catch {
        // ese fichero no existe ahora mismo; normal segun el modo de journal
      }
    }

    return newest;
  };

  async function tick(force = false) {
    if (running) return;
    running = true;

    try {
      const tradesDb = findQuantowerTradesDb();
      const tradesMtime = mtimeOf(tradesDb);
      // La carpeta cambia de mtime cuando se crea el fichero del dia, pero no
      // cuando se anaden lineas al que ya existe: hay que mirar los ficheros.
      const contextMtime = newestContextMtime();

      let operationsNew = 0;
      let contextNew = 0;

      if (tradesDb && (force || tradesMtime !== lastTradesMtime)) {
        lastTradesMtime = tradesMtime;
        operationsNew = ingestQuantower(tradesDb).operationsNew;
      }

      if (force || contextMtime !== lastContextMtime) {
        lastContextMtime = contextMtime;
        contextNew = (await ingestContextLog()).added;
      }

      if (operationsNew > 0 || contextNew > 0) {
        opts.onIngest?.({ source: 'auto', operationsNew, contextNew });
      }
    } catch (err) {
      // Un fallo puntual (Quantower escribiendo justo en ese instante) no debe
      // tumbar el servidor: en el siguiente ciclo se reintenta solo.
      console.error('[auto-ingest]', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  }

  void tick(true);
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
}
