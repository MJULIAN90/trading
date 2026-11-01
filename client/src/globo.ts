import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

/**
 * Donde se coloca un globo flotante para que NUNCA se salga de la ventana.
 *
 * Existe porque la regla estaba en un solo sitio y los demas globos no la
 * tenian. `OpTooltip` si medía y se daba la vuelta; el de `Charts` se pintaba
 * en `cursor + 14px` a pelo, asi que en el grafico de P&L por fecha -que esta
 * abajo del todo en Resumen- el globo salia por debajo del borde y no se leia.
 * Un globo que se corta es peor que no tener globo: el usuario ve que hay algo
 * escrito y no puede leerlo.
 *
 * La regla, que es la de `OpTooltip` y ahora vale para todos:
 *
 *   1. Primero se intenta DEBAJO del ancla, que es lo natural al bajar la
 *      vista por una lista o por un grafico.
 *   2. Si no cabe, se da la vuelta y va ENCIMA. Darle la vuelta es mejor que
 *      pegarlo al borde y dejar que se corte, porque lo que se corta siempre
 *      es el final — justo donde estan las cifras.
 *   3. Si tampoco cabe encima (un globo mas alto que la ventana), se pega
 *      arriba y se deja que se corte por abajo: al menos se lee el principio.
 *   4. En horizontal se empuja hacia dentro por los dos lados.
 *
 * Se mide con `useLayoutEffect` y no con `useEffect` porque hay que medir el
 * globo YA MONTADO para saber si cabe. Con `useEffect` se ve un fotograma en
 * el sitio equivocado antes del salto.
 */

/** La caja a la que se engancha el globo, en coordenadas de pantalla. */
export interface Ancla {
  top: number;
  bottom: number;
  left: number;
}

/** Aire entre el globo y su ancla, y entre el globo y el borde de la ventana. */
export const MARGEN = 8;

/**
 * Un punto del raton como ancla.
 *
 * El desplazamiento a la derecha evita que el globo quede justo debajo del
 * cursor, donde taparia lo que se esta senialando.
 */
export function anclaDePunto(x: number, y: number): Ancla {
  return { top: y, bottom: y, left: x + 14 };
}

export function usePosicionGlobo<T extends HTMLElement>(
  ancla: Ancla | null,
): { ref: RefObject<T | null>; estilo: CSSProperties } {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || ancla === null) {
      setPos(null);
      return;
    }

    const caja = el.getBoundingClientRect();

    let top = ancla.bottom + MARGEN;
    if (top + caja.height > window.innerHeight - MARGEN) {
      const encima = ancla.top - caja.height - MARGEN;
      top = encima >= MARGEN ? encima : Math.max(MARGEN, window.innerHeight - caja.height - MARGEN);
    }

    let left = ancla.left;
    if (left + caja.width > window.innerWidth - MARGEN) left = window.innerWidth - caja.width - MARGEN;
    if (left < MARGEN) left = MARGEN;

    setPos({ top, left });
    // El ancla es un objeto nuevo en cada render del padre, asi que se
    // dependen los tres numeros y no la referencia: con la referencia, mover
    // el raton un pixel dispara el efecto aunque la posicion no cambie.
  }, [ancla?.top, ancla?.bottom, ancla?.left, ancla === null]);

  return {
    ref,
    estilo: {
      position: 'fixed',
      top: pos?.top ?? 0,
      left: pos?.left ?? 0,
      // Hasta que no esta medido se pinta fuera de la vista. Sin esto hay un
      // parpadeo en la esquina superior izquierda cada vez que aparece.
      visibility: pos === null ? 'hidden' : 'visible',
    },
  };
}
