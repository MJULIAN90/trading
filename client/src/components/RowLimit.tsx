import { useSticky } from '../sticky';

/**
 * Tope de filas para las tablas que crecen solas.
 *
 * Que problema resuelve: las tablas agrupadas por fecha ganan una fila por
 * jornada. Con diez dias se leen bien; con doscientos, la pagina se vuelve un
 * muro por el que hay que bajar sin parar, y lo que casi siempre interesa son
 * las ultimas.
 *
 * Por que corta por el FINAL y no por el principio: estos datos vienen
 * ordenados de mas antiguo a mas reciente, y lo que se quiere ver son las
 * jornadas de ahora, no las del mes pasado. Un `slice(0, n)` daria justo las
 * que no sirven.
 *
 * El valor elegido se recuerda, igual que el resto de mandos.
 */

export const ROW_LIMITS = [7, 14, 30, 60, 120, 0] as const;

/** 0 significa "todas". Se guarda como 0 y no como null para que el desplegable tenga un valor real. */
export const TODAS = 0;

export function useRowLimit(key: string, inicial = 30) {
  return useSticky<number>(`limite.${key}`, inicial, (v) =>
    (ROW_LIMITS as readonly number[]).includes(v),
  );
}

/** Las ultimas `limit` filas. Con 0 o con menos filas que el tope, las devuelve todas. */
export function lastRows<T>(rows: T[], limit: number): T[] {
  if (limit === TODAS || rows.length <= limit) return rows;
  return rows.slice(rows.length - limit);
}

export function RowLimit({
  value,
  onChange,
  total,
  shown,
  noun = 'filas',
}: {
  value: number;
  onChange: (n: number) => void;
  total: number;
  shown: number;
  noun?: string;
}) {
  return (
    <div className="filters compact" style={{ marginBottom: 8 }}>
      <label title="Cuantas filas enseñar. Siempre las mas recientes.">
        Mostrar
        <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
          {ROW_LIMITS.map((n) => (
            <option key={n} value={n}>
              {n === TODAS ? 'todas' : `ultimas ${n}`}
            </option>
          ))}
        </select>
      </label>

      {/* Decir cuantas se ocultan evita el error de leer un total parcial como
          si fuera el de todo el historico. */}
      <span className="note">
        {shown} de {total} {noun}
        {shown < total ? ` · ${total - shown} sin mostrar` : ''}
      </span>
    </div>
  );
}
