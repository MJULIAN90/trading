/**
 * Todas las horas se formatean con el desfase de mercado, nunca con la zona del
 * navegador: lo que se ve aqui tiene que coincidir con lo que marcaba el grafico
 * de Quantower mientras operabas.
 *
 * El desfase se calcula POR FECHA. Esta logica esta duplicada del servidor
 * (src/domain/clock.ts) porque el cliente no comparte codigo con el, y se
 * prefiere la duplicacion a mandar un desfase fijo desde la API: con un valor
 * unico, un listado que cruce el cambio de hora mostraria la mitad de las
 * operaciones corridas una hora.
 */
let marketStandardOffset = -5;

/** Ancla de invierno. Un -4 se interpreta como "describe el verano". */
export function setMarketOffset(hours: number) {
  marketStandardOffset = hours === -4 ? -5 : hours;
}

function nthSundayUtc(year: number, month: number, n: number): number {
  const first = Date.UTC(year, month - 1, 1);
  const offsetToSunday = (7 - new Date(first).getUTCDay()) % 7;
  return first + (offsetToSunday + (n - 1) * 7) * 86_400_000;
}

/** Segundo domingo de marzo a primer domingo de noviembre, a las 02:00 locales. */
function isUsDst(ts: number): boolean {
  const year = new Date(ts).getUTCFullYear();
  return ts >= nthSundayUtc(year, 3, 2) + 7 * 3600_000 && ts < nthSundayUtc(year, 11, 1) + 6 * 3600_000;
}

export function marketOffsetAt(ts: number): number {
  return isUsDst(ts) ? marketStandardOffset + 1 : marketStandardOffset;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dateTime(ts: number): string {
  const d = new Date(ts + marketOffsetAt(ts) * 3600_000);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function date(ts: number): string {
  return dateTime(ts).slice(0, 5);
}

export const num = (n: number, d = 2) =>
  n.toLocaleString('es', { minimumFractionDigits: d, maximumFractionDigits: d });

export const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/**
 * Ticks con signo explicito. El signo importa mas que en los dolares: un "+12"
 * y un "12" se leen distinto de un vistazo cuando estas repasando una lista.
 */
export const ticks = (n: number) =>
  `${n > 0 ? '+' : ''}${n.toLocaleString('es', { maximumFractionDigits: 1 })}`;

export const signClass = (n: number) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export const SESSION_LABEL: Record<string, string> = {
  ASIA: 'Asia',
  LONDON: 'Londres',
  NY_AM: 'NY AM',
  NY_LUNCH: 'NY Lunch',
  NY_PM: 'NY PM',
  OUTSIDE: 'Fuera',
};

export const sessionLabel = (s: string) => SESSION_LABEL[s] ?? s;
