import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { CONTEXT_DIR } from '../config.js';
import { db } from '../db/index.js';

/**
 * Lee el log que escriben los indicadores. Formato JSONL: una linea JSON por
 * evento, siempre al final del fichero. Se eligio asi porque el indicador
 * puede escribir sin bloquear ni releer nada, y porque una linea corrupta (un
 * cierre de Quantower a mitad de escritura) solo rompe esa linea.
 *
 * Cada registro necesita como minimo: ts (epoch ms), symbol y event. Todo lo
 * demas se guarda tal cual en payload, para poder cambiar las features sin
 * tocar el esquema.
 */
function ingestOneFile(path: string): Promise<{ read: number; added: number; bad: number }> {
  return new Promise((resolve, reject) => {
    if (!existsSync(path)) {
      resolve({ read: 0, added: 0, bad: 0 });
      return;
    }

    const target = db();
    const insert = target.prepare(
      `INSERT OR IGNORE INTO context_snapshots (ts, symbol, event, payload)
       VALUES (?, ?, ?, ?)`,
    );

    let read = 0;
    let added = 0;
    let bad = 0;
    const pending: Array<[number, string, string, string]> = [];

    const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      read++;

      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        const ts = Number(obj.ts);
        const symbol = String(obj.symbol ?? '');
        const event = String(obj.event ?? '');
        if (!Number.isFinite(ts) || !symbol || !event) throw new Error('campos minimos ausentes');
        pending.push([ts, symbol, event, trimmed]);
      } catch {
        bad++;
      }
    });

    rl.on('close', () => {
      const run = target.transaction(() => {
        for (const row of pending) {
          if (insert.run(...row).changes > 0) added++;
        }
      });
      run();
      resolve({ read, added, bad });
    });

    rl.on('error', reject);
  });
}

/**
 * Ingiere todos los ficheros de contexto de la carpeta. Son uno por dia y el
 * insert es OR IGNORE sobre (ts, symbol, event), asi que releer dias ya
 * procesados no duplica nada: cuesta un poco de lectura y ahorra tener que
 * llevar la cuenta de por donde iba cada fichero.
 */
export async function ingestContextLog(
  dir: string = CONTEXT_DIR,
): Promise<{ read: number; added: number; bad: number; files: number }> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { read: 0, added: 0, bad: 0, files: 0 };
  }

  const files = readdirSync(dir)
    .filter((f) => f.startsWith('context-') && f.endsWith('.jsonl'))
    .sort();

  let read = 0;
  let added = 0;
  let bad = 0;

  for (const f of files) {
    const r = await ingestOneFile(join(dir, f));
    read += r.read;
    added += r.added;
    bad += r.bad;
  }

  if (files.length) {
    db()
      .prepare(
        `INSERT INTO ingest_runs (source, ran_at, rows_read, rows_new, cursor)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('context', Date.now(), read, added, files[files.length - 1] ?? null);
  }

  return { read, added, bad, files: files.length };
}
