import { useMemo, useState, type ReactNode } from 'react';

/**
 * Ordenar una tabla pulsando su cabecera.
 *
 * Por que en un sitio comun y no tabla por tabla. En la aplicacion hay siete
 * tablas y todas plantean la misma pregunta -cual rinde mejor-, que hoy se
 * contesta recorriendolas fila a fila con el dedo. Escrito siete veces, cada
 * una acabaria decidiendo por su cuenta que hacer con un valor vacio o si la
 * primera pulsacion ordena de mayor a menor, y dos tablas de la misma pantalla
 * se comportarian distinto.
 *
 * Tres decisiones que valen para todas:
 *
 * NUMEROS DE MAYOR A MENOR en la primera pulsacion, TEXTO de la A a la Z. Si
 * pulsas "ACIERTO" quieres ver el mejor arriba, no el peor; si pulsas "PATRON"
 * quieres la lista alfabetica. La segunda pulsacion invierte.
 *
 * LOS VACIOS SIEMPRE ABAJO, se ordene como se ordene. Un null no es "muy
 * pequeño", es "no se sabe", y mandarlo arriba al invertir llena la primera
 * pantalla de celdas en blanco justo cuando buscas las peores.
 *
 * ORDEN ESTABLE. El `sort` de JavaScript lo es desde ES2019, asi que al
 * ordenar por una columna con empates -"REPITE" solo tiene si y no- las filas
 * empatadas conservan el orden que trajeran, en vez de barajarse en cada
 * pulsacion.
 */

export type SortDir = 'asc' | 'desc';

/** Lo que se puede comparar. `null` = no se sabe, y se va al final. */
export type SortValue = number | string | boolean | null | undefined;

export interface SortState {
  key: string;
  dir: SortDir;
}

function compara(a: SortValue, b: SortValue): number {
  const aVacio = a === null || a === undefined || (typeof a === 'number' && Number.isNaN(a));
  const bVacio = b === null || b === undefined || (typeof b === 'number' && Number.isNaN(b));

  // Devuelve 0 cuando los dos faltan para no romper la estabilidad del orden.
  if (aVacio && bVacio) return 0;
  if (aVacio) return 1;
  if (bVacio) return -1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'es');
}

export interface Sortable<T> {
  /** Las filas ya ordenadas. */
  rows: T[];
  /** La cabecera pulsable. `k` tiene que existir en el mapa de valores. */
  Th: (p: { k: string; children: ReactNode; title?: string; className?: string }) => ReactNode;
  sort: SortState | null;
}

/**
 * @param rows   Las filas tal cual llegan.
 * @param values Un extractor por columna ordenable. Las columnas que no esten
 *               aqui simplemente no se pueden pulsar.
 * @param inicial Orden de partida, o null para respetar el que traen.
 */
export function useSort<T>(
  rows: T[],
  values: Record<string, (row: T) => SortValue>,
  inicial: SortState | null = null,
): Sortable<T> {
  const [sort, setSort] = useState<SortState | null>(inicial);

  const ordenadas = useMemo(() => {
    if (sort === null) return rows;

    const extrae = values[sort.key];
    if (extrae === undefined) return rows;

    const signo = sort.dir === 'asc' ? 1 : -1;

    // Copia: ordenar el array que llega mutaria el estado de quien lo paso.
    return [...rows].sort((a, b) => {
      const va = extrae(a);
      const vb = extrae(b);

      // Los vacios se quedan abajo tambien al invertir, asi que su comparacion
      // NO se multiplica por el signo.
      const aVacio = va === null || va === undefined;
      const bVacio = vb === null || vb === undefined;
      if (aVacio || bVacio) return compara(va, vb);

      return compara(va, vb) * signo;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  const pulsar = (k: string) => {
    setSort((cur) => {
      if (cur !== null && cur.key === k) return { key: k, dir: cur.dir === 'asc' ? 'desc' : 'asc' };

      // Primera pulsacion: el numero de mayor a menor, el texto de la A a la Z.
      const muestra = rows.length > 0 ? values[k]?.(rows[0] as T) : undefined;
      const numerica = typeof muestra === 'number' || typeof muestra === 'boolean';
      return { key: k, dir: numerica ? 'desc' : 'asc' };
    });
  };

  const Th = ({ k, children, title, className }: { k: string; children: ReactNode; title?: string; className?: string }) => {
    const activa = sort !== null && sort.key === k;
    return (
      <th
        className={`orden ${activa ? `on ${sort.dir}` : ''} ${className ?? ''}`}
        onClick={() => pulsar(k)}
        title={title ?? 'Pulsa para ordenar'}
      >
        {children}
        <i className="flecha">{activa ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</i>
      </th>
    );
  };

  return { rows: ordenadas, Th, sort };
}
