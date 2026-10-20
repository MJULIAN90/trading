import { MARKET_DAY_ROLL_HOUR } from '../config.js';
import { marketOffsetAt } from './clock.js';

/**
 * Las mismas ventanas que dibuja el indicador KillZones en el grafico. Si las
 * cambias ahi, cambialas aqui: el valor de este diario depende de que lo que
 * mide sea exactamente lo que ves mientras operas.
 */
export const SESSIONS = [
  { name: 'ASIA', from: 20, to: 24 },
  { name: 'LONDON', from: 2, to: 5 },
  { name: 'NY_AM', from: 9.5, to: 11 },
  { name: 'NY_LUNCH', from: 12, to: 13 },
  { name: 'NY_PM', from: 13.5, to: 16 },
] as const;

export type SessionName = (typeof SESSIONS)[number]['name'] | 'OUTSIDE';

/**
 * Hora de mercado en decimal (9.5 = 09:30) a partir de un epoch en ms UTC.
 *
 * El desfase se calcula POR FECHA, no es una constante: Nueva York cambia dos
 * veces al ano y con un valor fijo las operaciones de invierno acabarian en la
 * killzone equivocada.
 */
export function marketHour(tsMs: number): number {
  const d = new Date(tsMs + marketOffsetAt(tsMs) * 3600_000);
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

/**
 * JORNADA de mercado en formato YYYY-MM-DD.
 *
 * Ojo: es la jornada, no la fecha del calendario. La sesion de futuros rueda a
 * las 18:00 de Nueva York (`MARKET_DAY_ROLL_HOUR`), asi que lo operado el lunes
 * por la noche cuenta como la jornada del martes — igual que lo cuentan el
 * mercado y la mesa de fondeo.
 *
 * Que el diario y la mesa cierren el dia a la misma hora es lo que hace que el
 * limite de perdida diaria del diario signifique algo. Con el corte anterior a
 * medianoche, el 32% de las operaciones caia en el dia equivocado.
 *
 * Se devuelve la fecha en la que TERMINA la jornada, que es como la nombran las
 * plataformas: la sesion que abre el lunes a las 18:00 es la del martes.
 */
export function marketDate(tsMs: number): string {
  const d = new Date(tsMs + marketOffsetAt(tsMs) * 3600_000);

  // A partir del corte, la operacion pertenece a la jornada siguiente.
  if (d.getUTCHours() >= MARKET_DAY_ROLL_HOUR)
    d.setUTCDate(d.getUTCDate() + 1);

  return d.toISOString().slice(0, 10);
}

/** La fecha del CALENDARIO, sin aplicar el corte de jornada. */
export function calendarDate(tsMs: number): string {
  const d = new Date(tsMs + marketOffsetAt(tsMs) * 3600_000);
  return d.toISOString().slice(0, 10);
}

/**
 * A que killzone pertenece un instante. ASIA cruza medianoche, asi que su
 * ventana se evalua aparte en lugar de con la comparacion normal.
 */
export function sessionOf(tsMs: number): SessionName {
  const h = marketHour(tsMs);

  for (const s of SESSIONS) {
    if (s.name === 'ASIA') {
      if (h >= s.from || h < 0) return 'ASIA';
      continue;
    }
    if (h >= s.from && h < s.to) return s.name;
  }

  return 'OUTSIDE';
}
