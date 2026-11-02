import { db } from '../db/index.js';
import { barsVersion, normalizeSymbol } from './bars.js';
import { boundedCache } from './boundedCache.js';
import { instrumentOf } from './instruments.js';

/**
 * Como reacciona el precio a las noticias del calendario economico.
 *
 * ESTE PANEL MIDE, NO INTERPRETA, y la diferencia no es de estilo.
 *
 * Lo que se pidio al principio fue una pestania de "interpretaciones" que
 * dijera si un dato es bueno o malo para el Nasdaq. No se puede, y el motivo
 * esta en la propia base: de los 45 eventos de `economic_events`, CERO tienen
 * `forecast` y CERO tienen `actual`. El calendario es una agenda -dice cuando
 * pasan las cosas- no un historial de resultados.
 *
 * Y sin prevision no hay sorpresa. Lo que mueve el precio no es que el paro
 * sea del 4,2 %, es que se esperaba 4,0 %. Con esa columna vacia, "esto es
 * positivo para el Nasdaq" no es una medicion: es una opinion, y encima una
 * que no se puede matar. De once hipotesis medidas en este diario nueve
 * murieron, y murieron porque cada una se enfrento a un numero. Una
 * interpretacion sin muestra se lee como analisis, se recuerda cuando acierta
 * y se olvida cuando falla.
 *
 * Asi que se mide lo que si se puede medir, que resulta ser bastante:
 *
 *   1. QUE HIZO EL PRECIO despues de cada evento. Movimiento neto a los 5, 15,
 *      30 y 60 minutos, y el rango recorrido. Sin adjetivos.
 *   2. SI ESO ES MUCHO O POCO, que es la pregunta de verdad. Un rango de 200
 *      puntos no dice nada suelto; dice mucho comparado con los 100 que hace
 *      el mismo reloj un dia sin dato. Por eso cada franja horaria lleva su
 *      linea base y su contraste.
 *   3. SI LA DIRECCION SE PUEDE ANTICIPAR. Se cuenta cuantas veces subio y
 *      cuantas bajo. Con el calendario de hoy la respuesta es que no, y esa
 *      respuesta tambien es un resultado: evita que te inventes una.
 *
 * Cuando el calendario traiga previsiones -`src/ingest/investing.ts` ya sabe
 * leerlas, solo falta el fichero- la sorpresa se aniade ENCIMA de esto sin
 * rehacerlo: el mismo movimiento medido, partido por el signo de la sorpresa.
 */

/** Horizontes a los que se mira el movimiento, en minutos. */
export const HORIZONTES = [5, 15, 30, 60] as const;

/** Velas de margen antes del evento, para tener la referencia de salida. */
const MARGEN_PREVIO_MIN = 10;

/**
 * Minimo de velas en la hora posterior para dar un caso por medible.
 *
 * Son 60 minutos y el instrumento cotiza cada minuto, asi que con menos de 40
 * velas hay huecos: o es una sesion rota o el mercado estaba medio cerrado, y
 * un rango sacado de veinte velas sueltas no es comparable con uno sacado de
 * sesenta.
 */
const MIN_VELAS = 40;

/** Cuantos remuestreos para el contraste. */
const PERMUTACIONES = 20_000;

export interface Movimiento {
  /** Minutos despues del evento. */
  min: number;
  /** Cierre menos el cierre de la vela anterior al evento, en puntos. */
  puntos: number;
}

export interface EventoReaccion {
  id: string;
  ts: number;
  title: string;
  impact: string | null;
  source: string | null;
  /** Cierre de la ultima vela ANTES del evento: la referencia de todo. */
  previo: number | null;
  movimientos: Movimiento[];
  /** Maximo menos minimo en los 60 minutos siguientes, en puntos. */
  rango60: number | null;
  velas: number;
  /**
   * Por que este evento no se pudo medir, si no se pudo. Se escribe en vez de
   * esconder la fila: un evento del calendario que cae donde no hay mercado
   * casi siempre significa que el evento esta mal, no que falten velas, y eso
   * hay que verlo.
   */
  problema: string | null;
}

export interface FranjaBase {
  /** "12:30", en UTC. */
  hhmm: string;
  /** Mediana del rango de 60 min los dias CON evento a esa hora. */
  medianaCon: number;
  /** Lo mismo los dias sin evento. Misma hora, mismo dia de la semana. */
  medianaSin: number;
  nCon: number;
  nSin: number;
  /** medianaCon / medianaSin. */
  ratio: number;
  /** Permutacion sobre la diferencia de medianas. */
  p: number;
}

export interface ReaccionReport {
  symbol: string;
  /** Cobertura de velas, que es lo que limita todo lo demas. */
  desde: number;
  hasta: number;
  eventos: EventoReaccion[];
  franjas: FranjaBase[];
  direccion: {
    /** Momentos DISTINTOS medidos: dos datos del mismo minuto cuentan uno. */
    momentos: number;
    aFavor: number;
    enContra: number;
    /** Mediana del movimiento NETO a 60 min. Cerca de cero = moneda. */
    medianaNeta: number;
    /** Mediana del movimiento en valor absoluto: cuanto recorre, sin signo. */
    medianaAbs: number;
    /** Lo anterior en dolares por contrato. */
    medianaAbsUsd: number;
    /** Binomial a dos colas sobre el reparto. Alto = indistinguible de azar. */
    pMoneda: number;
  } | null;
  /** Cuantos eventos del calendario quedan fuera por no haber velas. */
  fueraDeRango: number;
  /**
   * El estado del calendario, que es la limitacion de fondo. Si `conPrevision`
   * es cero, la direccion no se puede estudiar por mucho que crezca la muestra.
   */
  calendario: {
    total: number;
    conPrevision: number;
    conDatoReal: number;
    fuentes: Array<{ source: string; n: number }>;
  };
}

interface Vela { ts: number; h: number; l: number; c: number }
interface Evento { id: string; ts: number; title: string; impact: string | null; source: string | null }

function mediana(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length / 2;
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Generador con semilla, y no `Math.random`.
 *
 * El contraste se recalcula cada vez que se pide el panel. Con `Math.random`,
 * los mismos datos darian un p distinto en cada recarga -0,031 ahora, 0,028 al
 * refrescar- y eso destruye la confianza en la cifra mucho mas de lo que la
 * aleatoriedad "de verdad" aporta. Con semilla fija, mismos datos, mismo
 * numero, siempre. Es un mulberry32.
 */
/**
 * Probabilidad de ver un reparto al menos tan desigual como el observado si
 * cada noticia fuera una moneda. Binomial exacta, a dos colas.
 *
 * Hace falta porque "8 a favor y 7 en contra" se lee solo, pero "9 y 6" ya no:
 * a ojo parece una tendencia y no lo es. Con 15 lanzamientos, un 9-6 sale por
 * casualidad una de cada dos veces. Dejar que el lector decida cuanto es mucho
 * es justo por donde se cuelan las interpretaciones.
 */
export function pMoneda(aFavor: number, total: number): number {
  if (total === 0) return 1;

  // Coeficientes por recurrencia en vez de factoriales: 170! ya desborda un
  // double, y esto tiene que seguir valiendo con anios de eventos.
  const probs: number[] = [];
  let c = Math.pow(0.5, total);
  probs.push(c);
  for (let k = 1; k <= total; k++) {
    c = (c * (total - k + 1)) / k;
    probs.push(c);
  }

  const observada = probs[aFavor]!;
  // "Al menos tan extremo" = cualquier reparto no mas probable que el visto.
  // Sumar las dos colas por separado falla con n impar, donde no son
  // simetricas respecto de un entero.
  const EPS = 1e-12;
  return Math.min(1, probs.reduce((s, p) => (p <= observada + EPS ? s + p : s), 0));
}

function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Permutacion sobre la diferencia de medianas.
 *
 * La pregunta que contesta: si las etiquetas "con noticia" y "sin noticia" se
 * repartieran al azar entre las mismas horas, cuantas veces saldria una
 * diferencia igual o mayor que la observada. No asume ninguna distribucion, que
 * es justo lo que hace falta aqui: los rangos tienen una cola derecha larga y
 * una t de Student se los tragaria como si fueran normales.
 *
 * De una sola cola a proposito. La hipotesis no es "es distinto", es "se mueve
 * MAS con noticia": una franja que se moviera menos los dias de dato seria un
 * error de datos, no un hallazgo.
 */
function permutacion(con: number[], sin: number[], semilla: number): number {
  if (con.length === 0 || sin.length === 0) return 1;

  const todos = [...con, ...sin];
  const k = con.length;
  const obs = mediana(con) - mediana(sin);
  const rnd = azar(semilla);

  let igualOPeor = 0;
  for (let i = 0; i < PERMUTACIONES; i++) {
    const c = [...todos];
    for (let j = c.length - 1; j > 0; j--) {
      const q = Math.floor(rnd() * (j + 1));
      [c[j], c[q]] = [c[q]!, c[j]!];
    }
    if (mediana(c.slice(0, k)) - mediana(c.slice(k)) >= obs) igualOPeor++;
  }

  // +1 arriba y abajo: sin eso, cero aciertos daria p = 0 exacto, que afirma
  // mas de lo que 20.000 remuestreos pueden sostener.
  return (igualOPeor + 1) / (PERMUTACIONES + 1);
}

const cache = boundedCache<ReaccionReport>(8);

export function reaccion(symbol: string): ReaccionReport {
  const sym = normalizeSymbol(symbol);

  // -------------------------------------------------- la marca de validez
  //
  // Este panel depende de DOS tablas, asi que la marca lleva las dos.
  //
  // Para `bars` se usa `barsVersion()`: un contador en `meta`, porque contar
  // las velas recorre el indice entero y costaba casi cinco segundos por
  // carga del tablero (la historia esta en `bars.ts`).
  //
  // Para el calendario se hace justo lo contrario, y a proposito: se resume la
  // tabla ENTERA en cada llamada. Dos razones. La primera es de tamanio: son
  // decenas de filas, no cientos de miles, y el resumen tarda microsegundos.
  // La segunda es la que importa: `COUNT(*)` y `MAX(rowid)` NO CAMBIAN cuando
  // se rellena el `forecast` de un evento que ya existia, que es exactamente
  // lo que va a pasar en cuanto se importe un calendario con previsiones. Con
  // una marca asi, el panel seguiria sirviendo el informe viejo diciendo que
  // no hay previsiones mientras la base ya las tiene.
  //
  // Lo cazo `prueba-reaccion.ts` rellenando un forecast y comprobando que se
  // nota. La leccion de `bars.ts` no es "las marcas baratas siempre", es
  // "mira lo que cuesta y lo que detecta cada marca".
  const marca = db().prepare(`
    SELECT COUNT(*) n,
           COUNT(forecast) f,
           COUNT(actual) a,
           COALESCE(SUM(ts % 1000003), 0) t,
           COALESCE(SUM(COALESCE(forecast, 0) + COALESCE(actual, 0)), 0) v
      FROM economic_events
  `).get() as { n: number; f: number; a: number; t: number; v: number };

  const key = `${sym}:${barsVersion(sym)}:${marca.n}:${marca.f}:${marca.a}:${marca.t}:${marca.v}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rango = db()
    .prepare('SELECT MIN(ts) a, MAX(ts) b FROM bars WHERE symbol = ?')
    .get(sym) as { a: number | null; b: number | null };

  const fuentes = db()
    .prepare('SELECT COALESCE(source, \'(sin fuente)\') source, COUNT(*) n FROM economic_events GROUP BY 1 ORDER BY n DESC')
    .all() as Array<{ source: string; n: number }>;

  const calendario = {
    total: marca.n,
    conPrevision: (db().prepare('SELECT COUNT(*) n FROM economic_events WHERE forecast IS NOT NULL').get() as { n: number }).n,
    conDatoReal: (db().prepare('SELECT COUNT(*) n FROM economic_events WHERE actual IS NOT NULL').get() as { n: number }).n,
    fuentes,
  };

  const vacio: ReaccionReport = {
    symbol: sym, desde: 0, hasta: 0, eventos: [], franjas: [],
    direccion: null, fueraDeRango: marca.n, calendario,
  };
  if (rango.a === null || rango.b === null) {
    cache.set(key, vacio);
    return vacio;
  }

  const todos = db()
    .prepare('SELECT id, ts, title, impact, source FROM economic_events ORDER BY ts')
    .all() as Evento[];

  const dentro = todos.filter((e) => e.ts >= rango.a! && e.ts <= rango.b!);

  const velasDe = db().prepare(
    'SELECT ts, h, l, c FROM bars WHERE symbol = ? AND ts >= ? AND ts <= ? ORDER BY ts',
  );

  // ------------------------------------------------------- evento por evento

  const eventos: EventoReaccion[] = dentro.map((e) => {
    const v = velasDe.all(sym, e.ts - MARGEN_PREVIO_MIN * 60_000, e.ts + 60 * 60_000) as Vela[];
    const previas = v.filter((x) => x.ts < e.ts);
    const post = v.filter((x) => x.ts >= e.ts && x.ts <= e.ts + 60 * 60_000);

    const base: EventoReaccion = {
      id: e.id, ts: e.ts, title: e.title, impact: e.impact, source: e.source,
      previo: null, movimientos: [], rango60: null, velas: v.length, problema: null,
    };

    if (previas.length === 0) return { ...base, problema: 'no hay vela anterior al evento' };
    if (post.length < MIN_VELAS) {
      // Casi siempre quiere decir que el evento esta mal fechado. Un dato
      // economico de Estados Unidos no cae en sabado, y si la fila dice que
      // si, la fila esta mal: lo que falla es el calendario, no las velas.
      return { ...base, problema: `solo ${post.length} velas en la hora siguiente: mercado cerrado o evento mal fechado` };
    }

    const previo = previas.at(-1)!.c;
    return {
      ...base,
      previo,
      movimientos: HORIZONTES.map((min) => {
        // `<` y no `<=`: la vela lleva la marca de su APERTURA, asi que la que
        // abre en +5 min cierra en +6 y colaria un minuto de mas en cada
        // horizonte. Con `<`, la ultima que entra es la que abre en +4 y
        // cierra justo en +5, que es lo que dice la columna.
        const c = v.filter((x) => x.ts < e.ts + min * 60_000).at(-1);
        return { min, puntos: c ? c.c - previo : 0 };
      }),
      rango60: Math.max(...post.map((x) => x.h)) - Math.min(...post.map((x) => x.l)),
    };
  });

  // ------------------------------------------------------------- la direccion

  // POR MOMENTO, NO POR FILA. El *Core CPI m/m* y el *CPI m/m* se publican el
  // mismo minuto: son dos filas del calendario y un solo movimiento del
  // precio. Contarlas dos veces infla la muestra con el mismo dato repetido,
  // que es la forma mas facil de que una n parezca mayor de lo que es.
  const porMomento = new Map<number, number>();
  for (const e of eventos) {
    if (e.problema !== null) continue;
    porMomento.set(e.ts, e.movimientos.at(-1)!.puntos);
  }
  const netos = [...porMomento.values()];
  const pointValue = instrumentOf(sym)?.pointValue ?? 2;
  const abs = mediana(netos.map(Math.abs));

  const direccion = netos.length === 0 ? null : {
    momentos: netos.length,
    aFavor: netos.filter((x) => x >= 0).length,
    enContra: netos.filter((x) => x < 0).length,
    medianaNeta: mediana(netos),
    medianaAbs: abs,
    medianaAbsUsd: abs * pointValue,
    pMoneda: pMoneda(netos.filter((x) => x >= 0).length, netos.length),
  };

  // -------------------------------------------------- la linea base por franja
  //
  // Una franja es una hora del reloj UTC en la que cae al menos un evento. Se
  // compara consigo misma: el mismo minuto de otros dias laborables. Comparar
  // las 12:30 con la media del dia no diria nada, porque a esa hora el mercado
  // ya se mueve mas que a las tres de la madrugada opere quien opere.

  const horasConEvento = [...new Set(
    eventos.filter((e) => e.problema === null)
      .map((e) => `${String(new Date(e.ts).getUTCHours()).padStart(2, '0')}:${String(new Date(e.ts).getUTCMinutes()).padStart(2, '0')}`),
  )].sort();

  const franjas: FranjaBase[] = horasConEvento.map((hhmm) => {
    const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
    const con: number[] = [];
    const sin: number[] = [];

    for (let d = new Date(rango.a!); d.getTime() <= rango.b!; d = new Date(d.getTime() + 86_400_000)) {
      const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm);
      if (t < rango.a! || t + 3_600_000 > rango.b!) continue;

      // Fin de semana fuera: un sabado sin mercado entraria como rango cero y
      // bajaria artificialmente la linea base, haciendo que CUALQUIER dato
      // pareciera moverlo todo.
      const dow = new Date(t).getUTCDay();
      if (dow === 0 || dow === 6) continue;

      const v = velasDe.all(sym, t, t + 3_600_000) as Vela[];
      if (v.length < MIN_VELAS) continue;

      const g = Math.max(...v.map((x) => x.h)) - Math.min(...v.map((x) => x.l));
      // +-5 min y no exacto: una fuente puede fechar el mismo dato un minuto
      // antes o despues, y ese dia no es un dia "sin noticia".
      (todos.some((e) => Math.abs(e.ts - t) <= 5 * 60_000) ? con : sin).push(g);
    }

    const mCon = mediana(con);
    const mSin = mediana(sin);
    return {
      hhmm,
      medianaCon: mCon,
      medianaSin: mSin,
      nCon: con.length,
      nSin: sin.length,
      ratio: mSin > 0 ? mCon / mSin : 0,
      // La semilla sale de la propia franja: el mismo panel da siempre el
      // mismo p, y dos franjas distintas no comparten el sorteo.
      p: permutacion(con, sin, hh * 60 + mm + con.length * 7919),
    };
  });

  const out: ReaccionReport = {
    symbol: sym,
    desde: rango.a,
    hasta: rango.b,
    eventos,
    franjas,
    direccion,
    fueraDeRango: todos.length - dentro.length,
    calendario,
  };

  cache.set(key, out);
  return out;
}
