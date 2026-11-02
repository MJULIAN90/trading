/**
 * Como se reparten los dias de un mes en una rejilla de LUNES A VIERNES.
 *
 * Esta aqui y no dentro de `DayCalendar.tsx` por una razon concreta: es la
 * unica parte del calendario que se puede equivocar en silencio. El numero de
 * cada casilla siempre sale bien —es el dia del mes— y el color siempre sale
 * bien —es el PnL—, asi que un dia colocado en la columna que no toca se lee
 * como un dato correcto. Aqui separada se puede probar sin navegador, y
 * `scripts/prueba-calendario.ts` la recorre mes a mes.
 *
 * -------------------------------------------------------------------------
 * EL FALLO QUE LA SACO DE AHI, 1 de noviembre de 2026
 * -------------------------------------------------------------------------
 * El hueco inicial se calculaba asi:
 *
 *     const leading = weekdayMondayFirst(y, m, 1);
 *
 * El dia 1 de noviembre de 2026 cae en DOMINGO, que con lunes = 0 es el 6.
 * Seis huecos en una rejilla de cinco columnas son una fila entera vacia mas
 * uno: el lunes 2 acababa pintado en la columna del MARTES, y con el todo
 * noviembre corrido una columna. El viernes 6 salia bajo la L.
 *
 * Octubre no lo enseniaba porque empieza en jueves, y cualquier mes que
 * empiece entre semana cuadra solo. Solo fallan los que empiezan en sabado o
 * en domingo —en 2026, agosto y noviembre— que son dos de doce: suficiente
 * para que pasara un mes sin verse.
 *
 * El arreglo no es recortar el hueco a cuatro, que pondria el lunes en el
 * viernes. Es contar el hueco desde el PRIMER DIA QUE DE VERDAD OCUPA
 * CASILLA: si el mes abre en fin de semana, ese dia es siempre un lunes y el
 * hueco es cero.
 */

/** Cinco columnas, no siete: con el corte de las 18:00 no hay fin de semana. */
export const COLUMNAS = 5;

/** Dia de la semana con lunes = 0. `Date.UTC` evita la zona horaria local. */
export function weekdayMondayFirst(y: number, m: number, d: number): number {
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Cuantos dias tiene el mes. El dia 0 del siguiente es el ultimo de este. */
export function diasDelMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Las casillas del mes en orden de lectura, `null` donde no va ningun dia.
 *
 * La longitud siempre es multiplo de `COLUMNAS`, asi que el indice de una
 * casilla modulo cinco es su columna, y eso es justo lo que comprueba la
 * prueba: que la columna coincida con el dia de la semana real.
 */
export function celdasDelMes(y: number, m: number): Array<number | null> {
  const total = diasDelMes(y, m);

  // El primer dia que ocupa casilla. Si el mes abre en sabado o en domingo,
  // es el lunes siguiente y el hueco inicial queda en cero.
  let primero = 1;
  while (primero <= total && weekdayMondayFirst(y, m, primero) >= COLUMNAS) primero++;

  const celdas: Array<number | null> = [];
  for (let i = 0; i < weekdayMondayFirst(y, m, primero); i++) celdas.push(null);
  for (let d = primero; d <= total; d++) {
    if (weekdayMondayFirst(y, m, d) >= COLUMNAS) continue;
    celdas.push(d);
  }
  while (celdas.length % COLUMNAS !== 0) celdas.push(null);

  return celdas;
}
