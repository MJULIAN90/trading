/**
 * Cuando presenta resultados cada empresa, y como fue el ultimo que presento.
 *
 * ESTO VIVE APARTE DE `global.ts` A PROPOSITO. Alli los resultados son una
 * columna mas de la tabla de acciones: informacion de fondo. Aqui son otra
 * cosa: un instante concreto que dispara una alarma con sonido. Un numero que
 * te saca un modal a la cara tiene que poder explicarse entero, y por eso el
 * calculo de la hora esta escrito con su convencion a la vista en vez de
 * escondido en una consulta.
 *
 * LA HORA NO LA DA NADIE. Ni Alpha Vantage ni Finnhub publican el minuto: dan
 * el dia y, como mucho, `bmo` (antes de abrir) o `amc` (despues de cerrar).
 * Asi que la hora de aqui es UNA CONVENCION, no un dato, y se enseña siempre
 * marcada como tal. Inventar un minuto y pintarlo como si lo hubiera dicho la
 * empresa seria exactamente el tipo de cifra que este proyecto no se permite.
 */
import { db } from '../db/index.js';
import { marketOffsetAt } from './clock.js';

export interface EarningsSettings {
  /** Hora de Nueva York para `amc`, "despues del cierre". HH:MM. */
  amcHour: string;
  /** Hora de Nueva York para `bmo`, "antes de la apertura". HH:MM. */
  bmoHour: string;
}

/**
 * 16:30 y 08:30, hora de Nueva York.
 *
 * El mercado cierra a las 16:00 y abre a las 09:30. Las empresas que presentan
 * despues del cierre suelen soltarlo en la media hora siguiente, y las que
 * presentan antes de abrir, alrededor de una hora antes. Son los valores que
 * menos sorprenden, no una medicion.
 */
export const DEFAULT_EARNINGS: EarningsSettings = { amcHour: '16:30', bmoHour: '08:30' };

const KEY = 'earnings_settings';
const KEY_HORAS = 'earnings_hours';

export interface HoraMedida {
  /** HH:MM de Nueva York. Mediana de los ultimos informes. */
  hhmm: string;
  /** Cuantos informes entraron en la mediana. */
  n: number;
  /** "16:03-16:13": entre que horas se movieron esos n. */
  rango: string;
}

/**
 * LA HORA REAL DE CADA EMPRESA, MEDIDA. Ya no es una convencion.
 *
 * Sale de la API publica de la SEC: cada 8-K con el item 2.02 -"Results of
 * Operations and Financial Condition"- lleva un `acceptanceDateTime` con el
 * segundo exacto en que el documento entro en EDGAR. Mediana de los seis
 * ultimos de cada empresa, medido el 31 de octubre de 2026.
 *
 * LO QUE DESTAPO, Y NO ERA UN DETALLE. La convencion unica de las 16:30 era
 * correcta SOLO para Apple. Las demas publican pegadas al cierre:
 *
 *   GOOGL 16:01   MU 16:02   MSFT 16:04   META 16:05
 *   AMZN  16:13   TSLA 16:13   AMD 16:16   NVDA 16:21   AAPL 16:30
 *
 * Con las 16:30 para todas, la alarma de "faltan 15 minutos" sonaba a las
 * 16:15: DESPUES de que Google, Micron, Microsoft y Meta hubieran publicado
 * ya. El aviso llegaba tarde justo en las cuatro que mas pegadas van al
 * cierre, y nada en pantalla lo decia.
 *
 * Se vuelve a medir con `node scripts/medir-horas-resultados.mjs`, que guarda
 * el resultado en `meta` y manda sobre esta tabla. Esto es la foto de partida
 * para quien instale el diario sin haberlo ejecutado nunca.
 */
export const HORA_MEDIDA: Record<string, HoraMedida> = {
  AAPL: { hhmm: '16:30', n: 6, rango: '16:30-16:30' },
  AMD: { hhmm: '16:16', n: 6, rango: '16:16-16:16' },
  AMZN: { hhmm: '16:13', n: 6, rango: '16:05-16:25' },
  GOOG: { hhmm: '16:01', n: 6, rango: '16:01-16:01' },
  GOOGL: { hhmm: '16:01', n: 6, rango: '16:01-16:01' },
  META: { hhmm: '16:05', n: 6, rango: '16:03-16:13' },
  MSFT: { hhmm: '16:04', n: 6, rango: '16:03-16:08' },
  MU: { hhmm: '16:02', n: 6, rango: '16:02-16:03' },
  NVDA: { hhmm: '16:21', n: 6, rango: '16:20-16:31' },
  TSLA: { hhmm: '16:13', n: 6, rango: '16:06-16:41' },
};

/**
 * La tabla que manda: lo que haya guardado el script, y si no, la foto de
 * arriba. Una sola fuente para toda la aplicacion.
 */
export function horasMedidas(): Record<string, HoraMedida> {
  const row = db().prepare('SELECT value FROM meta WHERE key = ?').get(KEY_HORAS) as
    | { value: string }
    | undefined;
  if (!row) return HORA_MEDIDA;

  try {
    const guardado = JSON.parse(row.value) as Record<string, HoraMedida>;
    // Mezcla y no sustitucion: si el script midio ocho empresas, las dos que
    // falten siguen teniendo su hora en vez de caer a la convencion.
    return { ...HORA_MEDIDA, ...guardado };
  } catch {
    return HORA_MEDIDA;
  }
}

/** HH:MM valido, o el que ya habia. */
function hora(valor: unknown, actual: string): string {
  const s = String(valor ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return actual;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return actual;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export function getEarningsSettings(): EarningsSettings {
  const row = db().prepare('SELECT value FROM meta WHERE key = ?').get(KEY) as
    | { value: string }
    | undefined;
  if (!row) return { ...DEFAULT_EARNINGS };

  try {
    const parsed = JSON.parse(row.value) as Partial<EarningsSettings>;
    return {
      amcHour: hora(parsed.amcHour, DEFAULT_EARNINGS.amcHour),
      bmoHour: hora(parsed.bmoHour, DEFAULT_EARNINGS.bmoHour),
    };
  } catch {
    return { ...DEFAULT_EARNINGS };
  }
}

export function setEarningsSettings(next: Partial<EarningsSettings>): EarningsSettings {
  const actual = getEarningsSettings();
  const guardar: EarningsSettings = {
    amcHour: hora(next.amcHour, actual.amcHour),
    bmoHour: hora(next.bmoHour, actual.bmoHour),
  };

  db()
    .prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    )
    .run(KEY, JSON.stringify(guardar));

  return guardar;
}

/**
 * El instante en que se espera el informe, en epoch ms.
 *
 * Dos pasadas por el desfase de Nueva York y no una. El 1 de noviembre de 2026
 * Nueva York pasa de UTC-4 a UTC-5, y AAPL presenta el 2: con el desfase de
 * HOY el aviso saldria una hora corrido. La primera pasada situa la fecha
 * aproximadamente para preguntar el desfase correcto, la segunda convierte.
 */
export function momentoDe(
  date: string,
  when: string | null,
  settings: EarningsSettings = getEarningsSettings(),
  symbol?: string,
  medidas: Record<string, HoraMedida> = horasMedidas(),
): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!d) return null;

  const etiqueta = (when ?? '').toLowerCase();
  const esBmo = etiqueta.includes('bmo');

  // La hora MEDIDA manda, pero solo para "despues del cierre". De las que
  // publican antes de abrir no hay medicion -ninguna de sus diez lo hace-, asi
  // que ahi sigue valiendo la convencion y se dice que es una convencion.
  const medida = symbol !== undefined && !esBmo ? medidas[symbol] : undefined;
  const reloj = medida ? medida.hhmm : esBmo ? settings.bmoHour : settings.amcHour;
  const [hh, mm] = reloj.split(':').map(Number) as [number, number];

  const comoSiFueraUtc = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), hh, mm);
  const aproximado = comoSiFueraUtc - marketOffsetAt(comoSiFueraUtc) * 3_600_000;
  return comoSiFueraUtc - marketOffsetAt(aproximado) * 3_600_000;
}

export interface Cita {
  symbol: string;
  name: string;
  date: string;
  /** 'amc', 'bmo' o null tal como lo dio el proveedor. */
  when: string | null;
  /** Instante esperado, epoch ms. */
  at: number;
  /** "16:30" en hora de Nueva York. */
  hhmm: string;
  /**
   * Null cuando la hora sale de una medicion de EDGAR; el objeto dice de
   * cuantos informes y con que dispersion. Cuando es null, la hora es la
   * convencion de Ajustes y la pantalla tiene que decirlo.
   */
  medido: HoraMedida | null;
  /** Milisegundos que faltan. Negativo si ya paso. */
  faltaMs: number;
  epsEstimate: number | null;
}

export interface Sorpresa {
  symbol: string;
  name: string;
  date: string;
  epsEstimate: number;
  epsActual: number;
  /** Diferencia en porcentaje sobre lo esperado. Negativo = por debajo. */
  desvioPct: number;
  fallo: boolean;
}

interface Fila {
  symbol: string;
  name: string;
  date: string;
  when: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
}

/** YYYY-MM-DD de un instante, en hora de Nueva York. */
function diaDe(tsMs: number): string {
  return new Date(tsMs + marketOffsetAt(tsMs) * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Las filas entre dos dias, calculados en JavaScript y NO con `date('now')`.
 *
 * Con `date('now')` la consulta mira el reloj del sistema y se desentiende del
 * instante que le pasan, asi que la funcion no se puede probar con una fecha
 * fija: la prueba mete datos alrededor de un martes de octubre y la base le
 * contesta con la ventana de hoy. Se descubrio asi, con los tres primeros
 * casos de `prueba-resultados.ts` en rojo.
 */
function filas(desde: string, hasta: string): Fila[] {
  return db()
    .prepare(
      `SELECT symbol, name, date, when_ AS "when",
              eps_estimate AS epsEstimate, eps_actual AS epsActual
         FROM global_earnings
        WHERE date >= ? AND date <= ?
        ORDER BY date, symbol`,
    )
    .all(desde, hasta) as Fila[];
}

/**
 * Quien presenta dentro de los proximos `dias`.
 *
 * LA VENTANA VA POR DIAS DE CALENDARIO, no por horas, y es deliberado. Con una
 * ventana de 72 horas justas, una empresa que presenta "dentro de 3 dias" a
 * las 16:30 no aparece hasta las 16:30 de hoy: por la mañana no esta, por la
 * tarde si, y el panel contradice lo que uno cuenta con los dedos mirando un
 * calendario. "Presenta pasado mañana" es lo que se piensa, asi que es lo que
 * se filtra. La hora exacta manda para la cuenta atras y para las alarmas,
 * que es donde hace falta precision.
 *
 * Se siguen enseñando las de las ultimas horas: a las 17:00, que NVIDIA haya
 * presentado hace cuarenta minutos es justo lo que explica la vela que tienes
 * delante.
 */
export function agenda(dias = 3, ahora = Date.now()): Cita[] {
  const settings = getEarningsSettings();
  const medidas = horasMedidas();
  const hoy = diaDe(ahora);
  const suelo = ahora - 4 * 3_600_000;

  const salida: Cita[] = [];

  for (const f of filas(hoy, diaDe(ahora + dias * 86_400_000))) {
    const at = momentoDe(f.date, f.when, settings, f.symbol, medidas);
    if (at === null || at < suelo) continue;

    const esBmo = (f.when ?? '').toLowerCase().includes('bmo');
    const medido = esBmo ? null : (medidas[f.symbol] ?? null);

    const ny = new Date(at + marketOffsetAt(at) * 3_600_000);
    salida.push({
      symbol: f.symbol,
      name: f.name,
      date: f.date,
      when: f.when,
      at,
      hhmm: `${String(ny.getUTCHours()).padStart(2, '0')}:${String(ny.getUTCMinutes()).padStart(2, '0')}`,
      medido,
      faltaMs: at - ahora,
      epsEstimate: f.epsEstimate,
    });
  }

  return salida.sort((a, b) => a.at - b.at);
}

/**
 * Como salieron los resultados de los ultimos dias: lo presentado contra lo
 * esperado.
 *
 * Solo entra lo que YA presento, y "ya presento" es que la fecha haya pasado,
 * no que `epsActual` traiga algo. El proveedor rellena ese campo con 0 cuando
 * todavia no hay dato, y un cero leido como resultado convierte a cualquier
 * empresa que aun no ha presentado en un desplome del 100 %. Es el tipo de
 * fallo que no se nota hasta que suena una alarma por nada.
 */
export function sorpresas(dias = 3, ahora = Date.now()): Sorpresa[] {
  const hoy = diaDe(ahora);

  const salida: Sorpresa[] = [];

  for (const f of filas(diaDe(ahora - dias * 86_400_000), hoy)) {
    if (f.date > hoy) continue;
    if (f.epsEstimate === null || f.epsActual === null) continue;
    if (f.epsEstimate === 0) continue;

    // Sobre el valor absoluto de lo esperado: con una estimacion negativa
    // -una empresa que se esperaba en perdidas-, dividir por el numero con su
    // signo le da la vuelta a la lectura y un resultado mejor saldria en rojo.
    const desvio = ((f.epsActual - f.epsEstimate) / Math.abs(f.epsEstimate)) * 100;

    salida.push({
      symbol: f.symbol,
      name: f.name,
      date: f.date,
      epsEstimate: f.epsEstimate,
      epsActual: f.epsActual,
      desvioPct: Number(desvio.toFixed(1)),
      fallo: f.epsActual < f.epsEstimate,
    });
  }

  return salida.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export interface EarningsReport {
  now: number;
  agenda: Cita[];
  sorpresas: Sorpresa[];
  settings: EarningsSettings;
}

export function earningsReport(dias = 3): EarningsReport {
  const now = Date.now();
  return { now, agenda: agenda(dias, now), sorpresas: sorpresas(dias, now), settings: getEarningsSettings() };
}
