import { CONTEXT_DIR, JOURNAL_DB, findQuantowerTradesDb } from '../config.js';
import { refreshBars } from '../domain/bars.js';
import { ingestCalendar } from './calendar.js';
import { ingestContextLog } from './context.js';
import { ingestQuantower } from './quantower.js';

/**
 * Punto de entrada de la ingesta: npm run ingest
 *
 * Es idempotente a proposito. Se puede lanzar las veces que haga falta, o
 * dejarlo en una tarea programada, sin duplicar nada: los fills se identifican
 * por su trade_id y las operaciones por el fill que las abre.
 */
async function main() {
  console.log(`base del diario: ${JOURNAL_DB}`);

  // Las dos fuentes son independientes: que falte una no es motivo para
  // saltarse la otra. El contexto se graba aunque Quantower no este instalado
  // en esta maquina, por ejemplo al analizar datos copiados de otro sitio.
  const tradesDb = findQuantowerTradesDb();
  if (tradesDb) {
    console.log(`operaciones de Quantower: ${tradesDb}`);
    const trades = ingestQuantower(tradesDb);
    console.log(
      `  fills: ${trades.fillsRead} leidos, ${trades.fillsNew} nuevos   |   ` +
        `operaciones: ${trades.operations} reconstruidas, ${trades.operationsNew} nuevas`,
    );
  } else {
    console.log('operaciones de Quantower: no se encontro user-trades.db');
    console.log('  (configura QUANTOWER_ROOT o QUANTOWER_TRADES_DB si deberia estar ahi)');
  }

  console.log(`contexto de los indicadores: ${CONTEXT_DIR}`);
  const ctx = await ingestContextLog();
  if (ctx.files === 0) {
    console.log('  (sin ficheros todavia: activa "Guardar contexto para el diario" en j_Flujo)');
  } else {
    console.log(`  ${ctx.files} ficheros, ${ctx.read} lineas leidas, ${ctx.added} nuevas, ${ctx.bad} descartadas`);
  }

  // Las velas se derivan del JSON crudo a columnas tipadas. Va al final porque
  // depende de que el contexto ya este ingerido.
  const bars = refreshBars();
  console.log(`velas derivadas: ${bars.written} escritas de ${bars.scanned} snapshots revisados`);

  const cal = ingestCalendar();
  if (cal.files === 0) {
    console.log(`calendario economico: sin ficheros en ${cal.dir}`);
    console.log('  (exporta el calendario en .ics o .csv y dejalo ahi)');
  } else {
    console.log(`calendario economico: ${cal.files} ficheros, ${cal.read} eventos, ${cal.added} nuevos`);
    if (cal.floating > 0) {
      console.log(`  aviso: ${cal.floating} eventos del ICS sin zona horaria, tomados como UTC`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
