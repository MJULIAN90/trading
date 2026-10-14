/**
 * Todas las horas se formatean con el desfase de mercado, nunca con la zona del
 * navegador: lo que se ve aqui tiene que coincidir con lo que marcaba el grafico
 * de Quantower mientras operabas.
 */
let marketOffsetHours = -4;

export function setMarketOffset(hours: number) {
  marketOffsetHours = hours;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dateTime(ts: number): string {
  const d = new Date(ts + marketOffsetHours * 3600_000);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function date(ts: number): string {
  return dateTime(ts).slice(0, 5);
}

export const num = (n: number, d = 2) =>
  n.toLocaleString('es', { minimumFractionDigits: d, maximumFractionDigits: d });

export const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

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
