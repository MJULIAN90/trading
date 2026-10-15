import type { EnrichedOperation } from './costs.js';
import { derive, snapshotAt } from './context.js';
import { excursionOf } from './excursion.js';
import { marketHour } from './sessions.js';

/**
 * Lectura en prosa de una operacion, compuesta a partir de los hechos ya
 * calculados: el flujo que habia al abrir, el recorrido mientras estuvo abierta
 * y como acabo.
 *
 * Es DETERMINISTA a proposito. No hay modelo de lenguaje detras, y eso no es una
 * limitacion sino el punto: cada frase sale de un numero concreto que se puede
 * comprobar, y la misma operacion produce siempre el mismo texto. Un modelo
 * escribiria mas bonito, pero tambien escribiria con la misma seguridad cosas
 * que no estan en los datos, y aqui el texto va a usarse para cambiar como se
 * opera. Un error de redaccion se perdona; una explicacion inventada que suena
 * convincente, no.
 */

export interface Narrative {
  /** Frases independientes, para que el front las pinte como quiera. */
  lines: string[];
  /** La unica frase accionable, si los datos dan para una. */
  takeaway: string | null;
}

const SESSION_NAME: Record<string, string> = {
  ASIA: 'la sesion asiatica',
  LONDON: 'la sesion de Londres',
  NY_AM: 'la manana de Nueva York',
  NY_LUNCH: 'el mediodia de Nueva York',
  NY_PM: 'la tarde de Nueva York',
  OUTSIDE: 'fuera de las killzones',
};

const n0 = (v: number) => v.toLocaleString('es', { maximumFractionDigits: 0 });
const n1 = (v: number) => v.toLocaleString('es', { maximumFractionDigits: 1 });
const n2 = (v: number) => v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function narrate(op: EnrichedOperation): Narrative {
  const lines: string[] = [];
  const side = op.direction === 'LONG' ? 'comprando' : 'vendiendo';
  const hour = marketHour(op.opened_at);
  const hh = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`;

  lines.push(
    `Entraste ${side} ${op.max_quantity} contrato${op.max_quantity === 1 ? '' : 's'} a las ${hh}, ` +
      `en ${SESSION_NAME[op.session] ?? op.session}.`,
  );

  // ---- que decia el flujo justo antes de abrir ----
  const ctx = derive(snapshotAt(op.opened_at, op.symbol));
  const flowBits: string[] = [];

  if (ctx.absorption === true) {
    flowBits.push('la vela previa tenia mucha agresion y poco recorrido, senal de que alguien estaba absorbiendo');
  }

  if (ctx.imbalance !== null && ctx.imbalance >= 0.3) {
    flowBits.push(`el desequilibrio era del ${n0(ctx.imbalance * 100)}%`);
  }

  if (ctx.bookSkew !== null && Math.abs(ctx.bookSkew) >= 0.25) {
    const favor =
      (op.direction === 'LONG' && ctx.bookSkew > 0) || (op.direction === 'SHORT' && ctx.bookSkew < 0);
    flowBits.push(
      `el libro estaba ${n0(Math.abs(ctx.bookSkew) * 100)}% cargado ${favor ? 'a tu favor' : 'en tu contra'}`,
    );
  }

  if (ctx.pulledLevels !== null && ctx.pulledLevels >= 3) {
    flowBits.push(`${ctx.pulledLevels} niveles del libro se habian vaciado justo antes`);
  }

  if (ctx.tradeSizeRatio !== null && ctx.tradeSizeRatio >= 2) {
    flowBits.push(`se operaba con ordenes x${n1(ctx.tradeSizeRatio)} mas grandes de lo normal`);
  }

  if (flowBits.length > 0) {
    lines.push(`Al abrir, ${flowBits.join('; ')}.`);
  } else if (ctx.deltaRatio === null) {
    lines.push('No hay captura de flujo de ese momento, asi que de las condiciones de entrada no se puede decir nada.');
  }

  // ---- que hizo el precio mientras estabas dentro ----
  const ex = excursionOf(op);

  if (ex.mae !== null && ex.mfe !== null) {
    lines.push(
      `Mientras estuviste dentro se fue ${n1(ex.mae)} ticks en contra y llego a darte ${n1(ex.mfe)} a favor.` +
        (ex.capture !== null ? ` Te llevaste el ${n0(ex.capture * 100)}% de ese recorrido.` : ''),
    );
  }

  // ---- como acabo, con el coste encima ----
  const costShare = op.rawGrossPnl !== 0 ? Math.abs(op.commission / op.rawGrossPnl) : null;

  lines.push(
    `Cerro en ${n2(op.rawGrossPnl)} brutos; tras ${n2(op.commission)} de comision quedaron ${n2(op.netPnl)}.` +
      (costShare !== null && costShare >= 0.25 && op.rawGrossPnl > 0
        ? ` La comision se llevo el ${n0(costShare * 100)}%.`
        : ''),
  );

  return { lines, takeaway: takeawayOf(op, ex) };
}

/**
 * La frase que senala que corregir.
 *
 * Solo una, y solo cuando el dato la sostiene. Devolver siempre algo obligaria a
 * inventar una leccion en operaciones que simplemente salieron bien o mal sin
 * nada que aprender, y a base de leer conclusiones vacias se deja de leerlas.
 *
 * El orden importa: se mira primero el problema de SALIDA, porque es el que
 * suele pasar desapercibido. Cuando una operacion pierde, el reflejo es revisar
 * la entrada; si llego a estar bien arriba, el fallo estaba en otro sitio.
 */
function takeawayOf(op: EnrichedOperation, ex: ReturnType<typeof excursionOf>): string | null {
  const won = op.netPnl > 0;

  if (!won && ex.mfe !== null && ex.mfe >= 8) {
    return (
      `Llego a ir ${n1(ex.mfe)} ticks a tu favor y acabo en ${n2(op.netPnl)}. ` +
      'El problema estuvo en la salida, no en la entrada.'
    );
  }

  if (won && ex.capture !== null && ex.capture < 0.4 && ex.mfe !== null && ex.mfe >= 20) {
    return `Habia ${n1(ex.mfe)} ticks disponibles y te llevaste el ${n0(ex.capture * 100)}%. Saliste pronto.`;
  }

  if (!won && ex.mfe !== null && ex.mfe < 4) {
    return 'Nunca estuvo a tu favor: el precio no te dio la razon en ningun momento. Eso apunta a la entrada.';
  }

  if (won && ex.mae !== null && ex.mae >= 40) {
    return (
      `Gano, pero antes se fue ${n1(ex.mae)} ticks en contra. ` +
      'Un resultado bueno no convierte en buena una entrada que hubo que aguantar tanto.'
    );
  }

  return null;
}
