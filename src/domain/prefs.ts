import { db } from '../db/index.js';

/**
 * Preferencias de presentacion: lo que cada quien quiere ver y de que color.
 *
 * Van en la base y no en el `.env` por una razon concreta: el `.env` lo lee el
 * servidor al arrancar, asi que cambiar un color obligaria a editar un fichero
 * y reiniciar. Esto se cambia desde la pantalla, se guarda al momento y
 * sobrevive al reinicio. Es la primera pieza del panel de ajustes.
 *
 * Son preferencias, NO datos de trading. Nada de lo que hay aqui cambia una
 * metrica: si manana se borra el registro entero, se vuelve a los valores por
 * defecto y ninguna cifra del diario se mueve. Por eso puede vivir en `meta`
 * con el resto de la configuracion y no necesita tabla propia.
 */

export interface EmaSetting {
  period: number;
  color: string;
  /** Se dibuja o no. Se guarda apagada en vez de borrarla, para recuperarla. */
  on: boolean;
}

export interface ChartPrefs {
  /** Temporalidad por defecto al abrir una operacion, en minutos. */
  timeframe: number;
  /** Cuantas velas se ensenan de entrada. */
  candles: number;
  /** Que parte de esas velas va ANTES de la entrada, de 0 a 1. */
  beforeShare: number;
  emas: EmaSetting[];
  showSessions: boolean;

  /**
   * Aire arriba del grafico, de 0 a 1. 0,08 son ocho centesimas de la altura.
   */
  marginTop: number;

  /**
   * Altura que ocupa el delta abajo, de 0 a 1.
   *
   * Es UN solo numero para las dos cosas a proposito: el margen inferior de la
   * escala de precio y la banda del delta valen lo mismo, asi que encajan sin
   * hueco. Antes eran dos ajustes sueltos (0,34 de margen y 0,18 de banda) y el
   * 16% de diferencia era espacio muerto en mitad del grafico.
   */
  deltaShare: number;

  /**
   * Margen DERECHO en velas: el hueco entre la ULTIMA VELA y el eje de precio.
   *
   * Es un tope real, no una sugerencia. El rango visible se recorta para que
   * nunca pase de (ultima vela + este margen). Sin ese recorte el hueco lo
   * decidia entryShare: la ventana se centraba en la entrada y, si la operacion
   * caia cerca del final de los datos, lo que sobraba se dibujaba vacio sin que
   * ningun ajuste pudiera tocarlo.
   */
  rightOffset: number;

  /**
   * Donde cae la entrada dentro de la ventana visible, de 0 a 1.
   *
   * Estaba clavado en 0,55 y es la causa real del hueco grande de la derecha:
   * con la entrada al 55%, la ventana se extiende un 45% MAS ALLA de la
   * entrada, y si la operacion cae cerca del final de los datos ese 45% se
   * dibuja vacio. Subirlo empuja la entrada a la derecha y recorta el hueco.
   */
  entryShare: number;

  /**
   * Etiquetas que se ofrecen con un clic al anotar una operacion.
   *
   * Viven aqui y no en el codigo porque son TUYAS: las conductas que quieres
   * vigilar cambian conforme aprendes, y una lista clavada obliga a recompilar
   * para anadir una. Las etiquetas ya puestas en operaciones no dependen de
   * esta lista: quitar una de aqui solo deja de sugerirla, no borra nada.
   */
  noteTags: string[];

  /**
   * Si cada etiqueta describe una conducta BUENA o MALA, segun el.
   *
   * Lo que no esta aqui es neutro, y eso es a proposito: la mayoria de las
   * etiquetas describen un hecho ("entrada con fibo") que todavia no se sabe
   * si suma o resta.
   *
   * ESTO ES UNA HIPOTESIS, NO UN DATO. Es lo que el cree hoy. Lo que de verdad
   * sumo o resto cada etiqueta sale de `tagImpact()`, de sus operaciones, y las
   * dos cosas se guardan por separado a proposito: la pregunta "¿en que me
   * equivoco al juzgar mis propias conductas?" solo se puede contestar si la
   * creencia y la medida no se han mezclado antes. Este proyecto ya ha visto
   * tres veces que la intuicion y los numeros no coincidian.
   */
  tagPolarity: Record<string, TagPolarity>;

  /**
   * De que EJE habla cada etiqueta. Ausente = conducta.
   *
   * Tres cosas que no estaban en el mismo eje y estaban en la misma lista:
   *
   *   estrategia — que clase de operacion era (scalper, rango, tendencia).
   *                La eliges tu ANTES de entrar. No es buena ni mala.
   *   contexto   — que habia en el mercado (manipulacion, vela sin patron).
   *                Te lo encuentras, no lo decides. Tampoco es bueno ni malo.
   *   conducta   — que hiciste tu dentro de eso. LA UNICA con polaridad.
   *
   * Separarlas no es orden: es lo que permite la pregunta de dos entradas,
   * que es la util. "Dentro de scalper, ¿mover el stop me cuesta dinero?"
   * Con un solo eje esa pregunta no se puede ni formular, porque estrategia y
   * conducta competirian por la misma casilla.
   */
  tagKind: Record<string, TagKind>;
}

/** Como califica el una etiqueta. Ausente = neutra. Solo aplica a conducta. */
export type TagPolarity = 'buena' | 'mala';

/** De que habla la etiqueta. Ausente = conducta. */
export type TagKind = 'estrategia' | 'contexto' | 'conducta';

export const DEFAULT_CHART: ChartPrefs = {
  timeframe: 1,
  candles: 180,
  // Dos tercios antes y uno despues: al revisar interesa mas como se llego a la
  // entrada que lo que paso luego, pero hace falta ver el desenlace.
  beforeShare: 0.66,
  emas: [
    { period: 8, color: '#2ecc71', on: true },
    { period: 21, color: '#5aaaff', on: true },
    { period: 55, color: '#f1c40f', on: true },
    { period: 200, color: '#e74c3c', on: true },
  ],
  showSessions: true,
  marginTop: 0.08,
  deltaShare: 0.18,
  rightOffset: 6,
  entryShare: 0.70,
  noteTags: [
    'entre tarde',
    'entre pronto',
    'movi el stop',
    'sin stop',
    'revancha',
    'contra el flujo',
    'fuera de plan',
    'sali pronto',
    'aguante de mas',
    'tamano de mas',
  ],
  // Las de serie describen fallos de ejecucion, asi que arrancan en "mala".
  // Aun asi son hipotesis: si alguna resulta no costar dinero, el dato manda.
  tagPolarity: {
    'entre tarde': 'mala',
    'entre pronto': 'mala',
    'movi el stop': 'mala',
    'sin stop': 'mala',
    revancha: 'mala',
    'contra el flujo': 'mala',
    'fuera de plan': 'mala',
    'sali pronto': 'mala',
    'aguante de mas': 'mala',
    'tamano de mas': 'mala',
  },
  // Las de serie son todas conducta, asi que el mapa arranca vacio: lo que no
  // esta aqui se trata como conducta. Las de estrategia y contexto las marca
  // el, porque solo el sabe cual es cual en su forma de operar.
  tagKind: {},
};

const KEY = 'chart_prefs';

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/**
 * Etiquetas limpias: texto, recortado, en minusculas, sin repetidos y acotado.
 *
 * Se normaliza igual que al anadirlas desde la pantalla de notas (trim +
 * minusculas). Si no, "Revancha" y "revancha" contarian como dos conductas
 * distintas en los agrupados y cada una tendria la mitad de los casos.
 */
function tagsOr(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_CHART.noteTags];

  const out: string[] = [];

  for (const raw of value) {
    if (typeof raw !== 'string') continue;

    const clean = raw.trim().toLowerCase().slice(0, 40);
    if (!clean || out.includes(clean)) continue;

    out.push(clean);
    if (out.length >= 40) break;
  }

  // Una lista vacia a proposito es valida: puede que no quiera sugerencias.
  return out;
}

/**
 * Polaridades limpias: misma normalizacion de nombre que `tagsOr`.
 *
 * Si la etiqueta se guarda en minusculas en un sitio y con mayusculas en otro,
 * el color no aparece y no hay forma de saber por que. Aqui pasa lo mismo que
 * con los nombres: una sola forma de escribirlos o nada cuadra.
 */
function polarityOr(value: unknown): Record<string, TagPolarity> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_CHART.tagPolarity };
  }

  const out: Record<string, TagPolarity> = {};

  for (const [raw, v] of Object.entries(value as Record<string, unknown>)) {
    const clean = raw.trim().toLowerCase().slice(0, 40);
    if (!clean) continue;
    if (v === 'buena' || v === 'mala') out[clean] = v;
    // Cualquier otra cosa se descarta en vez de guardarse: lo que no es buena
    // ni mala es neutra, y neutra se representa NO estando.
  }

  return out;
}

/** Mismo criterio que `polarityOr`: lo que no se entiende se descarta. */
function kindOr(value: unknown): Record<string, TagKind> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const out: Record<string, TagKind> = {};

  for (const [raw, v] of Object.entries(value as Record<string, unknown>)) {
    const clean = raw.trim().toLowerCase().slice(0, 40);
    if (!clean) continue;
    // "conducta" NO se guarda: es el valor por defecto, y guardarlo llenaria
    // el fichero de ruido que ademas habria que mantener al renombrar.
    if (v === 'estrategia' || v === 'contexto') out[clean] = v;
  }

  return out;
}

/** Solo colores en notacion #rrggbb. Lo que venga en el registro es texto que acaba en un atributo de estilo. */
function colorOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

/** Temporalidades que se ofrecen, en minutos. */
export const TIMEFRAMES = [1, 5, 15, 60, 240] as const;

export function getChartPrefs(): ChartPrefs {
  const row = db().prepare('SELECT value FROM meta WHERE key = ?').get(KEY) as
    | { value: string }
    | undefined;

  if (!row) return structuredClone(DEFAULT_CHART);

  try {
    const raw = JSON.parse(row.value) as Partial<ChartPrefs>;

    // Se valida campo a campo en vez de confiar en lo guardado: un JSON
    // escrito por una version anterior, o a mano, no tiene por que cuadrar con
    // la forma de hoy, y un color invalido o un periodo negativo rompen el
    // grafico entero en el navegador.
    const emas = Array.isArray(raw.emas)
      ? raw.emas
          .map((e, i) => ({
            period: Math.round(clamp(e?.period, 1, 1000, DEFAULT_CHART.emas[i]?.period ?? 20)),
            color: colorOr(e?.color, DEFAULT_CHART.emas[i]?.color ?? '#9aa3b2'),
            on: e?.on !== false,
          }))
          .slice(0, 8)
      : structuredClone(DEFAULT_CHART.emas);

    const tf = Math.round(clamp(raw.timeframe, 1, 1440, DEFAULT_CHART.timeframe));

    return {
      timeframe: (TIMEFRAMES as readonly number[]).includes(tf) ? tf : DEFAULT_CHART.timeframe,
      candles: Math.round(clamp(raw.candles, 20, 1000, DEFAULT_CHART.candles)),
      beforeShare: clamp(raw.beforeShare, 0.1, 0.9, DEFAULT_CHART.beforeShare),
      emas,
      showSessions: raw.showSessions !== false,
      marginTop: clamp(raw.marginTop, 0, 0.4, DEFAULT_CHART.marginTop),
      deltaShare: clamp(raw.deltaShare, 0.05, 0.45, DEFAULT_CHART.deltaShare),
      rightOffset: Math.round(clamp(raw.rightOffset, 0, 300, DEFAULT_CHART.rightOffset)),
      entryShare: clamp(raw.entryShare, 0.2, 0.95, DEFAULT_CHART.entryShare),
      noteTags: tagsOr(raw.noteTags),
      tagPolarity: polarityOr(raw.tagPolarity),
      tagKind: kindOr(raw.tagKind),
    };
  } catch {
    return structuredClone(DEFAULT_CHART);
  }
}

export function setChartPrefs(patch: Partial<ChartPrefs>): ChartPrefs {
  const next = { ...getChartPrefs(), ...patch };

  db()
    .prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    )
    .run(KEY, JSON.stringify(next));

  // Se devuelve pasado otra vez por el validador, no el objeto que acabamos de
  // escribir: asi la pantalla ve exactamente lo mismo que vera al recargar, y
  // un valor que el validador recorta se nota al momento y no manana.
  return getChartPrefs();
}
