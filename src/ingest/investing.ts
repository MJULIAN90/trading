import { db } from '../db/index.js';

/**
 * Lee el JSON que devuelve la API de Investing.
 *
 * POR QUE MERECE LA PENA frente al ICS o al CSV que ya se importaban:
 *
 *   1. La hora viene en UTC de verdad, con la Z puesta. Se acabo adivinar la
 *      zona y se acaba con ella toda la familia de fallos del cambio de hora,
 *      que ya nos costo una tanda de eventos duplicados con una hora de
 *      diferencia.
 *   2. Trae PREVISION y DATO ANTERIOR. Esto es lo gordo: el mercado no
 *      reacciona al dato, reacciona a la diferencia entre el dato y lo que se
 *      esperaba. Un ICS nunca va a poder decir si una vela fue por sorpresa.
 *   3. Distingue preliminar de definitivo, y avisa de revisiones del dato
 *      anterior.
 *   4. Los festivos vienen con las MEDIAS SESIONES marcadas, que es la parte
 *      util: el mercado abre pero la liquidez se cae a media tarde.
 *
 * LO QUE NO TRAE, Y HAY QUE PEDIR APARTE. Las ocurrencias solo llevan
 * `event_id`: ni nombre, ni pais, ni importancia. Eso vive en un catalogo que
 * se descarga por separado. Sin el, los eventos se guardan igual pero con el
 * titulo "Evento #1062", y en cuanto aparezca el catalogo se renombran solos:
 * por eso el identificador de cada fila es el `occurrence_id` del proveedor y
 * no el titulo.
 */

// ---------------------------------------------------------------------------
// Formas que puede tener el JSON
// ---------------------------------------------------------------------------

interface Occurrence {
  event_id?: number;
  occurrence_id?: number;
  occurrence_time?: string;
  forecast?: number;
  previous?: number;
  actual?: number;
  unit?: string;
  precision?: number;
  preliminary?: boolean;
  reference_period?: string;
  previous_revised_from?: number;
  revised_to_previous?: string;
}

interface Holiday {
  exchange?: { short_name?: string; long_name?: string; time_zone?: string };
  exchange_closed?: boolean;
  holiday_name?: string;
  holiday_start?: string;
  holiday_end?: string;
}

/**
 * El catalogo: lo que convierte un event_id en algo legible.
 *
 * Investing usa cuatro nombres distintos para lo mismo y ninguno se llama
 * `name`, que es lo que uno esperaria. Se aceptan todos porque el fichero que
 * te den manana puede traer otro:
 *
 *   event_translated   "IPC (Mensual)"                      <- el mejor
 *   short_name         "IPC"
 *   long_name          "IPC EE.UU. - Inflacion de EE.UU. mensual"
 *   event_meta_title   "IPC EE.UU. - Inflacion de EE.UU. mensual"
 *
 * Se prefiere `event_translated` porque viene traducido y lleva el ciclo
 * dentro: "IPC (Mensual)" y "IPC (Anual)" son dos datos distintos que se
 * publican en dias distintos, y con `short_name` los dos se llamarian "IPC".
 */
interface EventInfo {
  id?: number;
  event_id?: number;
  event_translated?: string;
  short_name?: string;
  long_name?: string;
  event_meta_title?: string;
  name?: string;
  event_name?: string;
  title?: string;
  category?: string;
  country?: string;
  currency?: string;
  importance?: number | string;
  impact?: number | string;
}

/** El nombre mas util de los que traiga la entrada del catalogo. */
function nameOf(row: EventInfo): string | undefined {
  return (
    row.event_translated ||
    row.short_name ||
    row.name ||
    row.event_name ||
    row.title ||
    row.long_name ||
    row.event_meta_title ||
    undefined
  );
}

export interface InvestingResult {
  occurrences: number;
  holidays: number;
  catalogue: number;
  /** Ocurrencias que siguen sin nombre porque falta el catalogo. */
  unnamed: number;
  skipped: number;
}

// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Importancia de Investing: 1 baja, 2 media, 3 alta. */
function impactFrom(value: unknown): string | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === 3) return 'high';
  if (n === 2) return 'medium';
  if (n === 1) return 'low';

  if (typeof value === 'string') {
    const v = value.toLowerCase();
    if (v.includes('high') || v.includes('alta')) return 'high';
    if (v.includes('medium') || v.includes('media') || v.includes('moderate')) return 'medium';
    if (v.includes('low') || v.includes('baja')) return 'low';
  }

  return null;
}

/**
 * Hora local de un mercado a epoch ms.
 *
 * OJO CON ESTO, que es la trampa del fichero de festivos: las marcas llevan una
 * Z al final como si fueran UTC, PERO NO LO SON. El propio JSON trae
 * `time_zone: "US/Eastern"`, y los numeros solo cuadran leidos como hora local:
 * una media sesion marcada a las 13:00 es el cierre anticipado de la una de la
 * tarde de Nueva York. Tomada como UTC serian las ocho de la manana, o sea el
 * mercado cerrado antes de abrir, que no significa nada.
 *
 * Se usa Intl para resolver el desfase de esa fecha concreta, asi que el cambio
 * de hora sale bien sin tablas escritas a mano.
 */
function exchangeLocalToUtc(value: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;

  const [, y, mo, d, h, mi] = m;
  const comoUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));

  // Dos pasadas: con la primera estimacion se averigua el desfase real de esa
  // fecha y con el se corrige. Solo falla en la hora exacta del cambio, de
  // madrugada un domingo, cuando ningun mercado abre ni cierra.
  let ts = comoUtc;
  for (let i = 0; i < 2; i++) {
    ts = comoUtc + offsetAt(ts, timeZone) * 60_000;
  }

  return ts;
}

/** Minutos que hay que sumar a la hora local para obtener UTC. */
function offsetAt(ts: number, timeZone: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(ts))) p[part.type] = part.value;

  const local = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );

  return (ts - local) / 60_000;
}

/** YYYY-MM-DD en la zona del mercado. */
function dayIn(ts: number, timeZone: string): string {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return f.format(new Date(ts));
}

// ---------------------------------------------------------------------------

function isOccurrence(x: unknown): x is Occurrence {
  return !!x && typeof x === 'object' && 'occurrence_time' in (x as object);
}

function isHoliday(x: unknown): x is Holiday {
  return !!x && typeof x === 'object' && 'holiday_start' in (x as object);
}

function isCatalogue(x: unknown): x is EventInfo {
  if (!x || typeof x !== 'object') return false;

  const o = x as Record<string, unknown>;

  // Una ocurrencia tambien lleva event_id, asi que hay que descartarla antes:
  // lo que distingue al catalogo es que NO tiene hora.
  if ('occurrence_time' in o || 'occurrence_id' in o) return false;

  const tieneId = typeof o.id === 'number' || typeof o.event_id === 'number';
  return tieneId && !!nameOf(o as EventInfo);
}

/**
 * Importa un JSON de Investing, sea del tipo que sea.
 *
 * Se detecta la forma por su contenido y no por el nombre del fichero: pedirte
 * que los llames de una manera concreta es garantizar que un dia uno se cuela
 * con otro nombre y no se importa, sin avisar.
 */
export function importInvestingJson(text: string, source: string): InvestingResult {
  const r: InvestingResult = { occurrences: 0, holidays: 0, catalogue: 0, unnamed: 0, skipped: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    r.skipped++;
    return r;
  }

  // Investing a veces envuelve el array en un objeto con una sola clave.
  const arrays: unknown[][] = [];
  const recoger = (v: unknown) => {
    if (Array.isArray(v)) arrays.push(v);
    else if (v && typeof v === 'object') {
      for (const sub of Object.values(v as Record<string, unknown>)) {
        if (Array.isArray(sub)) arrays.push(sub);
      }
    }
  };
  recoger(parsed);

  const target = db();

  const catalogo = target.prepare(
    `INSERT INTO economic_events (id, ts, title, impact, currency, source, event_key)
     VALUES (@id, 0, @title, @impact, @currency, @source, @event_key)
     ON CONFLICT (id) DO NOTHING`,
  );

  // El catalogo se aplica como un UPDATE sobre lo ya importado: los nombres
  // pueden llegar despues que las fechas, y al reves.
  const renombrar = target.prepare(
    `UPDATE economic_events
        SET title = @title,
            impact = COALESCE(@impact, impact),
            currency = COALESCE(@currency, currency),
            detail = COALESCE(@detail, detail)
      WHERE event_key = @event_key`,
  );

  const nombres = new Map<string, { title: string; impact: string | null; currency: string | null }>();

  const insertOcc = target.prepare(
    `INSERT INTO economic_events
       (id, ts, title, impact, currency, source, detail,
        forecast, previous, actual, unit, precision_digits, preliminary,
        reference_period, previous_revised_from, revision, event_key)
     VALUES
       (@id, @ts, @title, @impact, @currency, @source, @detail,
        @forecast, @previous, @actual, @unit, @precision_digits, @preliminary,
        @reference_period, @previous_revised_from, @revision, @event_key)
     ON CONFLICT (id) DO UPDATE SET
       ts = excluded.ts,
       forecast = excluded.forecast,
       previous = excluded.previous,
       actual = COALESCE(excluded.actual, economic_events.actual),
       unit = COALESCE(excluded.unit, economic_events.unit),
       precision_digits = COALESCE(excluded.precision_digits, economic_events.precision_digits),
       preliminary = excluded.preliminary,
       reference_period = COALESCE(excluded.reference_period, economic_events.reference_period),
       previous_revised_from = excluded.previous_revised_from,
       revision = excluded.revision,
       source = excluded.source,
       -- El titulo NO se pisa: puede venir del catalogo, que es mejor que el
       -- "Evento #1062" que genera esta misma importacion.
       title = CASE WHEN economic_events.title LIKE 'Evento #%'
                    THEN excluded.title ELSE economic_events.title END`,
  );

  const insertHol = target.prepare(
    `INSERT INTO market_holidays (id, exchange, name, day, from_ts, to_ts, full_day, source)
     VALUES (@id, @exchange, @name, @day, @from_ts, @to_ts, @full_day, @source)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name,
       from_ts = excluded.from_ts,
       to_ts = excluded.to_ts,
       full_day = excluded.full_day,
       source = excluded.source`,
  );

  const todo = target.transaction(() => {
    // Primero el catalogo, para que las ocurrencias de este mismo fichero ya
    // nazcan con nombre.
    for (const arr of arrays) {
      for (const row of arr) {
        if (!isCatalogue(row)) continue;

        const id = row.id ?? row.event_id;
        const title = nameOf(row);
        if (id === undefined || !title) continue;

        const key = `inv:${id}`;
        const impact = impactFrom(row.importance ?? row.impact);
        const currency = row.currency ?? row.country ?? null;

        nombres.set(key, { title, impact, currency });

        // Renombra lo ya importado. Los nombres pueden llegar DESPUES que las
        // fechas -son dos descargas distintas-, asi que el catalogo tiene que
        // poder aplicarse sobre lo que ya hay sin reimportar nada.
        renombrar.run({ event_key: key, title, impact, currency, detail: row.category ?? null });

        r.catalogue++;
      }
    }

    for (const arr of arrays) {
      for (const row of arr) {
        if (isHoliday(row)) {
          const zona = row.exchange?.time_zone || 'US/Eastern';
          const bolsa = row.exchange?.short_name || row.exchange?.long_name || 'desconocida';

          const from = row.holiday_start ? exchangeLocalToUtc(row.holiday_start, zona) : null;
          const to = row.holiday_end ? exchangeLocalToUtc(row.holiday_end, zona) : null;

          if (from === null || to === null) { r.skipped++; continue; }

          // Dia completo frente a media sesion: lo dice la hora de inicio. A
          // las 00:00 el mercado no abre; a las 13:00 abre y cierra antes.
          const empiezaAlPrincipio = /T00:00/.test(row.holiday_start ?? '');

          insertHol.run({
            id: `${bolsa}|${dayIn(from, zona)}`,
            exchange: bolsa,
            name: row.holiday_name ?? 'festivo',
            day: dayIn(from, zona),
            from_ts: from,
            to_ts: to,
            full_day: empiezaAlPrincipio ? 1 : 0,
            source,
          });

          r.holidays++;
          continue;
        }

        if (!isOccurrence(row) || !row.occurrence_time) continue;

        const ts = Date.parse(row.occurrence_time);
        if (!Number.isFinite(ts)) { r.skipped++; continue; }

        const key = row.event_id !== undefined ? `inv:${row.event_id}` : null;
        const conocido = key ? nombres.get(key) : undefined;

        if (!conocido) r.unnamed++;

        insertOcc.run({
          // El identificador es el del proveedor: asi, si Investing cambia la
          // hora de un dato, la fila se ACTUALIZA en vez de duplicarse. Con el
          // id compuesto por hora+titulo que usa el ICS eso era imposible.
          id: row.occurrence_id !== undefined ? `inv-occ:${row.occurrence_id}` : `inv-ts:${ts}:${row.event_id ?? '?'}`,
          ts,
          title: conocido?.title ?? `Evento #${row.event_id ?? '?'}`,
          impact: conocido?.impact ?? null,
          currency: conocido?.currency ?? null,
          source,
          detail: null,
          forecast: num(row.forecast),
          previous: num(row.previous),
          actual: num(row.actual),
          unit: row.unit ?? null,
          precision_digits: num(row.precision),
          preliminary: row.preliminary ? 1 : 0,
          reference_period: row.reference_period || null,
          previous_revised_from: num(row.previous_revised_from),
          revision:
            row.revised_to_previous && row.revised_to_previous !== 'neutral'
              ? row.revised_to_previous
              : null,
          event_key: key,
        });

        r.occurrences++;
      }
    }
  });

  todo();

  // `catalogo` solo se usa si en el futuro hace falta insertar el catalogo como
  // filas propias; hoy el catalogo unicamente renombra lo ya importado.
  void catalogo;

  return r;
}
