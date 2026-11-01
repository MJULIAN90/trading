import type { Operation } from './metrics.js';
import { SESSIONS, marketDate, marketHour } from './sessions.js';
import type { SessionName } from './sessions.js';
import { boundedCache } from './boundedCache.js';

/**
 * El drawdown DENTRO de cada killzone, y si existe un nivel al que convenga parar.
 *
 * Son dos preguntas y conviene no mezclarlas, porque una es aritmetica y la
 * otra es inferencia:
 *
 *   1. CUANTO HOYO HACE CADA FRANJA. Descriptivo. No hay nada que demostrar:
 *      se mira la curva de la franja y se mide. Vale para dimensionar la
 *      cuenta y para saber que franja te obliga a aguantar mas.
 *   2. SI ESTAR ABAJO PREDICE ALGO. Esa es la que decide si "parar a los X
 *      dolares" es una regla o una supersticion, y esa SI hay que demostrarla.
 *
 * La trampa de la segunda es que parece obvia y no lo es. Si miras "cuando
 * estuve -200 abajo, la franja acabo mal", claro que acabo mal: esta mal POR
 * ESTAR 200 ABAJO. Eso no es una prediccion, es la misma frase dos veces.
 *
 * Lo unico que se puede usar es lo que paso DESPUES de cruzar el umbral, y hay
 * que compararlo con la media normal de esa misma franja. Si seguir operando
 * estando abajo da lo mismo que seguir operando sin estarlo, el drawdown no
 * informa de nada y no hay nivel de parada que valga.
 *
 * Y aun asi falta la prueba. El umbral que mejor sale en la tabla es SIEMPRE
 * el mejor de la tabla: con siete umbrales por franja y seis franjas, alguno
 * tiene que destacar aunque todo sea ruido. Por eso al final hay una prueba de
 * permutacion que baraja el ORDEN de las operaciones dentro de cada jornada
 * -conservando exactamente las mismas operaciones- y mira si el resultado real
 * se distingue de los barajados. Barajar destruye cualquier "estar abajo
 * predice lo siguiente" y deja intacto todo lo demas: es justo el null que
 * hace falta.
 *
 * MEDIDO EL 31 DE OCTUBRE DE 2026, con 573 operaciones de 5 a 30 de octubre:
 * de 30 celdas con muestra suficiente, UNA baja de p = 0,05 (OUTSIDE con umbral
 * 50, p = 0,013) y NINGUNA sobrevive a Benjamini-Hochberg: el liston del primer
 * puesto con 30 pruebas es 0,0033. Ademas no hay dosis-respuesta: en OUTSIDE el
 * umbral de 50 sale -7,43 y el de 100 sale +2,18. Una regla de parada que cambia
 * de signo al mover el mando es un numero suelto, no una regla.
 *
 * O sea: hipotesis numero once, muerta como las ocho anteriores. El panel
 * existe igual, porque lo descriptivo si sirve y porque en noviembre -con
 * volumen de verdad- hay que volver a medirlo y conviene que el aparato de
 * medida ya este puesto.
 */

/** Umbrales de drawdown en dolares por contrato, en bruto. */
export const THRESHOLDS = [25, 50, 75, 100, 150, 200, 300] as const;

/**
 * Operaciones que tiene que haber DESPUES del cruce para que la celda cuente.
 *
 * Por debajo de esto el numero existe pero no significa nada: con cinco
 * operaciones, una sola mala mueve la media veinte dolares. Las celdas por
 * debajo se calculan igual y se enseñan en gris, para que se vea que el hueco
 * es por falta de muestra y no por falta de drawdown.
 */
export const MIN_TRADES_AFTER = 10;

/** Barajados de la prueba de permutacion. */
const PERMUTATIONS = 2000;

/** Tasa de falsos descubrimientos que se acepta en el Benjamini-Hochberg. */
const FDR = 0.1;

const ORDER: SessionName[] = ['ASIA', 'LONDON', 'NY_AM', 'NY_LUNCH', 'NY_PM', 'OUTSIDE'];

export interface SessionDrawdownRow {
  session: SessionName;
  /** Jornadas en las que operaste esa franja. Es la unidad de todo lo de abajo. */
  days: number;
  trades: number;
  total: number;
  perTrade: number;

  /** Drawdown dentro de la franja: cuanto bajaste desde tu mejor momento de ESE dia. */
  drawdownMedian: number;
  drawdownP75: number;
  drawdownWorst: number;
  /** La jornada del peor drawdown, para poder ir a mirarla. */
  drawdownWorstDay: string | null;

  /**
   * Drawdown de la curva ENCADENADA de la franja: todas sus jornadas seguidas.
   *
   * Es otra cosa que el peor drawdown de un dia y contesta otra pregunta: cuanto
   * llego a deber esta franja en total. Una franja puede no haber tenido
   * nunca un dia horrible y aun asi llevar mil dolares de drawdown acumulado a
   * base de dias malos pequeños.
   */
  chainedDrawdown: number;

  greenDays: number;
  /** Operaciones perdedoras seguidas dentro de una misma franja. */
  worstStreak: number;
  /** Jornadas cuyo drawdown habria cruzado tu limite diario. null si no lo tienes puesto. */
  overLimit: number | null;
}

export interface RecoveryCell {
  session: SessionName;
  threshold: number;
  /** Jornadas que llegaron a ese drawdown dentro de la franja. */
  days: number;
  /** De esas, cuantas siguieron operando despues del cruce. */
  daysWithRest: number;
  tradesAfter: number;
  /** Lo que dio seguir, por operacion. null si no quedo nada despues. */
  perTradeAfter: number | null;
  /** La media normal de la franja, sin condicionar. Es la comparacion honesta. */
  baseline: number;
  /** perTradeAfter menos baseline. Es el hallazgo, si lo hubiera. */
  diff: number | null;
  medianAfter: number | null;
  /** Permutacion: probabilidad de sacar esto o peor barajando el orden. */
  p: number | null;
  /** Si sobrevive al Benjamini-Hochberg sobre TODAS las celdas probadas. */
  survives: boolean;
  /** Muestra suficiente para que la celda cuente. */
  enough: boolean;
}

/**
 * Un hueco entre killzones: el tiempo que el indicador no pinta de ningun color.
 *
 * Esto nacio de una sorpresa al medir. En octubre, 193 de tus 573 operaciones
 * -un tercio- caen en "OUTSIDE", y OUTSIDE no es un sitio: son cinco huecos
 * distintos que se portan de forma distinta. Juntarlos en una fila escondia lo
 * que mas duele de todo el mes:
 *
 *   11:00-12:00, entre NY AM y el almuerzo:  50 operaciones, -501 dolares.
 *
 * Es tu peor hora del mes con diferencia, y estaba dentro de un cajon llamado
 * "fuera". Al lado, las dos horas de despues del cierre de Asia (00:00-02:00)
 * dan +502 con 37 operaciones. Promediar las dos cosas da casi cero y no dice
 * nada de ninguna.
 */
export interface GapRow {
  /** Hora de mercado en decimal donde empieza el hueco. 9.5 son las 09:30. */
  from: number;
  to: number;
  /** De que franja a que franja. "entre NY AM y el almuerzo". */
  label: string;
  days: number;
  trades: number;
  total: number;
  perTrade: number;
  drawdownWorst: number;
  greenDays: number;
}

export interface SessionDrawdownReport {
  rows: SessionDrawdownRow[];
  /** El desglose de OUTSIDE, que es un tercio de todo. */
  gaps: GapRow[];
  thresholds: number[];
  cells: RecoveryCell[];
  permutations: number;
  minTradesAfter: number;
  /** Celdas con muestra suficiente, que son las que entran en el BH. */
  tested: number;
  survivors: number;
  fdr: number;
  dailyLossLimit: number;
}

interface Instance {
  day: string;
  session: SessionName;
  pnls: number[];
}

/**
 * Los huecos, deducidos de las propias ventanas.
 *
 * Se calculan en vez de escribirse a mano a proposito: las ventanas son las
 * del indicador KillZones y si algun dia se mueven ahi, los huecos se mueven
 * solos. Una lista escrita a mano se quedaria desfasada en silencio, que es la
 * peor forma de quedarse desfasada.
 */
function gapWindows(): Array<{ from: number; to: number; label: string }> {
  const nombre: Record<string, string> = {
    ASIA: 'Asia',
    LONDON: 'Londres',
    NY_AM: 'NY AM',
    NY_LUNCH: 'el almuerzo',
    NY_PM: 'NY PM',
  };

  const ventanas = [...SESSIONS].sort((a, b) => a.from - b.from);
  const huecos: Array<{ from: number; to: number; label: string }> = [];

  let cursor = 0;
  let anterior: string | null = null;

  for (const v of ventanas) {
    if (v.from > cursor) {
      huecos.push({
        from: cursor,
        to: v.from,
        label: anterior ? `entre ${anterior} y ${nombre[v.name]}` : `antes de ${nombre[v.name]}`,
      });
    }
    cursor = Math.max(cursor, v.to);
    anterior = nombre[v.name] ?? v.name;
  }

  // La cola del dia. Con Asia acabando a las 24:00 no queda nada, pero si
  // alguna vez la ventana se acorta, el hueco aparece sin tocar esto.
  if (cursor < 24) huecos.push({ from: cursor, to: 24, label: `tras ${anterior}` });

  // El primero es el de despues de medianoche, y llamarlo "antes de Londres"
  // describe mal lo que es: para ti es la cola de la sesion de Asia que acaba
  // de cerrar, no la antesala de Londres.
  if (huecos.length > 0 && huecos[0]!.from === 0) huecos[0]!.label = 'tras cerrar Asia';

  return huecos;
}

export const GAPS = gapWindows();

export function gapOf(tsMs: number): { from: number; to: number; label: string } | null {
  const h = marketHour(tsMs);
  return GAPS.find((g) => h >= g.from && h < g.to) ?? null;
}

/**
 * Las operaciones agrupadas por (jornada, franja).
 *
 * La jornada sale de la APERTURA, igual que la franja: la instancia es "la vez
 * que te sentaste a operar esa killzone", y eso lo decide cuando entraste. El
 * orden de dentro, en cambio, va por CIERRE, que es cuando el dinero se mueve
 * de verdad — la misma convencion que `drawdownOf`.
 */
function instances(ops: Operation[]): Instance[] {
  const map = new Map<string, Instance>();

  for (const o of [...ops].sort((a, b) => a.closed_at - b.closed_at)) {
    const day = marketDate(o.opened_at);
    const session = o.session as SessionName;
    const key = `${day}|${session}`;

    let inst = map.get(key);
    if (!inst) {
      inst = { day, session, pnls: [] };
      map.set(key, inst);
    }
    inst.pnls.push(o.gross_pnl);
  }

  return [...map.values()];
}

/** Drawdown, resultado y racha perdedora de una secuencia. Empieza plano en cero. */
function walk(pnls: number[]): { dd: number; final: number; streak: number } {
  let acc = 0;
  let peak = 0;
  let dd = 0;
  let streak = 0;
  let worst = 0;

  for (const p of pnls) {
    acc += p;
    if (acc > peak) peak = acc;
    if (peak - acc > dd) dd = peak - acc;

    // Un cero exacto cuenta como perdedora: no ganaste nada y pagaste
    // comision por el camino.
    streak = p <= 0 ? streak + 1 : 0;
    if (streak > worst) worst = streak;
  }

  return { dd, final: acc, streak: worst };
}

/**
 * Donde el drawdown alcanza el umbral por primera vez, y que vino despues.
 *
 * Devuelve null si nunca lo alcanzo. `rest` puede quedar vacio: son las veces
 * que el cruce fue en la ultima operacion de la franja, o sea que paraste de
 * todas formas. Esas cuentan para "cuantas veces pasa" pero no para "que da
 * seguir", porque ahi no seguiste.
 */
function crossing(pnls: number[], threshold: number): { after: number; rest: number } | null {
  let acc = 0;
  let peak = 0;

  for (let i = 0; i < pnls.length; i++) {
    acc += pnls[i]!;
    if (acc > peak) peak = acc;

    if (peak - acc >= threshold) {
      let after = 0;
      for (let j = i + 1; j < pnls.length; j++) after += pnls[j]!;
      return { after, rest: pnls.length - 1 - i };
    }
  }

  return null;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]!;
}

const round = (v: number) => Number(v.toFixed(2));

/**
 * Generador con semilla fija.
 *
 * Fija a proposito: un p-valor que cambia cada vez que recargas la pantalla no
 * se puede comentar con nadie, y la diferencia entre 0,04 y 0,06 decidiria el
 * color de la celda al azar. Con semilla fija, el mismo material da siempre la
 * misma respuesta y lo que cambia el numero son datos nuevos, no el refresco.
 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

function shuffle(xs: number[], rnd: () => number): number[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** El estadistico de una celda: lo que dio seguir, por operacion, menos la base. */
function statistic(lists: number[][], threshold: number, baseline: number): number | null {
  let trades = 0;
  let sum = 0;

  for (const pnls of lists) {
    const c = crossing(pnls, threshold);
    if (c && c.rest > 0) {
      trades += c.rest;
      sum += c.after;
    }
  }

  return trades >= MIN_TRADES_AFTER ? sum / trades - baseline : null;
}

const cache = boundedCache<SessionDrawdownReport>(8);

export function sessionDrawdown(ops: Operation[], dailyLossLimit = 0): SessionDrawdownReport {
  // La huella del material: cuantas operaciones, cual es la ultima y cuanto
  // suman. Dos conjuntos distintos del mismo tamaño dan sumas distintas, asi
  // que no hace falta recorrer nada mas para saber que el informe sirve.
  const fingerprint = ops.reduce((a, o) => a + o.gross_pnl, 0);
  const last = ops.reduce((a, o) => Math.max(a, o.closed_at), 0);
  const key = `${ops.length}:${last}:${fingerprint.toFixed(2)}:${dailyLossLimit}`;

  const hit = cache.get(key);
  if (hit) return hit;

  const all = instances(ops);

  const rows: SessionDrawdownRow[] = [];
  const cells: RecoveryCell[] = [];

  // ------------------------------------------------------------------ huecos
  //
  // Se parte OUTSIDE por hueco, con la misma unidad que todo lo demas: una
  // instancia es (jornada, hueco).
  const porHueco = new Map<string, { from: number; to: number; label: string; dias: Map<string, number[]> }>();

  for (const o of [...ops].sort((a, b) => a.closed_at - b.closed_at)) {
    if ((o.session as SessionName) !== 'OUTSIDE') continue;

    const g = gapOf(o.opened_at);
    if (!g) continue;

    const key = String(g.from);
    let entrada = porHueco.get(key);
    if (!entrada) {
      entrada = { ...g, dias: new Map() };
      porHueco.set(key, entrada);
    }

    const dia = marketDate(o.opened_at);
    const lista = entrada.dias.get(dia) ?? [];
    lista.push(o.gross_pnl);
    entrada.dias.set(dia, lista);
  }

  const gaps: GapRow[] = [...porHueco.values()]
    .sort((a, b) => a.from - b.from)
    .map((g) => {
      const jornadas = [...g.dias.values()].map(walk);
      const trades = [...g.dias.values()].reduce((a, l) => a + l.length, 0);
      const total = jornadas.reduce((a, w) => a + w.final, 0);

      return {
        from: g.from,
        to: g.to,
        label: g.label,
        days: g.dias.size,
        trades,
        total: round(total),
        perTrade: round(trades > 0 ? total / trades : 0),
        drawdownWorst: round(Math.max(...jornadas.map((w) => w.dd))),
        greenDays: jornadas.filter((w) => w.final > 0).length,
      };
    });

  for (const session of ORDER) {
    const mine = all.filter((i) => i.session === session);
    if (mine.length === 0) continue;

    const walked = mine.map((i) => ({ ...i, ...walk(i.pnls) }));
    const dds = walked.map((w) => w.dd);
    const trades = mine.reduce((a, i) => a + i.pnls.length, 0);
    const total = walked.reduce((a, w) => a + w.final, 0);
    const baseline = trades > 0 ? total / trades : 0;

    // La curva de la franja a lo largo de los dias, en orden.
    const chained = walk(
      [...mine].sort((a, b) => a.day.localeCompare(b.day)).flatMap((i) => i.pnls),
    );

    const worst = walked.reduce((a, w) => (w.dd > a.dd ? w : a), walked[0]!);

    rows.push({
      session,
      days: mine.length,
      trades,
      total: round(total),
      perTrade: round(baseline),
      drawdownMedian: round(median(dds)),
      drawdownP75: round(percentile(dds, 0.75)),
      drawdownWorst: round(Math.max(...dds)),
      drawdownWorstDay: worst.dd > 0 ? worst.day : null,
      chainedDrawdown: round(chained.dd),
      greenDays: walked.filter((w) => w.final > 0).length,
      worstStreak: Math.max(...walked.map((w) => w.streak)),
      overLimit: dailyLossLimit > 0 ? dds.filter((h) => h >= dailyLossLimit).length : null,
    });

    // ------------------------------------------------------------- recuperacion

    const lists = mine.map((i) => i.pnls);

    for (const threshold of THRESHOLDS) {
      const crossings = lists.map((l) => crossing(l, threshold)).filter((c) => c !== null);
      if (crossings.length === 0) continue;

      const withRest = crossings.filter((c) => c.rest > 0);
      const tradesAfter = withRest.reduce((a, c) => a + c.rest, 0);
      const sumAfter = withRest.reduce((a, c) => a + c.after, 0);

      const perTradeAfter = tradesAfter > 0 ? sumAfter / tradesAfter : null;
      const enough = tradesAfter >= MIN_TRADES_AFTER;

      // La permutacion solo se corre donde hay muestra. Gastar dos mil
      // barajados para adornar una celda que ya sabemos que no cuenta es
      // tiempo tirado, y ademas la meteria en el Benjamini-Hochberg: cada
      // prueba de mas sube el liston de todas las demas.
      let p: number | null = null;
      if (enough && perTradeAfter !== null) {
        const real = perTradeAfter - baseline;
        const rnd = seeded(20261031 + threshold);

        let worseOrEqual = 0;
        let valid = 0;

        for (let k = 0; k < PERMUTATIONS; k++) {
          const e = statistic(lists.map((l) => shuffle(l, rnd)), threshold, baseline);
          if (e === null) continue;
          valid++;
          if (e <= real) worseOrEqual++;
        }

        // El +1 arriba y abajo es la correccion de Phipson-Smyth: sin ella el
        // p-valor puede salir 0, y "probabilidad cero" es imposible con dos
        // mil barajados. El minimo honesto es 1/2001.
        p = valid > 0 ? (worseOrEqual + 1) / (valid + 1) : null;
      }

      cells.push({
        session,
        threshold,
        days: crossings.length,
        daysWithRest: withRest.length,
        tradesAfter,
        perTradeAfter: perTradeAfter === null ? null : round(perTradeAfter),
        baseline: round(baseline),
        diff: perTradeAfter === null ? null : round(perTradeAfter - baseline),
        medianAfter: withRest.length > 0 ? round(median(withRest.map((c) => c.after))) : null,
        p: p === null ? null : Number(p.toFixed(4)),
        survives: false,
        enough,
      });
    }
  }

  // ------------------------------------------------------- Benjamini-Hochberg
  //
  // Una celda con p = 0,04 no es un hallazgo cuando se han mirado treinta y
  // cinco: al 5%, una de cada veinte sale asi por puro azar. El BH ordena los
  // p-valores y le pide al k-esimo que baje de k/m * FDR, que es un liston
  // mucho mas duro para el primero y se va relajando.
  const probados = cells.filter((c) => c.enough && c.p !== null);
  const ordenados = [...probados].sort((a, b) => a.p! - b.p!);

  let corte = 0;
  for (let k = 0; k < ordenados.length; k++) {
    if (ordenados[k]!.p! <= ((k + 1) / ordenados.length) * FDR) corte = k + 1;
  }
  for (let k = 0; k < corte; k++) ordenados[k]!.survives = true;

  const report: SessionDrawdownReport = {
    rows,
    gaps,
    thresholds: [...THRESHOLDS],
    cells,
    permutations: PERMUTATIONS,
    minTradesAfter: MIN_TRADES_AFTER,
    tested: probados.length,
    survivors: corte,
    fdr: FDR,
    dailyLossLimit,
  };

  cache.set(key, report);
  return report;
}
