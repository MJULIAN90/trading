import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTO_INGEST, AUTO_INGEST_INTERVAL_MS, MARKET_UTC_OFFSET_HOURS, PORT } from '../config.js';
import { startAutoIngest } from '../ingest/watch.js';
import {
  type Filter,
  bySession,
  byDay,
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
import { allTags, getNote, saveNote, tagImpact } from '../domain/notes.js';
import { applyCosts, costSummary, getCostSettings, setCostSettings } from '../domain/costs.js';
import { excursionOf, excursionSummary } from '../domain/excursion.js';
import { narrate } from '../domain/narrative.js';
import { DEFAULT_SCRATCH, scratchReport } from '../domain/scratch.js';
import { blackoutAt, calendarStatus, eventsBetween, newsImpact } from '../domain/calendar.js';
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
 * includeTests por defecto es false: las pruebas de plataforma distorsionan
 * cualquier metrica y solo deberian verse si se piden explicitamente.
 */
/**
 * Sobre que cifra se calculan las metricas. Neto por defecto: operar cuesta
 * dinero, y un resumen en bruto dice que ganas cuando en realidad pierdes.
 */
function parseBasis(query: Record<string, unknown>): 'gross' | 'net' {
  return query.basis === 'gross' ? 'gross' : 'net';
}

/** Operaciones ya con ticks, comision y neto aplicados. */
function loadOperations(query: Record<string, unknown>) {
  return applyCosts(listOperations(parseFilter(query)), getCostSettings(), parseBasis(query));
}

function parseFilter(query: Record<string, unknown>): Filter {
  return {
    includeTests: query.includeTests === 'true',
    from: typeof query.from === 'string' ? query.from : undefined,
    to: typeof query.to === 'string' ? query.to : undefined,
    session: typeof query.session === 'string' ? query.session : undefined,
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
    byHour: byHour(ops),
    byDirection: byDirection(ops),
    equity: equityCurve(ops),
    behaviour: revengeSplit(ops, 2),
    flagImpact: flagImpact(ops, reviewOperations(ops)),
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

  const data = replay(Number(id), clamp(q.before, 45, 600), clamp(q.after, 30, 600));
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
