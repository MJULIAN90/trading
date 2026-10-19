import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTO_INGEST, AUTO_INGEST_INTERVAL_MS, MARKET_UTC_OFFSET_HOURS, PORT } from '../config.js';
import { startAutoIngest } from '../ingest/watch.js';
import { db } from '../db/index.js';
import {
  type Filter,
  bySession,
  byDay,
  byWeekday,
  byDirection,
  byHour,
  equityCurve,
  listOperations,
  revengeSplit,
  streaks,
  summarize,
} from '../domain/metrics.js';
import { DEFAULT_REVIEW_CONFIG, flagImpact, reviewOperations } from '../domain/review.js';
import { barsBySymbol, refreshBars } from '../domain/bars.js';
import { marketDate } from '../domain/sessions.js';
import { replay } from '../domain/replay.js';
import { patternReport } from '../domain/pattern.js';
import { TIMEFRAMES, getChartPrefs, setChartPrefs } from '../domain/prefs.js';
import { sessionStats } from '../domain/sessionStats.js';
import { patternStudy } from '../domain/study.js';
import { patternGrid } from '../domain/grid.js';
import { accounts } from '../domain/metrics.js';
import { allTags, getNote, saveNote, tagImpact } from '../domain/notes.js';
import { applyCosts, costSummary, getCostSettings, setCostSettings } from '../domain/costs.js';
import { excursionOf, excursionSummary } from '../domain/excursion.js';
import { narrate } from '../domain/narrative.js';
import { DEFAULT_SCRATCH, scratchReport } from '../domain/scratch.js';
import {
  blackoutAt,
  calendarStatus,
  clearEvents,
  eventsBetween,
  newsImpact,
  searchEvents,
  upcomingHolidays,
} from '../domain/calendar.js';
import { ingestCalendar } from '../ingest/calendar.js';
import { pruneContext, storageReport } from '../domain/storage.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: false });

// @fastify/static se niega a arrancar si la carpeta no existe, y lo que falla
// entonces es el servidor entero con un ENOENT que no dice nada. Mejor avisar de
// lo que de verdad pasa: falta compilar el front.
const webRoot = join(here, '..', '..', 'web');
if (!existsSync(webRoot)) {
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(
    join(webRoot, 'index.html'),
    '<!doctype html><meta charset="utf-8"><title>Diario de trading</title>' +
      '<body style="font:14px system-ui;background:#0f1116;color:#e8eaf0;padding:40px">' +
      '<h1>Falta compilar el front</h1><p>Ejecuta <code>pnpm build</code> (o <code>npm run build</code>) y recarga.</p>' +
      '<p>La API ya funciona: <a style="color:#5aaaff" href="/api/summary">/api/summary</a></p>',
  );
  console.warn('[web] no habia build del front; se ha dejado una pagina de aviso. Ejecuta "pnpm build".');
}

await app.register(fastifyStatic, { root: webRoot });

/**
 * Los filtros son los mismos en todos los endpoints, asi que se parsean una vez.
 *
 * Por defecto entra TODO lo de la cuenta elegida. Antes se escondian las
 * operaciones anteriores a `REAL_TRADING_SINCE`, pero esa fecha la elegi yo a
 * ojo y resulto coincidir exactamente con un cambio de cuenta: la cuenta la
 * dice el broker, asi que filtrar por ella es un hecho y filtrar por la fecha
 * era una suposicion. Para dejar fuera un dia concreto de pruebas dentro de una
 * misma cuenta estan el filtro de fechas y el calendario.
 */
/**
 * Sobre que cifra se calculan las metricas. Neto por defecto: operar cuesta
 * dinero, y un resumen en bruto dice que ganas cuando en realidad pierdes.
 */
function parseBasis(query: Record<string, unknown>): 'gross' | 'net' {
  return query.basis === 'gross' ? 'gross' : 'net';
}

/**
 * El simbolo con mas velas capturadas.
 *
 * Los estudios se hacen sobre UN instrumento: mezclar MNQ con ENQ sumaria
 * ticks que valen dinero distinto y rangos que no son comparables.
 */
function defaultSymbol(): string {
  const row = db()
    .prepare('SELECT symbol FROM bars GROUP BY symbol ORDER BY COUNT(*) DESC LIMIT 1')
    .get() as { symbol: string } | undefined;
  return row?.symbol ?? 'MNQZ26';
}

/** Operaciones ya con ticks, comision y neto aplicados. */
function loadOperations(query: Record<string, unknown>) {
  return applyCosts(listOperations(parseFilter(query)), getCostSettings(), parseBasis(query));
}

function parseFilter(query: Record<string, unknown>): Filter {
  return {
    excludeTests: query.excludeTests === 'true',
    from: typeof query.from === 'string' ? query.from : undefined,
    to: typeof query.to === 'string' ? query.to : undefined,
    session: typeof query.session === 'string' ? query.session : undefined,
    account: typeof query.account === 'string' && query.account ? query.account : undefined,
  };
}

app.get('/api/operations', async (req) => {
  const q = req.query as Record<string, unknown>;
  const all = loadOperations(q);
  const reviews = reviewOperations(all);

  const page = Math.max(1, Number(q.page ?? 1));
  const pageSize = Math.min(200, Math.max(5, Number(q.pageSize ?? 25)));

  // Mas reciente primero: es el orden en que se revisa una sesion.
  const ordered = [...all].reverse();

  const direction = q.direction === 'LONG' || q.direction === 'SHORT' ? q.direction : null;

  // Ganadoras / perdedoras se decide DESPUES de aplicar comisiones, no en la
  // consulta: una operacion de +0,50 en bruto es perdedora en neto, y filtrar
  // por el bruto ensenaria en verde algo que la tabla pinta en rojo. El cero va
  // con las perdedoras: salir en plano no es ganar.
  const result = q.result === 'win' || q.result === 'loss' ? q.result : null;

  // Varias sesiones separadas por coma. Lista vacia = sin filtrar, para que
  // deseleccionar el ultimo boton devuelva el listado completo en vez de dejarlo
  // en blanco.
  const sessions =
    typeof q.sessions === 'string' && q.sessions.length > 0 ? new Set(q.sessions.split(',')) : null;

  const days =
    typeof q.days === 'string' && q.days.length > 0 ? new Set(q.days.split(',')) : null;

  const beforeDays = ordered
    .filter((o) => (q.onlyFlagged === 'true' ? (reviews.get(o.id)?.decisionAlerts ?? 0) > 0 : true))
    .filter((o) => (direction ? o.direction === direction : true))
    .filter((o) => (result === 'win' ? o.gross_pnl > 0 : result === 'loss' ? o.gross_pnl <= 0 : true))
    .filter((o) => (sessions ? sessions.has(o.session) : true));

  // El catalogo de dias se saca ANTES de aplicar el filtro de dias. Si se sacara
  // despues, al elegir un dia desapareceria el resto de botones y no habria
  // forma de cambiar de dia sin limpiar el filtro primero.
  const dayIndex = new Map<string, { date: string; count: number; pnl: number }>();

  for (const o of beforeDays) {
    const d = marketDate(o.opened_at);
    const cur = dayIndex.get(d) ?? { date: d, count: 0, pnl: 0 };
    cur.count++;
    cur.pnl += o.gross_pnl;
    dayIndex.set(d, cur);
  }

  const dayList = [...dayIndex.values()]
    .map((d) => ({ ...d, pnl: Number(d.pnl.toFixed(2)) }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const filtered = beforeDays.filter((o) => (days ? days.has(marketDate(o.opened_at)) : true));

  const start = (page - 1) * pageSize;

  // El recorrido se calcula SOLO para la pagina que se devuelve. Es una consulta
  // agregada por operacion, barata pero no gratis: hacerla sobre las 86 cuando
  // solo se ven 50 seria trabajo tirado, y con mil operaciones se notaria.
  const items = filtered.slice(start, start + pageSize).map((o) => ({
    ...o,
    review: reviews.get(o.id) ?? { operationId: o.id, flags: [], decisionAlerts: 0 },
    excursion: excursionOf(o),
  }));

  // Totales del conjunto filtrado, no solo de la pagina: al filtrar por compras
  // interesa cuanto suman TODAS las compras, no las veinticinco que se ven.
  const totals = costSummary(filtered);

  return {
    items,
    page,
    pageSize,
    total: filtered.length,
    totalPages: Math.ceil(filtered.length / pageSize) || 1,
    totals,
    days: dayList,
  };
});

app.get('/api/review', async (req) => {
  const ops = loadOperations(req.query as Record<string, unknown>);
  const reviews = reviewOperations(ops);
  return { config: DEFAULT_REVIEW_CONFIG, impact: flagImpact(ops, reviews) };
});

app.get('/api/summary', async (req) => {
  const ops = loadOperations(req.query as Record<string, unknown>);
  return { ...summarize(ops), ...streaks(ops), costs: costSummary(ops) };
});

app.get('/api/breakdown', async (req) => {
  const ops = loadOperations(req.query as Record<string, unknown>);
  return {
    bySession: bySession(ops),
    byDay: byDay(ops),
    byWeekday: byWeekday(ops),
    byHour: byHour(ops),
    byDirection: byDirection(ops),
  };
});

app.get('/api/equity', async (req) => {
  return equityCurve(loadOperations(req.query as Record<string, unknown>));
});

app.get('/api/behaviour', async (req) => {
  const q = req.query as Record<string, unknown>;
  const ops = loadOperations(q);
  const gap = q.gap ? Number(q.gap) : 2;
  return { ...revengeSplit(ops, gap), ...streaks(ops) };
});

/**
 * Preferencias de presentacion. GET para leerlas, PUT para guardarlas.
 *
 * Se validan en el servidor y no en la pantalla: la pantalla es una de varias
 * formas de llegar aqui, y un color invalido guardado una vez rompe el grafico
 * en todas las sesiones siguientes.
 */
app.get('/api/prefs/chart', async () => getChartPrefs());

app.put('/api/prefs/chart', async (req) => setChartPrefs(req.body as Record<string, unknown>));

/** Todo de una vez, para que el dashboard cargue con una sola peticion. */
app.get('/api/dashboard', async (req) => {
  const q = req.query as Record<string, unknown>;
  const ops = loadOperations(q);
  return {
    basis: parseBasis(q),
    costSettings: getCostSettings(),
    costs: costSummary(ops),
    excursion: excursionSummary(ops),
    scratch: scratchReport(ops),
    calendar: calendarStatus(),
    news: newsImpact(ops),
    // El cliente formatea las horas con este desfase, nunca con la zona del
    // navegador: lo que se ve aqui tiene que coincidir con lo que marcaba el
    // grafico mientras operabas, no con donde este sentado quien lo mira.
    marketOffsetHours: MARKET_UTC_OFFSET_HOURS,
    summary: { ...summarize(ops), ...streaks(ops) },
    bySession: bySession(ops),
    byDay: byDay(ops),
    byWeekday: byWeekday(ops),
    byHour: byHour(ops),
    byDirection: byDirection(ops),
    equity: equityCurve(ops),
    behaviour: revengeSplit(ops, 2),
    flagImpact: flagImpact(ops, reviewOperations(ops)),
    patterns: patternReport(ops),
    accounts: accounts(),
    chartPrefs: getChartPrefs(),
    range: ops.length ? { from: ops[0]!.opened_at, to: ops[ops.length - 1]!.opened_at } : null,
    count: ops.length,
  };
});

/**
 * Reconstruccion del grafico de una operacion: las velas de su ventana, las
 * ejecuciones y la cobertura de captura.
 *
 * `before` y `after` en minutos, acotados: pedir un dia entero de velas de un
 * minuto son 1.440 puntos que el navegador dibuja pero nadie lee.
 */
app.get('/api/operations/:id/replay', async (req, reply) => {
  const { id } = req.params as { id: string };
  const q = req.query as Record<string, unknown>;

  const clamp = (v: unknown, def: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
  };

  const prefs = getChartPrefs();

  // La temporalidad manda sobre la ventana: pedir "180 velas" significa cosas
  // muy distintas en 1m y en 4h, y lo que el usuario quiere ver siempre es un
  // numero de velas, no un numero de minutos.
  const tf = (TIMEFRAMES as readonly number[]).includes(Number(q.timeframe))
    ? Number(q.timeframe)
    : prefs.timeframe;

  const candles = clamp(q.candles, prefs.candles, 1000);
  const span = candles * tf;

  const data = replay(
    Number(id),
    clamp(q.before, Math.round(span * prefs.beforeShare), 200_000),
    clamp(q.after, Math.round(span * (1 - prefs.beforeShare)), 200_000),
    tf,
  );
  if (!data) return reply.code(404).send({ error: 'operacion no encontrada' });

  // La operacion se devuelve ya con ticks, comision y neto, y con el recorrido
  // que hizo mientras estuvo abierta. Es lo que convierte el grafico en un
  // analisis: no solo donde entraste, sino cuanto aguantaste en contra.
  const op = data.operation as unknown as Parameters<typeof excursionOf>[0];
  const [enriched] = applyCosts([op], getCostSettings(), 'gross');

  return {
    ...data,
    operation: enriched,
    excursion: excursionOf(op),
    narrative: narrate(enriched!),
  };
});

/** Ajustes editables desde la propia aplicacion. */
/**
 * Solo la lectura en prosa de una operacion.
 *
 * Existe para no pedir el replay entero cuando lo unico que se quiere son las
 * frases: la pestana de lectura no necesita ni una vela, y arrastrarlas hacia
 * el navegador para tirarlas es gratis en 1m y carisimo en 4h.
 */
app.get('/api/operations/:id/reading', async (req, reply) => {
  const { id } = req.params as { id: string };

  const op = db().prepare('SELECT * FROM operations WHERE id = ?').get(Number(id)) as
    | Parameters<typeof narrate>[0]
    | undefined;

  if (!op) return reply.code(404).send({ error: 'operacion no encontrada' });

  const [enriched] = applyCosts([op as never], getCostSettings(), 'gross');
  return narrate(enriched!);
});

/**
 * Cuanto se mueve el mercado en cada killzone. No mide tus operaciones: mide
 * las velas, asi que vale aunque no hayas operado nunca esa franja.
 */
app.get('/api/sessions/stats', async (req) => {
  const q = req.query as Record<string, unknown>;
  const symbol = typeof q.symbol === 'string' && q.symbol ? q.symbol : defaultSymbol();

  return sessionStats(symbol, {
    horizonMin: Number(q.horizonMin) || undefined,
    stopPct: Number(q.stopPct) || undefined,
    targetR: Number(q.targetR) || undefined,
  });
});

/** Estudio de patrones a favor de la 4h sobre todo el historico de velas. */
app.get('/api/study/patterns', async (req) => {
  const q = req.query as Record<string, unknown>;
  const symbol = typeof q.symbol === 'string' && q.symbol ? q.symbol : defaultSymbol();

  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], def: T): T =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : def;

  return patternStudy(symbol, {
    timeframe: Number(q.timeframe) || 15,
    targetTicks: Number(q.targetTicks) || 40,
    horizonMin: Number(q.horizonMin) || 60,
    trendMinutes: Number(q.trendMinutes) || 240,
    trendLookback: Number(q.trendLookback) || 6,
    trendMode: oneOf(q.trendMode, ['rango', 'emas'] as const, 'rango'),
    retest: oneOf(q.retest, ['ninguno', 'ema8', 'ema21', 'cualquiera'] as const, 'ninguno'),
    requireStack: q.requireStack === 'true',
    stopMode: oneOf(q.stopMode, ['fijo', 'estructural'] as const, 'fijo'),
    targetR: Number(q.targetR) || 2,
  });
});

/**
 * Todas las combinaciones de patron, temporalidad, tendencia y sentido, con la
 * correccion por numero de pruebas incluida.
 */
app.get('/api/study/grid', async (req) => {
  const q = req.query as Record<string, unknown>;
  const symbol = typeof q.symbol === 'string' && q.symbol ? q.symbol : defaultSymbol();

  return patternGrid(symbol, {
    targetTicks: Number(q.targetTicks) || 40,
    horizonMin: Number(q.horizonMin) || 60,
    minSamples: Number(q.minSamples) || 120,
  });
});

app.get('/api/settings', async () => getCostSettings());

app.put('/api/settings', async (req) => {
  const body = (req.body ?? {}) as { commissionPerContract?: unknown };
  return setCostSettings({ commissionPerContract: Number(body.commissionPerContract) });
});

/**
 * Salidas en plano y que paso despues. Los tres umbrales son ajustables por
 * query para poder probar otras definiciones sin tocar codigo.
 */
app.get('/api/scratch', async (req) => {
  const q = req.query as Record<string, unknown>;
  const n = (v: unknown, def: number, min: number, max: number) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def;
  };

  return scratchReport(loadOperations(q), {
    maxTicks: n(q.maxTicks, DEFAULT_SCRATCH.maxTicks, 0, 50),
    horizonMinutes: n(q.horizon, DEFAULT_SCRATCH.horizonMinutes, 1, 480),
    targetTicks: n(q.target, DEFAULT_SCRATCH.targetTicks, 2, 400),
  });
});

/** Calendario economico: estado, proximos eventos y ventana activa. */
app.get('/api/calendar', async (req) => {
  const q = req.query as Record<string, unknown>;

  if (typeof q.from === 'string' && typeof q.to === 'string') {
    return eventsBetween(Number(q.from), Number(q.to), q.onlyHigh === 'true');
  }

  return calendarStatus();
});

/** Relee la carpeta de calendarios. Se llama al pulsar "importar" en la pagina. */
app.post('/api/calendar/import', async () => ingestCalendar());

/**
 * Busqueda sobre el calendario: texto, impacto, fechas y paginas.
 *
 * Endpoint aparte y no dentro de `/api/dashboard` a proposito: los filtros de
 * la cabecera (cuenta, sesion, base) son de OPERACIONES y no tienen nada que
 * ver con los eventos economicos. Mezclarlos haria que elegir una cuenta
 * cambiara el calendario, que es justo lo que no debe pasar.
 */
app.get('/api/calendar/events', async (req) => {
  const q = req.query as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

  return searchEvents({
    q: str(q.q),
    impact: q.impact === 'high' || q.impact === 'medium' || q.impact === 'low' ? q.impact : undefined,
    from: str(q.from),
    to: str(q.to),
    page: Number(q.page) || 1,
    pageSize: Number(q.pageSize) || 25,
    includePast: q.includePast === 'true',
  });
});

/** Festivos y medias sesiones que vienen. */
app.get('/api/calendar/holidays', async () => upcomingHolidays());

/** Vacia el calendario. Se recupera reimportando los ficheros, que siguen ahi. */
app.delete('/api/calendar/events', async () => clearEvents());

/** Si un instante concreto cae dentro de una ventana de noticia. */
app.get('/api/calendar/blackout', async (req) => {
  const q = req.query as Record<string, unknown>;
  const ts = Number(q.ts ?? Date.now());
  return blackoutAt(Number.isFinite(ts) ? ts : Date.now(), { onlyHigh: q.onlyHigh !== 'false' });
});

/** MAE y MFE del conjunto filtrado: donde esta de verdad el stop. */
app.get('/api/excursion', async (req) => excursionSummary(loadOperations(req.query as Record<string, unknown>)));

app.get('/api/operations/:id/notes', async (req) => {
  const { id } = req.params as { id: string };
  return getNote(Number(id));
});

app.put('/api/operations/:id/notes', async (req) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { note?: unknown; tags?: unknown };

  const note = typeof body.note === 'string' ? body.note : '';
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : [];

  return saveNote(Number(id), note, tags);
});

/** Cuanto suma cada etiqueta, y el catalogo para autocompletar. */
app.get('/api/tags', async () => ({ impact: tagImpact(), all: allTags() }));

/** Cuanto ocupa la base y donde. */
app.get('/api/storage', async () => storageReport());

/**
 * Purga el crudo ya derivado. Hay que pasar los dias explicitamente: es la
 * unica operacion irreversible del diario y no debe poder dispararse por un
 * valor por defecto olvidado en la configuracion.
 */
app.post('/api/storage/prune', async (req, reply) => {
  const days = Number((req.query as Record<string, unknown>).days);
  if (!Number.isFinite(days) || days < 7) {
    return reply.code(400).send({ error: 'indica days >= 7' });
  }
  return pruneContext(days);
});

/** Diagnostico: que simbolos y cuantas velas hay derivadas. */
app.get('/api/bars/status', async () => ({ symbols: barsBySymbol() }));

/** Rehace la tabla de velas desde cero. Solo hace falta si se anade una columna. */
app.post('/api/bars/rebuild', async () => refreshBars(true));

/** Ultima vez que la ingesta automatica encontro algo nuevo, para mostrarlo en la pagina. */
let lastIngest: { at: number; operationsNew: number; contextNew: number } | null = null;

app.get('/api/status', async () => ({
  autoIngest: AUTO_INGEST,
  intervalMs: AUTO_INGEST_INTERVAL_MS,
  lastIngest,
}));

// Al arrancar se ponen al dia las velas derivadas. Es incremental, asi que la
// primera vez tarda unos segundos (hay 111.000 snapshots) y a partir de ahi es
// instantaneo.
{
  const r = refreshBars();
  if (r.written > 0) console.log(`[bars] ${r.written} velas derivadas al arrancar`);
}

app.listen({ port: PORT, host: '127.0.0.1' }).then(() => {
  console.log(`Diario de trading en http://127.0.0.1:${PORT}`);

  if (AUTO_INGEST) {
    startAutoIngest({
      intervalMs: AUTO_INGEST_INTERVAL_MS,
      onIngest: (info) => {
        // Las velas se derivan justo despues de cada ingesta, para que el
        // grafico de una operacion recien cerrada ya tenga sus velas.
        refreshBars();
        lastIngest = { at: Date.now(), ...info };
        console.log(
          `[auto-ingest] ${info.operationsNew} operaciones nuevas, ${info.contextNew} snapshots nuevos`,
        );
      },
    });
    console.log(`Ingesta automatica cada ${AUTO_INGEST_INTERVAL_MS / 1000}s (AUTO_INGEST=false para apagarla)`);
  }
});
