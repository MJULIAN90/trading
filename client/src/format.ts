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

/**
 * Una DISTANCIA en ticks, sin signo.
 *
 * Existe aparte de `ticks` por un motivo que costo una ronda de confusion: el
 * signo de `ticks` esta pensado para un RESULTADO, y pegado a un stop o a un
 * objetivo se lee como dinero ganado. Un stop de 167 ticks escrito "+167"
 * parece una ganancia. Una distancia no tiene signo.
 */
export const dist = (n: number) =>
  Math.abs(n).toLocaleString('es', { maximumFractionDigits: 1 });

export type Unit = 'ticks' | 'puntos' | 'dolares';

export const UNIT_LABEL: Record<Unit, string> = {
  ticks: 'ticks',
  puntos: 'puntos',
  dolares: '$ por contrato',
};

/**
 * Convierte una distancia en ticks a la unidad elegida y la escribe.
 *
 * El dinero es siempre por UN contrato. Multiplicar por el tamano de la
 * posicion es decision de quien lee, y meterlo aqui volveria a esconder la
 * unidad, que es justo lo que se quiere evitar.
 */
export function inUnit(t: number, unit: Unit, tickSize: number, tickValue: number): string {
  if (unit === 'puntos')
    return (Math.abs(t) * tickSize).toLocaleString('es', { maximumFractionDigits: 2 });
  if (unit === 'dolares')
    return (Math.abs(t) * tickValue).toLocaleString('es', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return dist(t);
}

/** Lo mismo, pero conservando el signo: para resultados y esperanzas. */
export function signedInUnit(t: number, unit: Unit, tickSize: number, tickValue: number): string {
  const sign = t > 0 ? '+' : t < 0 ? '-' : '';
  return `${sign}${inUnit(t, unit, tickSize, tickValue)}`;
}

/**
 * Dinero, siempre con la unidad escrita.
 *
 * El diario trabaja en dolares por contrato porque es lo que devuelve el
 * broker. Un "-64" suelto no dice si son dolares, ticks o puntos: tu lo sabes,
 * cualquier otro que mire la pantalla no, y en MNQ la diferencia entre leerlo
 * como ticks o como dolares es un factor de dos.
 */
export const usd = (n: number, d = 2) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('es', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;

/** Igual, pero con el signo siempre delante. Para variaciones. */
export const signedUsd = (n: number, d = 2) =>
  `${n > 0 ? '+' : n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('es', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;

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
