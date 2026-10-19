import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CALENDAR_DIR, CALENDAR_TZ_OFFSET_HOURS } from '../config.js';
import { db } from '../db/index.js';
import { marketOffsetAt } from '../domain/clock.js';
import { importInvestingJson } from './investing.js';

/**
 * Hora local de Nueva York a UTC, RESPETANDO EL CAMBIO DE HORA.
 *
 * Este era un fallo de verdad y explica los eventos duplicados con una hora de
 * diferencia que llevabamos arrastrando. El desfase estaba fijo en -4, que solo
 * vale de marzo a noviembre: un dato de enero entraba una hora antes de cuando
 * ocurre, y el MISMO evento importado desde dos ficheros distintos acababa en
 * dos filas, porque el identificador lleva la hora dentro.
 *
 * Las webs de calendario exportan en hora de Nueva York, que cambia dos veces
 * al ano. Lo correcto es preguntar el desfase PARA ESA FECHA, y eso es justo lo
 * que hace el resto del diario con marketOffsetAt.
 *
 * Hay un huevo y la gallina: para saber el desfase hace falta el instante, y
 * para el instante hace falta el desfase. Se resuelve en dos pasos — una
 * estimacion y una correccion — que solo puede fallar en la hora exacta del
 * cambio, de madrugada un domingo, cuando no hay datos economicos.
 *
 * Si el usuario fija CALENDAR_TZ_OFFSET_HOURS a algo distinto de -4 (que es el
 * valor por defecto, es decir "no lo he tocado"), manda lo que diga: su
 * calendario puede venir de otra zona.
 */
function localToUtc(wallClockUtc: number): number {
  if (CALENDAR_TZ_OFFSET_HOURS !== -4) {
    return wallClockUtc - CALENDAR_TZ_OFFSET_HOURS * 3600_000;
  }

  const estimado = wallClockUtc - marketOffsetAt(wallClockUtc) * 3600_000;
  return wallClockUtc - marketOffsetAt(estimado) * 3600_000;
}

/**
 * Importa el calendario economico desde ficheros que dejas en una carpeta.
 *
 * Se eligio fichero y no una API por una razon concreta: Quantower no tiene
 * calendario economico (lo que ofrece es un feed de titulares, sin prevision,
 * sin dato real y sin eventos futuros), y las APIs de calendario que existen
 * requieren clave y cambian de plan gratuito cada temporada. Un ICS exportado
 * no depende de nadie, no caduca y lo produce practicamente cualquier web.
 *
 * Acepta .ics y .csv. La importacion es idempotente: reimportar el mismo
 * fichero, o uno actualizado que repita eventos, no duplica nada.
 */

export interface RawEvent {
  ts: number;
  title: string;
  impact: string | null;
  currency: string | null;
  detail: string | null;
}

/** Identificador estable: la misma hora y el mismo evento son el mismo registro. */
function eventId(ts: number, title: string): string {
  return `${ts}|${title.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80)}`;
}

/**
 * Normaliza el impacto a tres niveles. Cada web usa sus propias palabras
 * ("High", "3", "***", "Alto"), y guardarlas tal cual haria imposible filtrar.
 */
function normalizeImpact(value: string | null | undefined): string | null {
  if (!value) return null;

  const v = value.trim().toLowerCase();
  if (/^(high|alto|alta|3|\*{3})$/.test(v) || v.includes('high') || v.includes('alto')) return 'high';
  if (/^(medium|medio|media|moderate|2|\*{2})$/.test(v) || v.includes('medium') || v.includes('medio')) return 'medium';
  if (/^(low|bajo|baja|1|\*)$/.test(v) || v.includes('low') || v.includes('bajo')) return 'low';
  return null;
}

// ---------------------------------------------------------------------------
// ICS
// ---------------------------------------------------------------------------

/**
 * Fecha ICS a epoch ms.
 *
 * Soporta `20261015T123000Z` (UTC) y `20261015T123000` sin zona. La forma sin
 * zona se interpreta en la zona configurada del calendario, no en UTC: las webs
 * de calendario exportan casi siempre en hora de Nueva York, y tomarla como UTC
 * coloca cada dato cuatro horas antes de cuando ocurre.
 */
function parseIcsDate(value: string): { ts: number; floating: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value.trim());
  if (!m) return null;

  const [, y, mo, d, h, mi, s, z] = m;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));

  return {
    // Con Z la hora ya es UTC y no se toca. Sin Z es hora local y hay que
    // convertirla teniendo en cuenta si esa fecha cae en horario de verano.
    ts: z ? utc : localToUtc(utc),
    floating: !z,
  };
}

/** Las lineas ICS se parten a 75 caracteres y continuan con un espacio inicial. */
function unfoldIcs(text: string): string[] {
  const out: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }

  return out;
}

function parseIcs(text: string): { events: RawEvent[]; floating: number } {
  const events: RawEvent[] = [];
  let floating = 0;

  let inEvent = false;
  let current: Partial<RawEvent> & { floating?: boolean } = {};

  for (const line of unfoldIcs(text)) {
    if (line.startsWith('BEGIN:VEVENT')) {
      inEvent = true;
      current = {};
      continue;
    }

    if (line.startsWith('END:VEVENT')) {
      if (inEvent && current.ts && current.title) {
        if (current.floating) floating++;
        events.push({
          ts: current.ts,
          title: current.title,
          impact: current.impact ?? null,
          currency: current.currency ?? null,
          detail: current.detail ?? null,
        });
      }
      inEvent = false;
      continue;
    }

    if (!inEvent) continue;

    // La clave puede traer parametros: DTSTART;TZID=America/New_York:2026...
    const sep = line.indexOf(':');
    if (sep < 0) continue;

    const key = line.slice(0, sep).split(';')[0]!.toUpperCase();
    const value = line.slice(sep + 1);

    if (key === 'DTSTART') {
      const parsed = parseIcsDate(value);
      if (parsed) {
        current.ts = parsed.ts;
        current.floating = parsed.floating;
      }
    } else if (key === 'SUMMARY') {
      current.title = value.replace(/\\,/g, ',').replace(/\\n/gi, ' ').trim();
      // Muchos exportadores meten el impacto y la divisa en el titulo:
      // "USD - Non-Farm Payrolls (High)". Se intenta sacar sin romper nada.
      const cur = /\b([A-Z]{3})\b/.exec(current.title);
      if (cur) current.currency = cur[1]!;
      const imp = /\b(high|medium|low|alto|medio|bajo)\b/i.exec(current.title);
      if (imp) current.impact = normalizeImpact(imp[1]!);
    } else if (key === 'DESCRIPTION') {
      current.detail = value.replace(/\\n/gi, ' ').replace(/\\,/g, ',').trim().slice(0, 500);
      if (!current.impact) {
        const imp = /impact[:\s]*([a-z]+)/i.exec(current.detail);
        if (imp) current.impact = normalizeImpact(imp[1]!);
      }
    }
  }

  return { events, floating };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;

    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';') { out.push(cur); cur = ''; }
    else cur += ch;
  }

  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * CSV con cabecera. Las columnas se detectan por nombre en vez de por posicion,
 * porque cada web exporta en un orden distinto y pedirte que reordenes columnas
 * a mano seria garantizar que un dia se importa mal sin avisar.
 */
function parseCsv(text: string): { events: RawEvent[]; skipped: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { events: [], skipped: 0 };

  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());

  const find = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h === n || h.includes(n)));

  const iDate = find('date', 'fecha', 'day');
  const iTime = find('time', 'hora');
  const iTitle = find('event', 'evento', 'title', 'name', 'nombre', 'description');
  const iImpact = find('impact', 'impacto', 'importance', 'importancia', 'volatility');
  const iCurrency = find('currency', 'divisa', 'country', 'pais', 'moneda');

  if (iDate < 0 || iTitle < 0) return { events: [], skipped: lines.length - 1 };

  const events: RawEvent[] = [];
  let skipped = 0;

  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const date = cols[iDate] ?? '';
    const time = iTime >= 0 ? (cols[iTime] ?? '') : '';
    const title = cols[iTitle] ?? '';

    if (!date || !title) { skipped++; continue; }

    const ts = parseCsvDateTime(date, time);
    if (ts === null) { skipped++; continue; }

    events.push({
      ts,
      title,
      impact: normalizeImpact(iImpact >= 0 ? cols[iImpact] : null),
      currency: iCurrency >= 0 ? (cols[iCurrency] || null) : null,
      detail: null,
    });
  }

  return { events, skipped };
}

/**
 * Fecha y hora de CSV a epoch ms.
 *
 * El CSV nunca lleva zona dentro, asi que se aplica la configurada.
 *
 * Acepta YYYY-MM-DD y DD/MM/YYYY. Se descarta a proposito MM/DD/YYYY: sin saber
 * el origen del fichero no hay forma de distinguir 03/04 de 04/03, y colar el
 * mes por el dia desplazaria eventos semanas enteras. Mejor no importar esa fila
 * que importarla mal.
 */
function parseCsvDateTime(date: string, time: string): number | null {
  let y: number, mo: number, d: number;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date.trim());
  const eu = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(date.trim());

  if (iso) {
    y = Number(iso[1]); mo = Number(iso[2]); d = Number(iso[3]);
  } else if (eu) {
    d = Number(eu[1]); mo = Number(eu[2]); y = Number(eu[3]);
    if (mo > 12) return null;
  } else {
    return null;
  }

  let h = 0, mi = 0;
  const t = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (t) { h = Number(t[1]); mi = Number(t[2]); }

  const ts = localToUtc(Date.UTC(y, mo - 1, d, h, mi));
  return Number.isFinite(ts) ? ts : null;
}

// ---------------------------------------------------------------------------

export interface CalendarIngestResult {
  files: number;
  read: number;
  added: number;
  skipped: number;
  /** Eventos sin zona horaria en el ICS: se les aplico el desfase configurado. */
  floating: number;
  dir: string;
  /** Desfase aplicado a las horas sin zona, para poder comprobarlo. */
  tzOffsetHours: number;
  /** Festivos y medias sesiones leidos del JSON de Investing. */
  holidays: number;
  /** Ocurrencias de Investing que aun no tienen nombre: falta el catalogo. */
  unnamed: number;
  /** Entradas de catalogo aplicadas. */
  named: number;
}

export function ingestCalendar(dir: string = CALENDAR_DIR): CalendarIngestResult {
  const result: CalendarIngestResult = {
    files: 0, read: 0, added: 0, skipped: 0, floating: 0, dir,
    tzOffsetHours: CALENDAR_TZ_OFFSET_HOURS,
    holidays: 0, unnamed: 0, named: 0,
  };

  // Los eventos marcados como 'prueba' son datos SINTETICOS que se generaron
  // para tener algo que ensenar en la pantalla mientras se construia el panel.
  // No son reales: repiten CPI y FOMC cada dos o tres dias, cosa que no ocurre.
  // Se borran en cuanto hay una importacion de verdad para que no convivan con
  // los datos buenos, que es como se acaba tomando una decision con un dato
  // inventado.
  db().prepare("DELETE FROM economic_events WHERE source = 'prueba'").run();

  if (!existsSync(dir) || !statSync(dir).isDirectory()) return result;

  const files = readdirSync(dir).filter((f) => /\.(ics|csv|json)$/i.test(f));
  if (files.length === 0) return result;

  const target = db();
  const insert = target.prepare(
    `INSERT INTO economic_events (id, ts, title, impact, currency, source, detail)
     VALUES (@id, @ts, @title, @impact, @currency, @source, @detail)
     ON CONFLICT (id) DO UPDATE SET
       impact = COALESCE(excluded.impact, economic_events.impact),
       currency = COALESCE(excluded.currency, economic_events.currency),
       detail = COALESCE(excluded.detail, economic_events.detail),
       source = excluded.source`,
  );

  // `changes` vale 1 tanto si la fila se inserto como si el ON CONFLICT la
  // actualizo, asi que no sirve para contar novedades: reimportar el mismo
  // fichero daba "6 nuevos" cuando no habia ninguno. Se cuentan las filas de la
  // tabla antes y despues, que es exacto y no depende de ese detalle.
  const countRows = target.prepare('SELECT COUNT(*) AS n FROM economic_events');

  const run = target.transaction((rows: Array<RawEvent & { source: string }>) => {
    for (const e of rows) {
      insert.run({
        id: eventId(e.ts, e.title),
        ts: e.ts,
        title: e.title.slice(0, 200),
        impact: e.impact,
        currency: e.currency,
        source: e.source,
        detail: e.detail,
      });
    }
  });

  const before = (countRows.get() as { n: number }).n;

  for (const file of files) {
    result.files++;

    let text: string;
    try {
      text = readFileSync(join(dir, file), 'utf8');
    } catch {
      continue;
    }

    // El JSON de Investing va por su cuenta: trae prevision, dato anterior y
    // festivos, que no caben en la forma plana de un ICS. Y sus horas ya vienen
    // en UTC, asi que no pasa por la conversion de zona de aqui.
    if (/\.json$/i.test(file)) {
      const inv = importInvestingJson(text, file);
      result.read += inv.occurrences;
      result.skipped += inv.skipped;
      result.holidays += inv.holidays;
      result.unnamed += inv.unnamed;
      result.named += inv.catalogue;
      continue;
    }

    const isIcs = /\.ics$/i.test(file);
    const parsed = isIcs ? parseIcs(text) : parseCsv(text);
    const events = parsed.events;

    if ('floating' in parsed) result.floating += parsed.floating;
    if ('skipped' in parsed) result.skipped += parsed.skipped;

    result.read += events.length;
    run(events.map((e) => ({ ...e, source: file })));
  }

  result.added = (countRows.get() as { n: number }).n - before;

  return result;
}
