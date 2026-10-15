import { MARKET_UTC_OFFSET_HOURS } from '../config.js';

/**
 * Desfase de la hora de mercado respecto a UTC, calculado por fecha.
 *
 * Antes era una constante (-4). Funcionaba porque todos los datos eran de
 * verano, y habria empezado a fallar el 1 de noviembre de 2026 sin avisar: las
 * horas se verian una hora corridas y, peor, las operaciones se asignarian a la
 * killzone equivocada. Una de NY AM contada como Asia no es un detalle estetico,
 * es una metrica mal atribuida.
 *
 * Nueva York cambia el SEGUNDO domingo de marzo y el PRIMER domingo de
 * noviembre, a las 2 de la madrugada hora local. Las reglas estan desde 2007 y
 * no dependen del ano, asi que se calculan en vez de tabularse.
 */

/** Domingo numero `n` del mes, en UTC. */
function nthSundayUtc(year: number, month: number, n: number): number {
  const first = Date.UTC(year, month - 1, 1);
  const weekday = new Date(first).getUTCDay();
  const offsetToSunday = (7 - weekday) % 7;
  return first + (offsetToSunday + (n - 1) * 7) * 86_400_000;
}

/**
 * True si ese instante cae en horario de verano de Estados Unidos.
 *
 * El cambio ocurre a las 02:00 LOCALES, que son las 07:00 UTC al entrar (aun en
 * EST, UTC-5) y las 06:00 UTC al salir (todavia en EDT, UTC-4). Usar las 02:00
 * UTC en lugar de esas horas desplazaria el cambio cinco horas y clasificaria
 * mal la madrugada de los dos domingos del ano en que pasa.
 */
export function isUsDst(tsMs: number): boolean {
  const year = new Date(tsMs).getUTCFullYear();

  const start = nthSundayUtc(year, 3, 2) + 7 * 3600_000;
  const end = nthSundayUtc(year, 11, 1) + 6 * 3600_000;

  return tsMs >= start && tsMs < end;
}

/**
 * Desfase de Nueva York en ese instante: -4 en verano, -5 en invierno.
 *
 * `MARKET_UTC_OFFSET_HOURS` se mantiene como ANCLA de invierno configurable por
 * si algun dia se opera otro mercado: si vale -4 se entiende que describe el
 * verano y el invierno es una hora menos; cualquier otro valor se toma como la
 * hora estandar y se le suma una en verano.
 */
export function marketOffsetAt(tsMs: number): number {
  const standard = MARKET_UTC_OFFSET_HOURS === -4 ? -5 : MARKET_UTC_OFFSET_HOURS;
  return isUsDst(tsMs) ? standard + 1 : standard;
}
