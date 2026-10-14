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
  const all = listOperations(parseFilter(q));
  const reviews = reviewOperations(all);

  const page = Math.max(1, Number(q.page ?? 1));
  const pageSize = Math.min(200, Math.max(5, Number(q.pageSize ?? 25)));

  // Mas reciente primero: es el orden en que se revisa una sesion.
  const ordered = [...all].reverse();
  const filtered = q.onlyFlagged === 'true'
    ? ordered.filter((o) => (reviews.get(o.id)?.decisionAlerts ?? 0) > 0)
    : ordered;

  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize).map((o) => ({
    ...o,
    review: reviews.get(o.id) ?? { operationId: o.id, flags: [], decisionAlerts: 0 },
  }));

  return { items, page, pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / pageSize) || 1 };
});

app.get('/api/review', async (req) => {
  const ops = listOperations(parseFilter(req.query as Record<string, unknown>));
  const reviews = reviewOperations(ops);
  return { config: DEFAULT_REVIEW_CONFIG, impact: flagImpact(ops, reviews) };
});

app.get('/api/summary', async (req) => {
  const ops = listOperations(parseFilter(req.query as Record<string, unknown>));
  return { ...summarize(ops), ...streaks(ops) };
});

app.get('/api/breakdown', async (req) => {
  const ops = listOperations(parseFilter(req.query as Record<string, unknown>));
  return {
    bySession: bySession(ops),
    byDay: byDay(ops),
    byHour: byHour(ops),
    byDirection: byDirection(ops),
  };
});

app.get('/api/equity', async (req) => {
  return equityCurve(listOperations(parseFilter(req.query as Record<string, unknown>)));
});

app.get('/api/behaviour', async (req) => {
  const q = req.query as Record<string, unknown>;
  const ops = listOperations(parseFilter(q));
  const gap = q.gap ? Number(q.gap) : 2;
  return { ...revengeSplit(ops, gap), ...streaks(ops) };
});

/** Todo de una vez, para que el dashboard cargue con una sola peticion. */
app.get('/api/dashboard', async (req) => {
  const f = parseFilter(req.query as Record<string, unknown>);
  const ops = listOperations(f);
  return {
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

/** Ultima vez que la ingesta automatica encontro algo nuevo, para mostrarlo en la pagina. */
let lastIngest: { at: number; operationsNew: number; contextNew: number } | null = null;

app.get('/api/status', async () => ({
  autoIngest: AUTO_INGEST,
  intervalMs: AUTO_INGEST_INTERVAL_MS,
  lastIngest,
}));

app.listen({ port: PORT, host: '127.0.0.1' }).then(() => {
  console.log(`Diario de trading en http://127.0.0.1:${PORT}`);

  if (AUTO_INGEST) {
    startAutoIngest({
      intervalMs: AUTO_INGEST_INTERVAL_MS,
      onIngest: (info) => {
        lastIngest = { at: Date.now(), ...info };
        console.log(
          `[auto-ingest] ${info.operationsNew} operaciones nuevas, ${info.contextNew} snapshots nuevos`,
        );
      },
    });
    console.log(`Ingesta automatica cada ${AUTO_INGEST_INTERVAL_MS / 1000}s (AUTO_INGEST=false para apagarla)`);
  }
});
