/**
 * EL RELOJ DE LA APLICACION, en un solo sitio.
 *
 * Dos relojes posibles, y el que manda se elige en Ajustes > Grafico:
 *
 *   LOCAL    el de este ordenador. Es el que marca Quantower en pantalla y el
 *            que tiene uno en la cabeza mientras opera. Por defecto.
 *   MERCADO  hora de Nueva York. Util para hablar con alguien de fuera o para
 *            comparar con una tabla de sesiones.
 *
 * Por que importa que se pueda elegir: Nueva York cambia de hora dos veces al
 * ano y Colombia no. De noviembre a marzo las dos coinciden; de marzo a
 * noviembre, el diario iba una hora por delante del reloj del PC sin que nada
 * en pantalla lo dijera, y una operacion de las 09:11 aparecia como las 10:11.
 *
 * LA ELECCION ES SOLO DE PRESENTACION. Las killzones, el corte de jornada a
 * las 18:00 y todas las metricas se siguen calculando en hora de mercado en el
 * servidor, que es donde tienen que calcularse. Aqui solo se decide con que
 * desfase se pinta un instante.
 *
 * El desfase de mercado se calcula POR FECHA. Esta logica esta duplicada del
 * servidor (src/domain/clock.ts) porque el cliente no comparte codigo con el,
 * y se prefiere la duplicacion a mandar un desfase fijo desde la API: con un
 * valor unico, un listado que cruce el cambio de hora mostraria la mitad de
 * las operaciones corridas una hora.
 */
const pad = (n: number) => String(n).padStart(2, '0');

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

export type Reloj = 'local' | 'mercado';

let reloj: Reloj = 'local';

export function setClock(modo: Reloj) {
  reloj = modo === 'mercado' ? 'mercado' : 'local';
}

export function getClock(): Reloj {
  return reloj;
}

/**
 * El desfase con el que se PINTA un instante, en horas.
 *
 * En local se pregunta por el instante concreto y no una sola vez: hay zonas
 * que cambian de hora, y `getTimezoneOffset` de "ahora" aplicado a una
 * operacion de hace tres meses la correria una hora. Colombia no cambia, pero
 * esto no tiene por que saberlo.
 */
export function displayOffsetAt(ts: number): number {
  return reloj === 'mercado' ? marketOffsetAt(ts) : -new Date(ts).getTimezoneOffset() / 60;
}

/** "NY" o "local", para poner al lado de una hora y que no haya duda. */
export function zonaCorta(): string {
  return reloj === 'mercado' ? 'NY' : 'local';
}

/** "hora de Nueva York" / "hora de este ordenador". Para textos largos. */
export function zonaLarga(): string {
  return reloj === 'mercado' ? 'hora de Nueva York' : 'hora de este ordenador';
}

/**
 * En que tramo de la sesion americana cayo un precio.
 *
 * Se mira SIEMPRE con el reloj de Nueva York, aunque la pantalla este en hora
 * local: los tramos los define el mercado, no el sitio desde donde se mira.
 * Lo que cambia con el reloj es la hora que se escribe al lado, no el tramo.
 *
 *   regular   09:30 a 16:00, la sesion de verdad
 *   pre       04:00 a 09:30
 *   post      16:00 a 20:00
 *   nocturno  el resto, cuando solo quedan los futuros
 *
 * Igual que `faseDeMercado` en el servidor. Duplicado por lo mismo que el
 * desfase: el cliente no comparte codigo, y mandar un valor calculado una vez
 * clasificaria mal cualquier precio que no fuera el de ese instante.
 */
export type FaseCotizacion = 'regular' | 'pre' | 'post' | 'nocturno' | 'finde' | 'desconocida';

export function faseDeCotizacion(ts: number | null): FaseCotizacion {
  if (ts === null) return 'desconocida';

  const ny = new Date(ts + marketOffsetAt(ts) * 3600_000);
  const dia = ny.getUTCDay();
  if (dia === 0 || dia === 6) return 'finde';

  const min = ny.getUTCHours() * 60 + ny.getUTCMinutes();
  if (min >= 570 && min < 960) return 'regular';
  if (min >= 240 && min < 570) return 'pre';
  if (min >= 960 && min < 1200) return 'post';
  return 'nocturno';
}

/** HH:MM de un instante, en el reloj activo. */
export function hora(ts: number): string {
  const d = new Date(ts + displayOffsetAt(ts) * 3600_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function dateTime(ts: number): string {
  const d = new Date(ts + displayOffsetAt(ts) * 3600_000);
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
