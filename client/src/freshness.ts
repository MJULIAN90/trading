import { useEffect, useState } from 'react';

/**
 * Huella de los datos de mercado, para que los paneles de estudio se enteren
 * de que han entrado velas nuevas.
 *
 * El problema que resuelve. El servidor mantiene la base al dia solo: vigila
 * Quantower cada quince segundos, ingiere y deriva las velas. Pero el cliente
 * no se enteraba. Los paneles de Mercado piden sus datos cuando mueves un
 * mando y nunca mas, asi que la tabla que tienes delante se queda congelada en
 * el instante en que abriste la pestaña. Pasaban los dias y seguia diciendo
 * "sobre 79 dias de velas".
 *
 * Por que no un refresco a secas. Volver a pedir los estudios cada medio
 * minuto a ciegas es pedirle al servidor que recalcule rejillas de miles de
 * casos sin que haya cambiado nada. Lo que se hace es preguntar primero por lo
 * barato -cuantas velas hay y cual es la ultima, un COUNT y un MAX- y solo
 * cuando esa huella cambia se rehacen los estudios. Que es, ademas, exactamente
 * la misma huella con la que el servidor invalida sus caches, asi que cuando el
 * cliente decide repetir la peticion el servidor tambien va a recalcular: las
 * dos capas se despiertan por el mismo motivo y a la vez.
 *
 * Por que un singleton y no un hook por panel. En la pestaña de Mercado hay
 * tres paneles a la vez. Si cada uno montara su propio temporizador serian
 * tres consultas iguales cada medio minuto y, peor, podrian ver huellas
 * distintas y refrescarse en momentos distintos. Con un solo temporizador y
 * varios oyentes, todos ven el mismo valor en el mismo instante.
 */

const INTERVALO_MS = 30_000;

/** Ultima huella conocida. Vacia hasta la primera consulta. */
let sello = '';

let timer: ReturnType<typeof setInterval> | null = null;
let lectores = 0;

const oyentes = new Set<(s: string) => void>();

async function mirar(): Promise<void> {
  try {
    const res = await fetch('/api/bars/status');
    if (!res.ok) return;

    const data = (await res.json()) as {
      symbols?: Array<{ symbol: string; bars: number; to: number }>;
    };

    // Se incluyen TODOS los simbolos, no solo el principal. Los estudios usan
    // uno, pero cual es depende de los ajustes, y una huella por simbolo suelto
    // dejaria fuera al que esta mirando el panel en ese momento.
    const nuevo = (data.symbols ?? [])
      .map((s) => `${s.symbol}:${s.bars}:${s.to}`)
      .sort()
      .join('|');

    if (nuevo === sello) return;

    sello = nuevo;
    for (const avisar of oyentes) avisar(nuevo);
  } catch {
    // El servidor puede estar reiniciando. No es un error que merezca pantalla:
    // en treinta segundos se vuelve a intentar.
  }
}

/**
 * Devuelve una cadena que cambia cuando entran velas nuevas.
 *
 * Se mete en las dependencias del `useEffect` que pide el estudio y ya esta:
 * el panel se rehace cuando el mercado avanza y no cuando no.
 */
export function useMarketStamp(): string {
  const [valor, setValor] = useState(sello);

  useEffect(() => {
    oyentes.add(setValor);
    lectores++;

    if (lectores === 1) {
      void mirar();
      timer = setInterval(() => void mirar(), INTERVALO_MS);
    } else if (sello !== '') {
      // Llego tarde a un temporizador que ya corria: ponerse al dia sin esperar
      // al siguiente tic.
      setValor(sello);
    }

    return () => {
      oyentes.delete(setValor);
      lectores--;

      // Sin esto, salir de la pestaña de Mercado dejaba el temporizador vivo
      // consultando la base para nadie durante el resto de la sesion.
      if (lectores === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);

  return valor;
}
