import { useEffect, useState } from 'react';

/**
 * useState que recuerda el valor entre recargas.
 *
 * Para que: los mandos de las tablas de mercado (horizonte, stop, objetivo,
 * unidad...) volvian a su valor de fabrica cada vez que se abria el diario, y
 * hay que recolocarlos a mano antes de poder mirar nada.
 *
 * Donde vive: en el navegador, no en el servidor. Es una preferencia de como
 * TE gusta ver la tabla, no un dato del diario. Si algun dia abres el diario
 * desde otro equipo, los mandos empiezan de cero, y esta bien que sea asi.
 *
 * Por que lleva validador: si manana se cambian las opciones de un desplegable,
 * un valor guardado del mes pasado puede quedar fuera de la lista. Sin
 * comprobarlo, el desplegable aparece en blanco y la tabla pide algo que el
 * servidor no entiende. Con el validador, un valor que ya no vale se descarta
 * y se vuelve al de fabrica.
 */
export function useSticky<T>(
  key: string,
  initial: T,
  valid?: (value: T) => boolean,
): [T, (value: T) => void, () => void] {
  const full = `tj.${key}`;

  const [value, setValue] = useState<T>(() => {
    // Envuelto en try/catch a proposito: en ventana privada, con las cookies
    // bloqueadas o con el almacenamiento lleno, leer localStorage LANZA. Sin
    // esto, el panel entero se queda en blanco por una preferencia.
    try {
      const raw = window.localStorage.getItem(full);
      if (raw == null) return initial;

      const parsed = JSON.parse(raw) as T;
      if (valid && !valid(parsed)) return initial;

      return parsed;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(full, JSON.stringify(value));
    } catch {
      // Que no se pueda guardar la preferencia no puede romper la pagina.
    }
  }, [full, value]);

  const reset = () => {
    try {
      window.localStorage.removeItem(full);
    } catch {
      // Igual: da igual si no se puede borrar.
    }
    setValue(initial);
  };

  return [value, setValue, reset];
}
