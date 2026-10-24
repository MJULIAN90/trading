import { db } from '../db/index.js';
import { getChartPrefs } from './prefs.js';

/**
 * Notas y etiquetas por operacion.
 *
 * Las etiquetas no son una lista cerrada: las escribes tu segun lo que vayas
 * viendo ("entre tarde", "movi el stop", "revancha"). Lo util viene despues,
 * cuando se cruzan con el resultado: una etiqueta que aparece en 14 operaciones
 * y suma -300 es una conducta concreta que te cuesta dinero, y eso es muy
 * distinto de una intuicion.
 */

export interface OperationNote {
  operationId: number;
  note: string;
  tags: string[];
  updatedAt: number | null;
}

/** Minusculas y sin espacios de sobra: "Entre Tarde" y "entre tarde" son la misma. */
function cleanTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
}

export function getNote(operationId: number): OperationNote {
  const row = db()
    .prepare('SELECT note, updated_at FROM operation_notes WHERE operation_id = ?')
    .get(operationId) as { note: string; updated_at: number } | undefined;

  const tags = db()
    .prepare('SELECT tag FROM operation_tags WHERE operation_id = ? ORDER BY tag')
    .all(operationId) as Array<{ tag: string }>;

  return {
    operationId,
    note: row?.note ?? '',
    tags: tags.map((t) => t.tag),
    updatedAt: row?.updated_at ?? null,
  };
}

/**
 * Deja UNA sola etiqueta de estrategia, la ultima de la lista.
 *
 * La regla vive aqui y no solo en la pantalla porque es una regla de los
 * datos, no de la interfaz: las metricas por estrategia solo son comparables
 * si cada operacion cae en un grupo y en uno solo. Si una operacion pudiera
 * ser "scalper" y "rango" a la vez, los grupos dejarian de sumar el total y
 * compararlos seria mentira.
 *
 * Si una operacion de verdad es las dos cosas, eso no significa que haga falta
 * permitir el solape: significa que falta una estrategia que se llame asi.
 */
function onlyOneStrategy(tags: string[]): string[] {
  const kinds = getChartPrefs().tagKind;
  const estrategias = tags.filter((t) => kinds[t] === 'estrategia');

  if (estrategias.length <= 1) return tags;

  const ultima = estrategias[estrategias.length - 1];
  return tags.filter((t) => kinds[t] !== 'estrategia' || t === ultima);
}

/** Guarda nota y etiquetas de golpe. Las etiquetas se reemplazan enteras. */
export function saveNote(operationId: number, note: string, tags: string[]): OperationNote {
  const target = db();

  const unique = onlyOneStrategy(
    Array.from(new Set(tags.map(cleanTag).filter((t) => t.length > 0))).slice(0, 20),
  );

  target.transaction(() => {
    target
      .prepare(
        `INSERT INTO operation_notes (operation_id, note, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (operation_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run(operationId, note.slice(0, 8000), Date.now());

    target.prepare('DELETE FROM operation_tags WHERE operation_id = ?').run(operationId);

    const insert = target.prepare('INSERT OR IGNORE INTO operation_tags (operation_id, tag) VALUES (?, ?)');
    for (const tag of unique) insert.run(operationId, tag);
  })();

  return getNote(operationId);
}

/** Notas de varias operaciones a la vez, para no hacer una consulta por fila del listado. */
export function notesFor(ids: number[]): Map<number, OperationNote> {
  const out = new Map<number, OperationNote>();
  if (ids.length === 0) return out;

  const marks = ids.map(() => '?').join(',');

  for (const id of ids) {
    out.set(id, { operationId: id, note: '', tags: [], updatedAt: null });
  }

  const notes = db()
    .prepare(`SELECT operation_id, note, updated_at FROM operation_notes WHERE operation_id IN (${marks})`)
    .all(...ids) as Array<{ operation_id: number; note: string; updated_at: number }>;

  for (const n of notes) {
    const entry = out.get(n.operation_id);
    if (entry) {
      entry.note = n.note;
      entry.updatedAt = n.updated_at;
    }
  }

  const tags = db()
    .prepare(`SELECT operation_id, tag FROM operation_tags WHERE operation_id IN (${marks}) ORDER BY tag`)
    .all(...ids) as Array<{ operation_id: number; tag: string }>;

  for (const t of tags) out.get(t.operation_id)?.tags.push(t.tag);

  return out;
}

export interface TagImpact {
  tag: string;
  count: number;
  pnl: number;
  wins: number;
}

/**
 * Cuanto suma cada etiqueta. Solo operaciones reales: mezclar las pruebas de
 * plataforma falsea cualquier conclusion.
 *
 * Importante al leerlo: una etiqueta con 3 operaciones no dice nada por muy
 * llamativa que sea la cifra. Hace falta repeticion para que signifique algo.
 */
export function tagImpact(): TagImpact[] {
  return db()
    .prepare(
      `SELECT t.tag AS tag,
              COUNT(*) AS count,
              ROUND(SUM(o.gross_pnl), 2) AS pnl,
              SUM(CASE WHEN o.gross_pnl > 0 THEN 1 ELSE 0 END) AS wins
         FROM operation_tags t
         JOIN operations o ON o.id = t.operation_id
        WHERE o.is_real = 1
        GROUP BY t.tag
        ORDER BY pnl ASC`,
    )
    .all() as TagImpact[];
}

/** Todas las etiquetas usadas, para ofrecer autocompletado en el formulario. */
export function allTags(): string[] {
  const rows = db()
    .prepare('SELECT tag, COUNT(*) n FROM operation_tags GROUP BY tag ORDER BY n DESC, tag')
    .all() as Array<{ tag: string }>;
  return rows.map((r) => r.tag);
}

/**
 * Todas las filas de etiquetas, para cruzarlas con el listado sin hacer una
 * consulta por operacion. Son unas decenas de filas: traerlas enteras sale
 * mas barato que preguntar una vez por fila de la lista.
 */
export function allOperationTags(): Array<{ operation_id: number; tag: string }> {
  return db()
    .prepare('SELECT operation_id, tag FROM operation_tags ORDER BY tag')
    .all() as Array<{ operation_id: number; tag: string }>;
}

/** Cuantas operaciones llevan puesta una etiqueta. */
export function tagUsage(tag: string): number {
  const row = db()
    .prepare('SELECT COUNT(*) AS n FROM operation_tags WHERE tag = ?')
    .get(tag.trim().toLowerCase()) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Renombra una etiqueta EN LAS OPERACIONES, no solo en la lista de sugerencias.
 *
 * Esta es la parte que no se puede saltar. Si renombrar cambiara solo la
 * sugerencia, las operaciones que ya llevan el nombre viejo se quedarian con
 * el, y donde habia una conducta pasaria a haber dos con la mitad de los casos
 * cada una. Las estadisticas por etiqueta se sostienen justo sobre lo
 * contrario: que la misma conducta se llame siempre igual.
 *
 * Si el destino ya existe, esto FUSIONA. La tabla tiene clave
 * (operation_id, tag), asi que una operacion que llevara las dos daria
 * conflicto de clave; `UPDATE OR REPLACE` lo resuelve dejando una sola fila,
 * que es exactamente lo que significa fusionar dos categorias.
 */
export function renameTag(from: string, to: string): { operations: number; merged: boolean } {
  const origen = from.trim().toLowerCase();
  const destino = to.trim().toLowerCase().slice(0, 40);

  if (!origen || !destino || origen === destino) {
    return { operations: 0, merged: false };
  }

  const target = db();
  const merged = tagUsage(destino) > 0;
  const antes = tagUsage(origen);

  target.transaction(() => {
    target
      .prepare('UPDATE OR REPLACE operation_tags SET tag = ? WHERE tag = ?')
      .run(destino, origen);
  })();

  return { operations: antes, merged };
}
