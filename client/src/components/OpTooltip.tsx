import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * El globo de una fila del listado.
 *
 * Antes era el `title` nativo del navegador y tenia dos problemas. Uno, feo y
 * sin control: tipografia del sistema, fondo amarillento en algunos equipos y
 * cero jerarquia entre la cuenta y las etiquetas. Dos, y peor, el navegador lo
 * pinta todo en una linea por parrafo, asi que cuatro etiquetas salian pegadas
 * con puntos en medio y el globo se estiraba hasta media pantalla.
 *
 * Aqui las etiquetas van UNA DEBAJO DE OTRA, con su color, y la cuenta queda
 * arriba alineada por columnas.
 *
 * Va en un portal a `document.body` y con `position: fixed` por el sitio donde
 * vive: las filas estan dentro de un contenedor con `overflow-y: auto`, asi que
 * un hijo posicionado normal lo recortaria el borde de la lista justo en las
 * filas de abajo, que son las que mas falta tienen de que se lea entero.
 */

export interface GloboEtiqueta {
  nombre: string;
  /** '', 'buena' o 'mala'. Solo las etiquetas con polaridad llevan color. */
  clase: string;
}

export interface GloboDatos {
  /** Caja de la fila que lo dispara, en coordenadas de pantalla. */
  ancla: { top: number; bottom: number; left: number };
  /** "0 ticks x 2 contratos x $0,50". null si el contrato no esta en la tabla. */
  formula: string | null;
  bruto: string | null;
  comision: string;
  neto: string;
  netoClase: string;
  etiquetas: GloboEtiqueta[];
  nota: string;
}

/** Aire entre el globo y la fila, y entre el globo y el borde de la ventana. */
const MARGEN = 8;

export function OpTooltip({ datos }: { datos: GloboDatos }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // useLayoutEffect y no useEffect: hay que medir el globo ya montado para
  // saber si cabe debajo, y con useEffect se vería un fotograma en el sitio
  // equivocado antes de saltar al bueno.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;

    const caja = el.getBoundingClientRect();

    // Debajo de la fila, que es lo natural al bajar por la lista. Si no cabe,
    // se le da la vuelta y va encima; pegarlo al borde y dejar que se corte
    // seria peor, porque lo que se corta es siempre el final.
    let top = datos.ancla.bottom + MARGEN;
    if (top + caja.height > window.innerHeight - MARGEN) {
      const encima = datos.ancla.top - caja.height - MARGEN;
      top = encima >= MARGEN ? encima : Math.max(MARGEN, window.innerHeight - caja.height - MARGEN);
    }

    let left = datos.ancla.left;
    if (left + caja.width > window.innerWidth - MARGEN) left = window.innerWidth - caja.width - MARGEN;
    if (left < MARGEN) left = MARGEN;

    setPos({ top, left });
  }, [datos]);

  const hayCuenta = datos.formula !== null || datos.bruto !== null;

  return createPortal(
    <div
      ref={ref}
      className="op-globo"
      // Hasta que no esta medido se pinta fuera de la vista. Sin esto aparece
      // un parpadeo en la esquina superior izquierda en cada fila que tocas.
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos === null ? 'hidden' : 'visible',
      }}
    >
      {hayCuenta && (
        <div className="g-cuenta">
          {datos.formula !== null && <div className="g-formula">{datos.formula}</div>}
          {datos.bruto !== null && (
            <div className="g-linea"><span>bruto</span><b>{datos.bruto}</b></div>
          )}
          <div className="g-linea"><span>comision</span><b>{datos.comision}</b></div>
          <div className="g-linea"><span>neto</span><b className={datos.netoClase}>{datos.neto}</b></div>
        </div>
      )}

      {(datos.etiquetas.length > 0 || datos.nota !== '') && hayCuenta && <hr />}

      {datos.etiquetas.length > 0 ? (
        <ul className="g-tags">
          {datos.etiquetas.map((e) => (
            <li key={e.nombre}>
              <i className={`dot ${e.clase}`} />
              {e.nombre}
            </li>
          ))}
        </ul>
      ) : (
        datos.nota === '' && <div className="g-vacio">sin etiquetas</div>
      )}

      {datos.nota !== '' && <p className="g-nota">{datos.nota}</p>}
    </div>,
    document.body,
  );
}
