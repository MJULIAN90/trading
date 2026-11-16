/**
 * Las reglas de etiquetado con las que arranca una base vacia.
 *
 * Vive en su propio fichero, sin importar NADA, por un motivo concreto: las
 * necesitan `db/index.ts` (para sembrarlas en la migracion) y `autotags.ts`
 * (que es donde esta el motor). Si estuvieran en `autotags.ts`, la base
 * importaria el dominio y el dominio importaria la base: el primer ciclo de
 * importaciones del proyecto, y los ciclos fallan tarde y raro.
 *
 * Son SEMILLA, no catalogo: se escriben una sola vez y a partir de ahi mandan
 * las de `tag_rules`. Lo que el edite o borre en Ajustes no vuelve.
 *
 * Las cinco son de reloj o de resta de marcas de tiempo. Ninguna mira el
 * resultado de la operacion, que es la linea que no se cruza: una etiqueta que
 * se pone segun si ganaste convierte en un espejo cualquier estadistica que se
 * haga despues con ella. El porque esta largo en `autotags.ts`.
 */

export interface CondicionSemilla {
  campo: string;
  operador: string;
  valor: number;
  valor2?: number;
}

export const REGLAS_DE_ARRANQUE: Array<{ tag: string; condiciones: CondicionSemilla[] }> = [
  {
    // Cerrar en el minuto 12 de la vela de 15m.
    tag: 'salida a tiempo 12m',
    condiciones: [{ campo: 'minuto_salida_en_vela15', operador: '=', valor: 12 }],
  },
  {
    tag: 'salida a tiempo 13m',
    condiciones: [{ campo: 'minuto_salida_en_vela15', operador: '=', valor: 13 }],
  },
  {
    // Los primeros quince minutos de Nueva York. 9.5 es 09:30 en decimal.
    tag: 'operacion en apertura de mercado',
    condiciones: [{ campo: 'hora_mercado', operador: 'entre', valor: 9.5, valor2: 9.75 }],
  },
  {
    // Entrar con la killzone a punto de cerrarse: queda muy poca franja para
    // que la operacion se desarrolle.
    tag: 'operacion al borde limite de sesion',
    condiciones: [{ campo: 'minutos_hasta_cierre_sesion', operador: 'entre', valor: 0, valor2: 5 }],
  },
  {
    // Ya la calculaba `review.ts` como bandera de Disciplina. Aqui se convierte
    // en etiqueta para que entre en las metricas por etiqueta como las demas.
    tag: 'reentrada en misma vela m15',
    condiciones: [{ campo: 'reentrada_misma_vela15', operador: '=', valor: 1 }],
  },
];
