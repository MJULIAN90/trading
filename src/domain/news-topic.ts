import { COMPANY_NAMES, MARKET_TICKERS } from '../config.js';

/**
 * De que va cada titular, para poder tirar el resto.
 *
 * EL PROBLEMA. El canal general de Finnhub no es un canal financiero: es el
 * canal de todo. En una captura real de catorce titulares habia dos que podian
 * mover el Nasdaq y doce que no -un rescate de marineros en Sri Lanka, una
 * iglesia en Jordania, y la CNBC contando como alguien pago once mil dolares
 * de tarjeta de credito-. Una lista asi no se lee: se baja con la rueda hasta
 * que dejas de abrir la pestaña.
 *
 * LA FORMA DE FILTRAR IMPORTA. Hay dos maneras y una esta mal:
 *
 *   PROHIBIR lo que no interesa. Se escribe en cinco minutos y falla para
 *   siempre: cada lista de palabras prohibidas acaba tragandose una noticia
 *   que si importaba, y nunca te enteras, porque lo que desaparece no deja
 *   rastro.
 *
 *   EXIGIR que hable de algo tuyo. Es lo que se hace aqui. Un titular entra si
 *   menciona una de tus empresas o una palabra de mercado; si no, se queda en
 *   "otra". Lo que se pierde se pierde por no haber dicho nada reconocible, y
 *   eso es revisable: cambias la lista y vuelve a entrar. Ademas nada se
 *   borra, solo deja de salir por defecto.
 *
 * TRES GRUPOS:
 *   empresa  habla de una de tus diez (por ticker, por nombre o porque el
 *            proveedor ya la etiqueto)
 *   macro    habla del terreno: tipos, inflacion, bonos, petroleo, el indice,
 *            o del ciclo de la IA y los chips, que es lo que mueve al Nasdaq
 *   otra     no dijo nada de lo anterior
 */

export type Topic = 'empresa' | 'macro' | 'otra';

/**
 * Palabras que hacen que un titular sea de mercado.
 *
 * Estan en ingles porque los dos proveedores publican en ingles. Van en
 * minusculas y sin tildes; el texto se normaliza igual antes de comparar.
 *
 * Agrupadas por lo que cubren, que es lo que hace falta para revisarlas:
 */
const MACRO = [
  // Banco central y tipos: lo que mueve todo lo demas
  'fed', 'fomc', 'powell', 'central bank', 'ecb', 'boj',
  'interest rate', 'rate cut', 'rate hike', 'rate decision', 'basis points',

  // Datos macro
  'inflation', 'cpi', 'ppi', 'pce', 'payroll', 'jobs report', 'unemployment',
  'jobless', 'gdp', 'recession', 'consumer confidence', 'retail sales',

  // Bonos y divisa: las dos series de tu panel
  'treasury', 'yield', 'bond market', 'bonds', '10-year', '30-year',
  'dollar index', 'debt ceiling',

  // Petroleo: las otras dos series de tu panel
  'oil', 'crude', 'brent', 'wti', 'opec', 'barrel', 'refinery',

  // Indices y bolsa, que es donde operas
  'nasdaq', 's&p', 'dow jones', 'wall street', 'stock market', 'stocks',
  'equities', 'futures', 'premarket', 'pre-market', 'selloff', 'sell-off',
  'rally', 'volatility', 'vix', 'bear market', 'bull market',
  'earnings season', 'earnings report', 'guidance',

  // El ciclo que de verdad mueve al Nasdaq ahora mismo
  'ai trade', 'ai spending', 'ai capex', 'ai funding', 'artificial intelligence',
  'semiconductor', 'chipmaker', 'chip stocks', 'data center', 'cloud spending',

  // Politica economica con efecto directo en el precio
  'tariff', 'trade war', 'sanctions on', 'export controls', 'government shutdown',
];

/** Añade palabras sin tocar el codigo: NEWS_KEYWORDS=biotech,litio */
const EXTRA = (process.env.NEWS_KEYWORDS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const CLAVES = [...MACRO, ...EXTRA];

const plano = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Nombres por los que se reconoce a cada empresa en un titular.
 *
 * El nombre completo se recorta a su primera palabra -"Advanced Micro Devices"
 * pasa a "advanced"- no: eso daria falsos positivos a mansalva. Se usa el
 * nombre entero y, aparte, el ticker con limites de palabra.
 */
const NOMBRES = MARKET_TICKERS.map((ticker) => ({
  ticker,
  // "Alphabet (A)" y "Alphabet (C)" se quedan en "alphabet".
  nombre: plano(COMPANY_NAMES[ticker] ?? ticker).replace(/\s*\(.*\)\s*/g, '').trim(),
  // Pares, no dos listas sueltas: un `.filter()` sobre una de ellas
  // desalinearia los indices y "Apple" acabaria marcando a Micron.
})).filter((x) => x.nombre.length >= 4);

/**
 * El ticker, buscado con limites de palabra.
 *
 * Sin los limites, "MU" aparece dentro de "museum", "communication" y
 * "mutual", y AMD dentro de cualquier palabra que lo lleve. Con 359
 * operaciones de MNQ a la espalda, una noticia de museos etiquetada como
 * Micron no es gracioso: es exactamente el ruido que esto viene a quitar.
 */
const TICKERS = MARKET_TICKERS.map((t) => ({
  ticker: t,
  re: new RegExp(`\\b${t.toLowerCase()}\\b`),
}));

export interface Clasificacion {
  topic: Topic;
  /** Simbolos reconocidos en el texto, separados por comas. null si ninguno. */
  symbols: string | null;
}

export function clasificar(
  headline: string,
  summary: string | null,
  symbols: string | null,
): Clasificacion {
  // El resumen cuenta para reconocer de que va, pero el titular manda: se mira
  // todo junto porque un titular corto a veces no nombra la empresa y el
  // resumen si.
  const texto = plano(`${headline} ${summary ?? ''}`);

  // Los que ya venian etiquetados por el proveedor se respetan tal cual.
  const yaEtiquetados = (symbols ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const encontrados = new Set(yaEtiquetados);
  for (const { ticker, re } of TICKERS) if (re.test(texto)) encontrados.add(ticker);
  for (const { ticker, nombre } of NOMBRES) if (texto.includes(nombre)) encontrados.add(ticker);

  if (encontrados.size > 0)
    return { topic: 'empresa', symbols: [...encontrados].sort().join(', ') };

  if (CLAVES.some((k) => texto.includes(k))) return { topic: 'macro', symbols: null };

  return { topic: 'otra', symbols: null };
}
