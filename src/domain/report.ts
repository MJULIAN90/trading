import { getCostSettings, applyCosts, type CostSettings, type EnrichedOperation } from './costs.js';
import { alignmentBreakdown } from './alignment.js';
import { DEFAULT_REVIEW_CONFIG, reviewOperations } from './review.js';
import { GAPS, gapOf, sessionDrawdown, type SessionDrawdownReport } from './sessionDrawdown.js';
import { marketDate } from './sessions.js';
import type { Operation } from './metrics.js';

/**
 * El informe periodico: las preguntas que se contestan solas.
 *
 * La lista completa esta en `claude/preguntas-del-informe.md`. Lo que manda el
 * reparto entre diario y semanal no es la comodidad, es cuanta muestra hace
 * falta para que la respuesta signifique algo:
 *
 *   DIARIO -> solo aritmetica. Una jornada son cuarenta operaciones y una sola
 *     mala mueve la media veinte dolares. Aqui no hay ni un porcentaje
 *     comparado contra nada, ni un p-valor, ni una frase del tipo "esto esta
 *     funcionando". Se cuenta lo que paso y punto.
 *
 *   SEMANAL -> ya se puede comparar contra la semana anterior y contra la
 *     linea base, pero sigue sin poder concluirse nada: cinco jornadas son
 *     doscientas operaciones en el mejor caso.
 *
 * Lo que NO entra aqui, a proposito: nada que necesite elegir un umbral
 * mirando el resultado. Eso es el bloque mensual y se hace a mano, porque
 * decidir que se prueba y con que control no es algo que deba hacer un panel
 * que se refresca cada treinta segundos.
 *
 * LA CIFRA QUE MANDA EN TODO ESTO es `ticksPerTrade`: ticks por contrato y
 * operacion. Es la unica que mide COMO opera sin mezclarlo con CUANTO
 * arriesga. En octubre su resultado en dolares fue +157,50 y su resultado por
 * contrato fue -1.144: la diferencia entera era el lotaje de una operacion.
 * Un informe que solo ensenie dolares esconde justo eso.
 */

export type Periodo = 'diario' | 'semanal';

/** Un corte cualquiera —franja, hueco, lotaje— con las mismas columnas. */
export interface Bloque {
  key: string;
  label: string;
  operations: number;
  contracts: number;
  gross: number;
  net: number;
  /** Neto por operacion. */
  perTrade: number;
  /** Ticks por contrato y operacion: la cifra limpia de tamanio. */
  ticksPerTrade: number;
  wins: number;
  winRate: number;
  /** Mediana del neto por operacion. Cuando no acompania a la media, manda ella. */
  median: number;
}

/**
 * Una operacion destacada, con la cuenta que contesta "¿fue la distancia o
 * fue el tamanio?".
 *
 * No lleva veredicto de texto: lleva los dos numeros y el multiplicador. Sus
 * cinco peores perdidas de octubre salieron todas entre -54 y -60 ticks por
 * contrato -o sea que el stop estaba donde tenia que estar- y aun asi costaron
 * 2.548,50 dolares, porque fueron de 40, 20 y tres de 10 contratos. Con un
 * contrato habrian costado 144,47. Ese factor de 17 es el dato.
 */
export interface Destacada {
  id: number;
  date: string;
  session: string;
  lots: number;
  /** Ticks por contrato. Dice si respeto el stop, independientemente del tamanio. */
  ticks: number;
  net: number;
  /** Lo que habria costado o dado con UN contrato. */
  netPerContract: number;
}

/** Una jornada en el calendario de navegacion. */
export interface DiaCalendario {
  date: string;
  count: number;
  pnl: number;
}

export interface InformeReport {
  periodo: Periodo;
  /** Jornadas de mercado que entran, en orden. */
  days: string[];
  from: string;
  to: string;
  /** Jornadas que tendria un periodo completo. Diario 1, semanal 5. */
  expectedDays: number;

  /**
   * A donde saltar para ver el periodo de antes o el de despues. null cuando
   * no hay mas datos en esa direccion, que es lo que apaga el boton.
   */
  prev: string | null;
  next: string | null;
  /** Si lo que se esta viendo es el periodo mas reciente que hay. */
  isLatest: boolean;

  /**
   * TODAS las jornadas con operaciones, con su neto. Es lo que alimenta el
   * calendario de navegacion, y viaja con el informe para que el panel no
   * tenga que pedir dos cosas distintas y cuadrarlas.
   */
  calendar: DiaCalendario[];

  // --- 1. cuanto llevo -----------------------------------------------------
  operations: number;
  contracts: number;
  gross: number;
  commission: number;
  net: number;
  winRate: number;
  /** El limite diario de la mesa, 0 si no esta puesto. */
  dailyLossLimit: number;
  /** Cuanto queda hasta el limite en la ULTIMA jornada. null sin limite. */
  remaining: number | null;

  // --- 2. el tamanio -------------------------------------------------------
  maxLot: number;
  medianLot: number;
  byLot: Bloque[];
  /** Lo que aportaron las operaciones por encima del lote mediano. */
  bigLots: Bloque;
  smallLots: Bloque;

  // --- 3. la cifra limpia --------------------------------------------------
  ticksPerTrade: number;
  ticksMedian: number;
  /** Lo mismo del periodo anterior del mismo tamanio, para comparar. null si no hay. */
  previous: { from: string; to: string; days: number; net: number; ticksPerTrade: number } | null;

  // --- 4 y 5. donde ---------------------------------------------------------
  bySession: Bloque[];
  byGap: Bloque[];

  // --- 6. las que importan --------------------------------------------------
  worst: Destacada[];
  best: Destacada[];

  // --- 7. lo que hubo que aguantar -----------------------------------------
  drawdown: SessionDrawdownReport;

  // --- semanal --------------------------------------------------------------
  /** Acierto necesario para no perder, dado el payoff del periodo. */
  breakeven: number | null;
  payoff: number | null;
  /** Entradas sin ninguna media a favor: el veto medido. null si faltan velas. */
  sinAlineacion: { operations: number; net: number; perTrade: number } | null;
  /** Reentradas en caliente tras perder. */
  revenge: { operations: number; net: number; perTrade: number };
}

const r2 = (v: number) => Number(v.toFixed(2));

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function bloque(key: string, label: string, ops: EnrichedOperation[]): Bloque {
  const contracts = ops.reduce((a, o) => a + o.max_quantity, 0);
  const gross = ops.reduce((a, o) => a + o.rawGrossPnl, 0);
  const net = ops.reduce((a, o) => a + o.netPnl, 0);
  const wins = ops.filter((o) => o.netPnl > 0).length;

  return {
    key,
    label,
    operations: ops.length,
    contracts,
    gross: r2(gross),
    net: r2(net),
    perTrade: ops.length > 0 ? r2(net / ops.length) : 0,
    // Los ticks ya son POR CONTRATO (`costs.ts` los saca dividiendo por la
    // cantidad), asi que la media de ticks es directamente la cifra limpia.
    ticksPerTrade: ops.length > 0 ? Number((ops.reduce((a, o) => a + (o.ticks ?? 0), 0) / ops.length).toFixed(2)) : 0,
    wins,
    winRate: ops.length > 0 ? Number((wins / ops.length).toFixed(4)) : 0,
    median: r2(median(ops.map((o) => o.netPnl))),
  };
}

function destacada(o: EnrichedOperation): Destacada {
  return {
    id: o.id,
    date: marketDate(o.opened_at),
    session: o.session,
    lots: o.max_quantity,
    ticks: o.ticks ?? 0,
    net: r2(o.netPnl),
    netPerContract: o.max_quantity > 0 ? r2(o.netPnl / o.max_quantity) : 0,
  };
}

/** Las jornadas de mercado presentes, de mas antigua a mas reciente. */
function jornadas(ops: Operation[]): string[] {
  return [...new Set(ops.map((o) => marketDate(o.opened_at)))].sort();
}

/**
 * El lunes de la semana de mercado a la que pertenece una jornada.
 *
 * Las fechas son dias naturales en texto, no instantes, asi que se montan a
 * mediodia UTC: `new Date('2026-10-26')` es medianoche UTC y en un servidor al
 * oeste cae en el dia anterior.
 */
function lunesDe(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 domingo
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

const masDias = (dia: string, n: number) =>
  new Date(new Date(`${dia}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

interface Ventana {
  actual: string[];
  anterior: string[];
  /** Jornada a la que saltar para ver el periodo de antes. null si no hay. */
  prev: string | null;
  next: string | null;
}

/**
 * Las jornadas que entran en el periodo, las del anterior, y a donde saltar.
 *
 * `ancla` es la jornada que se esta mirando; sin ella, la mas reciente. Todo
 * se RECALCULA sobre las operaciones, no se lee de ninguna copia guardada: un
 * informe de hace tres semanas sale de los mismos datos que el de hoy. Eso
 * tiene una consecuencia que conviene tener clara — si el PnL se recalcula,
 * como paso el 31 de octubre con las cuatro ejecuciones a NULL, el historico
 * se corrige solo en vez de conservar la cifra equivocada.
 *
 * El semanal va por SEMANA DE MERCADO -lunes a viernes-, no por "las ultimas
 * cinco jornadas". Son cosas distintas cuando una semana tiene tres dias
 * operados: "las ultimas cinco" cruzaria a la semana anterior y la comparacion
 * dejaria de ser contra nada reconocible. Que el bloque salga corto es
 * informacion, no un defecto.
 *
 * El periodo ANTERIOR es el ultimo que tuvo operaciones, no el inmediatamente
 * anterior en el calendario. Con una semana de vacaciones por medio, lo
 * segundo daria una comparacion contra cero que no dice nada. Las fechas del
 * periodo anterior van en el informe, asi que se ve contra que se compara.
 */
function ventana(todas: string[], periodo: Periodo, ancla?: string): Ventana {
  if (todas.length === 0) return { actual: [], anterior: [], prev: null, next: null };

  const diana = ancla && ancla.length === 10 ? ancla : todas[todas.length - 1]!;

  if (periodo === 'diario') {
    const antes = todas.filter((d) => d < diana);
    const despues = todas.filter((d) => d > diana);
    return {
      actual: todas.filter((d) => d === diana),
      anterior: antes.length > 0 ? [antes[antes.length - 1]!] : [],
      prev: antes.length > 0 ? antes[antes.length - 1]! : null,
      next: despues.length > 0 ? despues[0]! : null,
    };
  }

  const lunes = lunesDe(diana);
  const siguienteLunes = masDias(lunes, 7);

  const antes = todas.filter((d) => d < lunes);
  const despues = todas.filter((d) => d >= siguienteLunes);

  // La semana anterior CON operaciones, no la de hace siete dias a secas.
  const lunesAnterior = antes.length > 0 ? lunesDe(antes[antes.length - 1]!) : null;

  return {
    actual: todas.filter((d) => d >= lunes && d < siguienteLunes),
    anterior: lunesAnterior === null ? [] : todas.filter((d) => d >= lunesAnterior && d < lunes),
    prev: antes.length > 0 ? antes[antes.length - 1]! : null,
    next: despues.length > 0 ? despues[0]! : null,
  };
}

export function informe(
  todas: Operation[],
  periodo: Periodo = 'diario',
  settings: CostSettings = getCostSettings(),
  ancla?: string,
): InformeReport {
  const dias = jornadas(todas);
  const { actual, anterior, prev, next } = ventana(dias, periodo, ancla);

  const enRango = (ops: Operation[], ds: string[]) => {
    const set = new Set(ds);
    return ops.filter((o) => set.has(marketDate(o.opened_at)));
  };

  const ops = applyCosts(enRango(todas, actual), settings);
  const previas = applyCosts(enRango(todas, anterior), settings);

  const contracts = ops.reduce((a, o) => a + o.max_quantity, 0);
  const gross = ops.reduce((a, o) => a + o.rawGrossPnl, 0);
  const commission = ops.reduce((a, o) => a + o.commission, 0);
  const net = ops.reduce((a, o) => a + o.netPnl, 0);
  const wins = ops.filter((o) => o.netPnl > 0).length;

  const lots = ops.map((o) => o.max_quantity);
  const medianLot = median(lots);

  // --- por lotaje ----------------------------------------------------------
  const porLote = new Map<number, EnrichedOperation[]>();
  for (const o of ops) {
    if (!porLote.has(o.max_quantity)) porLote.set(o.max_quantity, []);
    porLote.get(o.max_quantity)!.push(o);
  }
  const byLot = [...porLote.keys()]
    .sort((a, b) => a - b)
    .map((q) => bloque(String(q), `${q} lote${q === 1 ? '' : 's'}`, porLote.get(q)!));

  // --- por franja y por hueco ----------------------------------------------
  const porFranja = new Map<string, EnrichedOperation[]>();
  for (const o of ops) {
    if (!porFranja.has(o.session)) porFranja.set(o.session, []);
    porFranja.get(o.session)!.push(o);
  }
  const ORDEN = ['ASIA', 'LONDON', 'NY_AM', 'NY_LUNCH', 'NY_PM', 'OUTSIDE'];
  const bySession = ORDEN.filter((s) => porFranja.has(s)).map((s) => bloque(s, s, porFranja.get(s)!));

  const porHueco = new Map<number, EnrichedOperation[]>();
  for (const o of ops) {
    if (o.session !== 'OUTSIDE') continue;
    const g = gapOf(o.opened_at);
    if (!g) continue;
    if (!porHueco.has(g.from)) porHueco.set(g.from, []);
    porHueco.get(g.from)!.push(o);
  }
  const byGap = GAPS.filter((g) => porHueco.has(g.from)).map((g) =>
    bloque(String(g.from), g.label, porHueco.get(g.from)!),
  );

  // --- payoff y acierto de equilibrio --------------------------------------
  const ganadoras = ops.filter((o) => o.netPnl > 0);
  const perdedoras = ops.filter((o) => o.netPnl <= 0);
  const mediaGana = ganadoras.length > 0 ? ganadoras.reduce((a, o) => a + o.netPnl, 0) / ganadoras.length : 0;
  const mediaPierde =
    perdedoras.length > 0 ? Math.abs(perdedoras.reduce((a, o) => a + o.netPnl, 0) / perdedoras.length) : 0;
  const payoff = mediaPierde > 0 ? Number((mediaGana / mediaPierde).toFixed(2)) : null;

  // --- el veto de la alineacion --------------------------------------------
  //
  // Solo en el semanal: con una jornada, el cajon de "cero marcos a favor"
  // tiene cuatro operaciones y el numero no describe nada.
  let sinAlineacion: InformeReport['sinAlineacion'] = null;
  if (periodo === 'semanal' && ops.length > 0) {
    const al = alignmentBreakdown(ops);
    const cero = al.buckets.find((b) => b.favor === 0);
    if (cero && cero.operations > 0) {
      sinAlineacion = { operations: cero.operations, net: cero.netPnl, perTrade: cero.avgNet };
    }
  }

  // --- reentradas en caliente ----------------------------------------------
  const reviews = reviewOperations(ops, DEFAULT_REVIEW_CONFIG);
  const calientes = ops.filter((o) =>
    (reviews.get(o.id)?.flags ?? []).some((f) => f.code === 'revenge_entry'),
  );
  const netoCaliente = calientes.reduce((a, o) => a + o.netPnl, 0);

  // --- lo que queda hasta el limite, en la ultima jornada -------------------
  let remaining: number | null = null;
  if (settings.dailyLossLimit > 0 && actual.length > 0) {
    const ultima = actual[actual.length - 1]!;
    const delDia = ops.filter((o) => marketDate(o.opened_at) === ultima);
    const netoDia = delDia.reduce((a, o) => a + o.netPnl, 0);
    remaining = r2(Math.max(0, settings.dailyLossLimit + Math.min(0, netoDia)));
  }

  const grandes = ops.filter((o) => o.max_quantity > medianLot);
  const pequenias = ops.filter((o) => o.max_quantity <= medianLot);

  const porNeto = [...ops].sort((a, b) => a.netPnl - b.netPnl);

  // El calendario se arma sobre TODAS las operaciones, no sobre las del
  // periodo: es para navegar, asi que tiene que ensenar los dias a los que
  // todavia no has ido. Va en neto, igual que el resto del panel.
  const porDia = new Map<string, { count: number; pnl: number }>();
  for (const o of applyCosts(todas, settings)) {
    const d = marketDate(o.opened_at);
    const x = porDia.get(d) ?? { count: 0, pnl: 0 };
    x.count += 1;
    x.pnl += o.netPnl;
    porDia.set(d, x);
  }
  const calendario: DiaCalendario[] = [...porDia.entries()]
    .map(([date, x]) => ({ date, count: x.count, pnl: r2(x.pnl) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    periodo,
    days: actual,
    from: actual[0] ?? '',
    to: actual[actual.length - 1] ?? '',
    expectedDays: periodo === 'diario' ? 1 : 5,

    prev,
    next,
    isLatest: next === null,
    calendar: calendario,

    operations: ops.length,
    contracts,
    gross: r2(gross),
    commission: r2(commission),
    net: r2(net),
    winRate: ops.length > 0 ? Number((wins / ops.length).toFixed(4)) : 0,
    dailyLossLimit: settings.dailyLossLimit,
    remaining,

    maxLot: lots.length > 0 ? Math.max(...lots) : 0,
    medianLot,
    byLot,
    bigLots: bloque('grandes', `mas de ${medianLot} lote${medianLot === 1 ? '' : 's'}`, grandes),
    smallLots: bloque('pequenias', `${medianLot} lote${medianLot === 1 ? '' : 's'} o menos`, pequenias),

    ticksPerTrade:
      ops.length > 0 ? Number((ops.reduce((a, o) => a + (o.ticks ?? 0), 0) / ops.length).toFixed(2)) : 0,
    ticksMedian: Number(median(ops.map((o) => o.ticks ?? 0)).toFixed(2)),
    previous:
      previas.length > 0
        ? {
            from: anterior[0]!,
            to: anterior[anterior.length - 1]!,
            days: anterior.length,
            net: r2(previas.reduce((a, o) => a + o.netPnl, 0)),
            ticksPerTrade: Number(
              (previas.reduce((a, o) => a + (o.ticks ?? 0), 0) / previas.length).toFixed(2),
            ),
          }
        : null,

    bySession,
    byGap,

    worst: porNeto.slice(0, 5).map(destacada),
    best: porNeto.slice(-5).reverse().map(destacada),

    drawdown: sessionDrawdown(ops, settings.dailyLossLimit),

    breakeven: payoff === null ? null : Number((1 / (1 + payoff)).toFixed(4)),
    payoff,
    sinAlineacion,
    revenge: {
      operations: calientes.length,
      net: r2(netoCaliente),
      perTrade: calientes.length > 0 ? r2(netoCaliente / calientes.length) : 0,
    },
  };
}
