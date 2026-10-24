import { applyCosts, getCostSettings } from './costs.js';
import { listOperations } from './metrics.js';
import { marketDate } from './sessions.js';

/**
 * La jornada en curso, contra el limite de perdida.
 *
 * ESTO ES LA UNICA PARTE DEL DIARIO QUE MIRA HACIA DELANTE. Todo lo demas lee
 * lo que ya paso y lo explica; esto existe para que la pantalla pueda decir
 * "para" mientras todavia se puede parar.
 *
 * El dia es la JORNADA DE MERCADO y no la fecha del calendario: rueda a las
 * 18:00 de Nueva York, igual que la mesa de fondeo. Que el diario y la mesa
 * cierren a la misma hora es lo que hace que el limite signifique algo; con el
 * corte a medianoche el 32% de las operaciones caia en el dia equivocado.
 */

export type TodayState = 'sin-limite' | 'ok' | 'cerca' | 'pasado';

export interface TodayReport {
  /** Jornada en curso, YYYY-MM-DD. La que TERMINA, como la nombran las mesas. */
  date: string;
  operations: number;
  contracts: number;
  grossPnl: number;
  commission: number;
  netPnl: number;
  /** El limite configurado, en positivo. 0 = apagado. */
  limit: number;
  /** Lo que queda antes de tocarlo. 0 si ya se paso. null si no hay limite. */
  remaining: number | null;
  /** Que parte del limite se ha gastado, de 0 a 1. null si no hay limite. */
  used: number | null;
  state: TodayState;
}

/**
 * El aviso salta ANTES de tocar el limite, no al tocarlo.
 *
 * Avisar justo en el limite no sirve de nada: para entonces el dinero ya se
 * perdio y lo unico que queda es cerrar. A tres cuartos todavia hay margen
 * para decidir si la siguiente entrada merece la pena.
 */
const AVISO = 0.75;

export function todayReport(now: number = Date.now()): TodayReport {
  const date = marketDate(now);
  const settings = getCostSettings();

  // Sin filtros: el limite es de la jornada entera, no de lo que se este
  // mirando en pantalla. Filtrar por compras y ver que "queda margen" porque
  // las ventas no cuentan seria justo el fallo que esto evita.
  const hoy = applyCosts(
    listOperations().filter((o) => marketDate(o.opened_at) === date),
    settings,
  );

  const netPnl = round2(hoy.reduce((a, o) => a + o.netPnl, 0));
  const grossPnl = round2(hoy.reduce((a, o) => a + o.rawGrossPnl, 0));
  const commission = round2(hoy.reduce((a, o) => a + o.commission, 0));
  const contracts = hoy.reduce((a, o) => a + o.max_quantity, 0);

  const limit = settings.dailyLossLimit;

  if (limit <= 0) {
    return {
      date, operations: hoy.length, contracts, grossPnl, commission, netPnl,
      limit: 0, remaining: null, used: null, state: 'sin-limite',
    };
  }

  // Solo cuenta lo PERDIDO. Un dia en verde gasta cero del limite: ir ganando
  // 300 $ no da derecho a perder 300 mas de los que te marcaste.
  const perdido = Math.max(0, -netPnl);
  const used = perdido / limit;

  return {
    date,
    operations: hoy.length,
    contracts,
    grossPnl,
    commission,
    netPnl,
    limit,
    remaining: round2(Math.max(0, limit - perdido)),
    used: Number(used.toFixed(4)),
    state: used >= 1 ? 'pasado' : used >= AVISO ? 'cerca' : 'ok',
  };
}

const round2 = (n: number): number => Number(n.toFixed(2));
