import { db } from '../db/index.js';
import { barsWindow, normalizeSymbol, type Bar } from './bars.js';
import { marketOffsetAt } from './clock.js';
import { SESSIONS } from './sessions.js';
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
  /** Velas pedidas frente a velas encontradas: si no cuadra, hubo hueco de captura. */
  coverage: { before: number; after: number; found: number; expected: number };
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
 * Ventana de velas alrededor de una operacion.
 *
 * `before` y `after` van en minutos y no en numero de velas a proposito: si el
 * mercado estuvo parado, "60 velas atras" puede ser hora y media o seis horas,
 * y entonces dos graficos de la misma operacion no son comparables entre si.
 */
export function replay(operationId: number, beforeMin = 45, afterMin = 30): Replay | null {
  const op = db().prepare('SELECT * FROM operations WHERE id = ?').get(operationId) as
    | Record<string, unknown>
    | undefined;

  if (!op) return null;

  const openedAt = Number(op.opened_at);
  const closedAt = Number(op.closed_at);
  const symbol = normalizeSymbol(String(op.symbol));

  const from = openedAt - beforeMin * 60_000;
  const to = closedAt + afterMin * 60_000;

  const bars = barsWindow(symbol, from, to);

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
    coverage: {
      before: beforeMin,
      after: afterMin,
      found: bars.length,
      expected: Math.round((to - from) / 60_000),
    },
  };
}
