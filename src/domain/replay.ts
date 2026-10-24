import { db } from '../db/index.js';
import { barsWindow, normalizeSymbol, type Bar } from './bars.js';
import { marketOffsetAt } from './clock.js';
import { DEFAULT_CHART } from './prefs.js';
import { SESSIONS } from './sessions.js';
import { patternAt, type PatternRead } from './pattern.js';
import { statFor, type SessionStat } from './sessionStats.js';
import { marketHour, sessionOf } from './sessions.js';
import { trendAt, type TrendSnapshot } from './trend.js';

/**
 * Reconstruccion del grafico de una operacion.
 *
 * No se guarda ningun recorte por operacion: las velas ya estan en `bars`, y
 * duplicarlas por cada trade seria guardar tres veces lo mismo. Aqui solo se
 * recorta la ventana que interesa en el momento de pedirla.
 */

export interface ReplayFill {
  ts: number;
  price: number;
  quantity: number;
  side: number; // 0 compra, 1 venta
}

export interface SessionBox {
  name: string;
  /** Recortado a la ventana del grafico: es lo que se puede dibujar. */
  from: number;
  to: number;
  /** Principio y final REALES de la killzone, aunque caigan fuera de la ventana. */
  fullFrom: number;
  fullTo: number;
}

export interface Replay {
  operation: Record<string, unknown>;
  symbol: string;
  bars: Bar[];
  fills: ReplayFill[];
  /** Killzones que tocan la ventana, para dibujarlas sobre el grafico. */
  sessions: SessionBox[];
  /** Como estaban los marcos grandes en el momento de abrir. */
  trend: TrendSnapshot;
  /** Patron de la vela de 15m ya cerrada al abrir. */
  pattern: PatternRead | null;
  /** Minutos por vela de las que se devuelven. */
  timeframe: number;
  /** Lo que el MERCADO hace en esa killzone, para comparar con lo que hiciste. */
  sessionStat: SessionStat | null;
  /** Minutos transcurridos desde que abrio la killzone. null si entro fuera. */
  minutesIntoSession: number | null;
  /** Velas pedidas frente a velas encontradas: si no cuadra, hubo hueco de captura. */
  coverage: {
    before: number;
    after: number;
    found: number;
    expected: number;
    /**
     * Velas de un minuto que hay DONDE ESTA LA OPERACION, no en toda la
     * ventana. Si esto es 0, lo que se dibuja es mercado de otro momento.
     */
    aroundEntry: number;
    /** Minutos a cada lado de la operacion que cuenta `aroundEntry`. */
    entryWindowMin: number;
  };
}

/**
 * Las killzones que se solapan con la ventana, como instantes absolutos.
 *
 * Se calculan dia a dia y no una sola vez porque la ventana puede cruzar la
 * medianoche, y porque el desfase de Nueva York cambia dos veces al ano: una
 * caja dibujada con un desfase fijo apareceria una hora corrida medio ano.
 */
function sessionBoxes(from: number, to: number): SessionBox[] {
  const boxes: SessionBox[] = [];
  const DAY = 86_400_000;

  // Un dia de margen a cada lado: ASIA empieza a las 20:00 y se prolonga sobre
  // el dia siguiente, asi que mirando solo los dias de la ventana se perderia.
  for (let t = from - DAY; t <= to + DAY; t += DAY) {
    const offset = marketOffsetAt(t);
    const local = new Date(t + offset * 3600_000);
    const midnightUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset * 3600_000;

    for (const s of SESSIONS) {
      // ASIA cruza medianoche: su final es la hora 24, o sea el dia siguiente.
      const end = s.name === 'ASIA' ? 24 : s.to;
      const a = midnightUtc + s.from * 3600_000;
      const b = midnightUtc + end * 3600_000;

      if (b > from && a < to) {
        // Se guardan los dos: el tramo dibujable y la killzone entera. Sin el
        // segundo no hay forma de saber si la caja que ves es la sesion
        // completa o un trozo cortado por el borde del grafico, que es
        // justamente lo que se quiere mirar al analizar donde entraste.
        boxes.push({
          name: s.name,
          from: Math.max(a, from),
          to: Math.min(b, to),
          fullFrom: a,
          fullTo: b,
        });
      }
    }
  }

  // Al recorrer dias con margen, la misma killzone puede salir repetida.
  const seen = new Set<string>();
  return boxes
    .filter((b) => {
      const k = `${b.name}|${b.from}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.from - b.from);
}

/**
 * Agrupa velas de un minuto en velas de `minutes` minutos.
 *
 * Se agrupa en el SERVIDOR y no en el navegador porque 180 velas de 4 horas
 * son 43.200 velas de un minuto: mandarlas por la red para que el navegador
 * las junte y dibuje 180 es tirar treinta megas para ensenar lo mismo.
 *
 * El reloj de agrupacion va en hora de MERCADO, no en UTC: una vela de 4h
 * anclada a UTC empieza a las 20:00 de Nueva York en verano y a las 19:00 en
 * invierno, asi que las mismas velas cambiarian de sitio al cambiar la hora.
 */
function group(bars: Bar[], minutes: number): Bar[] {
  if (minutes <= 1 || bars.length === 0) return bars;

  const size = minutes * 60_000;
  const out: Bar[] = [];
  let current: Bar | null = null;
  let key = NaN;

  for (const b of bars) {
    const k = Math.floor((b.ts + marketOffsetAt(b.ts) * 3600_000) / size);

    if (k !== key) {
      if (current) out.push(current);
      // Se copia para no tocar la vela original: el mismo objeto se usa luego
      // para el MAE/MFE y machacarlo aqui falsearia la excursion.
      current = { ...b };
      key = k;
    } else if (current) {
      current.h = Math.max(current.h, b.h);
      current.l = Math.min(current.l, b.l);
      current.c = b.c;
      // El delta se suma; el resto de campos de flujo se dejan como vinieron de
      // la primera vela del grupo, que es lo honesto: sumar un "tamano medio"
      // o un "libro" de cinco minutos distintos no significa nada.
      if (current.delta !== null && b.delta !== null) current.delta += b.delta;
      if (current.buy !== null && b.buy !== null) current.buy += b.buy;
      if (current.sell !== null && b.sell !== null) current.sell += b.sell;
    }
  }

  if (current) out.push(current);
  return out;
}

/**
 * Ventana de velas alrededor de una operacion.
 *
 * `before` y `after` van en minutos y no en numero de velas a proposito: si el
 * mercado estuvo parado, "60 velas atras" puede ser hora y media o seis horas,
 * y entonces dos graficos de la misma operacion no son comparables entre si.
 */
export function replay(
  operationId: number,
  beforeMin = 45,
  afterMin = 30,
  timeframe = DEFAULT_CHART.timeframe,
): Replay | null {
  const op = db().prepare('SELECT * FROM operations WHERE id = ?').get(operationId) as
    | Record<string, unknown>
    | undefined;

  if (!op) return null;

  const openedAt = Number(op.opened_at);
  const closedAt = Number(op.closed_at);
  const symbol = normalizeSymbol(String(op.symbol));

  const from = openedAt - beforeMin * 60_000;
  const to = closedAt + afterMin * 60_000;

  // El limite se calcula sobre velas de UN minuto, que es lo que hay guardado:
  // para 180 velas de 4h hacen falta 43.200. Se deja un margen porque el
  // mercado para una hora al dia y los fines de semana, asi que el numero de
  // velas reales en una ventana de tiempo siempre es menor que los minutos.
  const minutesSpan = Math.ceil((to - from) / 60_000);
  const raw = barsWindow(symbol, from, to, minutesSpan + 100);
  const bars = group(raw, timeframe);

  // Cuantas velas hay PEGADAS a la operacion.
  //
  // El recuento de toda la ventana no vale para esto y es la razon de que el
  // aviso no saltara: en 4h con 180 velas la ventana son 30 dias, asi que
  // puede estar llena de velas de hace semanas y no tener ni una donde de
  // verdad operaste. El grafico sale bonito y no es tu operacion.
  //
  // Pasa al compartir velas entre equipos: el fichero llega hasta el minuto
  // en que se exporto, y lo que operes despues cae en el hueco.
  const ENTRY_WINDOW_MIN = 30;
  const entryFrom = openedAt - ENTRY_WINDOW_MIN * 60_000;
  const entryTo = closedAt + ENTRY_WINDOW_MIN * 60_000;
  const aroundEntry = raw.filter((b) => b.ts >= entryFrom && b.ts <= entryTo).length;

  const fills = db()
    .prepare(
      `SELECT ts, price, quantity, side FROM fills
        WHERE ts BETWEEN ? AND ?
        ORDER BY ts`,
    )
    .all(openedAt - 1000, closedAt + 1000) as ReplayFill[];

  return {
    operation: op,
    symbol,
    bars,
    fills,
    sessions: sessionBoxes(from, to),
    // En el instante de ABRIR, no de cerrar: la pregunta es que se veia cuando
    // se tomo la decision.
    trend: trendAt(symbol, openedAt),
    pattern: patternAt(symbol, openedAt),
    timeframe,
    sessionStat: statFor(symbol, sessionOf(openedAt)),
    minutesIntoSession: minutesIntoSession(openedAt),
    coverage: {
      before: beforeMin,
      after: afterMin,
      found: bars.length,
      // En VELAS de la temporalidad pedida, no en minutos: cuando se agrupa,
      // 113 velas de 15m contra 2.700 minutos de ventana siempre parecen un
      // hueco de captura, y el aviso saltaba en todos los graficos.
      //
      // Aun asi es una referencia alta: el mercado para una hora al dia y los
      // fines de semana, asi que una ventana larga nunca tiene todas sus velas
      // y por eso el aviso solo se ensena muy por debajo de este numero.
      expected: Math.max(1, Math.round((to - from) / 60_000 / timeframe)),
      aroundEntry,
      entryWindowMin: ENTRY_WINDOW_MIN,
    },
  };
}

/**
 * Cuantos minutos llevaba abierta la killzone cuando entraste.
 *
 * Importa porque no es lo mismo entrar en el primer minuto de Nueva York que
 * en el ultimo: la apertura tiene el rango concentrado y el final suele ser
 * arrastre. Sin este numero, "entre en NY AM" tapa dos situaciones opuestas.
 */
function minutesIntoSession(ts: number): number | null {
  const name = sessionOf(ts);
  const s = SESSIONS.find((x) => x.name === name);
  if (!s) return null;

  const h = marketHour(ts);
  // ASIA empieza a las 20:00 y cruza la medianoche: despues de las 00:00 la
  // hora vuelve a cero y restar sin mas daria un numero negativo.
  const hours = name === 'ASIA' && h < s.from ? h + 24 - s.from : h - s.from;
  return Math.round(hours * 60);
}
