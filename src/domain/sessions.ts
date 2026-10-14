import { MARKET_UTC_OFFSET_HOURS } from '../config.js';

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

/** Hora de mercado en decimal (9.5 = 09:30) a partir de un epoch en ms UTC. */
export function marketHour(tsMs: number): number {
  const d = new Date(tsMs + MARKET_UTC_OFFSET_HOURS * 3600_000);
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

/** Fecha de mercado en formato YYYY-MM-DD. */
export function marketDate(tsMs: number): string {
  const d = new Date(tsMs + MARKET_UTC_OFFSET_HOURS * 3600_000);
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
