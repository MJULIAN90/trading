/**
 * Cache con tope de tamaño para los informes de estudio.
 *
 * Por que hace falta. Los informes pesados -la rejilla, el estudio de patrones
 * y las estadisticas por killzone- se guardan con una clave que incluye cuantas
 * velas hay y cual es la ultima:
 *
 *   `${simbolo}:${n}:${ultimaVela}:${resto de parametros}`
 *
 * Meter la huella de las velas en la clave resuelve la correccion: en cuanto
 * entra una vela nueva la clave cambia, no hay acierto, y el informe se
 * recalcula con los datos de hoy. Nunca te sirve un numero viejo.
 *
 * Pero crea un problema de memoria. Cada minuto de mercado estrena un juego de
 * claves entero, y las del minuto anterior no las va a pedir ya nadie: la vela
 * que las identificaba no volvera a ser la ultima. Con un Map normal esas
 * entradas se quedan dentro para siempre. Una sesion larga moviendo los mandos
 * va dejando un informe muerto por cada combinacion y cada minuto.
 *
 * Como funciona. Un Map de JavaScript conserva el orden de insercion, asi que
 * la primera clave que devuelve `keys()` es la mas antigua y eso basta para
 * hacer un LRU sin estructuras extra. Al leer se reinserta la entrada para que
 * pase al final; al escribir, si se pasa del tope, se tiran las de delante.
 *
 * Reinsertar al leer importa: sin eso seria FIFO, y FIFO puede tirar justo la
 * combinacion que estas mirando una y otra vez solo porque se calculo pronto.
 */
export interface BoundedCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  /** Cuantas entradas vivas hay. Para pruebas y para el panel de estado. */
  readonly size: number;
}

/**
 * @param max Entradas que se conservan. Pasado el tope se descarta la menos
 *   usada recientemente. Un tope pequeño basta: lo que se reutiliza de verdad
 *   son las pocas combinaciones de mandos que el usuario esta comparando en
 *   ese momento, no el historico entero.
 */
export function boundedCache<V>(max: number): BoundedCache<V> {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`boundedCache: el tope tiene que ser un entero positivo, llego ${max}`);
  }

  const map = new Map<string, V>();

  return {
    get(key: string): V | undefined {
      const hit = map.get(key);
      if (hit === undefined) return undefined;

      map.delete(key);
      map.set(key, hit);
      return hit;
    },

    set(key: string, value: V): void {
      // El delete previo no es redundante: sin el, reescribir una clave que ya
      // existe deja la entrada en su posicion vieja y el LRU se desordena.
      map.delete(key);
      map.set(key, value);

      while (map.size > max) {
        const vieja = map.keys().next();
        if (vieja.done === true) break;
        map.delete(vieja.value);
      }
    },

    get size(): number {
      return map.size;
    },
  };
}
