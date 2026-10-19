import { useEffect, useState } from 'react';
import { api, type CalendarStatus, type EventPage, type NewsImpact , type MarketHoliday } from '../api';
import { dateTime, num, signClass } from '../format';

/**
 * Calendario economico y ventana de silencio.
 *
 * Los eventos entran por fichero porque Quantower no tiene calendario economico
 * y las APIs del ramo piden clave. Dejas el .ics o el .csv en la carpeta y aqui
 * se lee.
 */

const IMPACT_LABEL: Record<string, string> = { high: 'alto', medium: 'medio', low: 'bajo' };

function Impact({ value }: { value: string | null }) {
  if (!value) return <span className="imp none">—</span>;
  return <span className={`imp ${value}`}>{IMPACT_LABEL[value] ?? value}</span>;
}

/**
 * Un numero del calendario, con su unidad.
 *
 * Los decimales los manda el proveedor en `precision_digits`: un 1,275 M de
 * viviendas y un 199 K de peticiones no se escriben igual, y redondear todo a
 * dos cifras haria que dos previsiones distintas se vieran identicas.
 */
function fmt(v: number | null, e: { unit: string | null; precision_digits: number | null }): string {
  if (v === null || v === undefined) return '—';
  const d = e.precision_digits ?? 1;
  return `${v.toLocaleString('es', { minimumFractionDigits: d, maximumFractionDigits: d })}${e.unit ?? ''}`;
}

export function CalendarPanel({ data, news }: { data: CalendarStatus; news: NewsImpact }) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Busqueda propia, con sus filtros y su paginacion. No usa los de la cabecera
  // a proposito: aquellos filtran OPERACIONES (cuenta, sesion, base) y no
  // tienen nada que ver con los eventos economicos.
  const [q, setQ] = useState('');
  const [impact, setImpact] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Por defecto solo lo que viene. Un dato de hace tres semanas no cambia
  // ninguna decision, y con un ano cargado lo pasado tapa lo que importa.
  const [includePast, setIncludePast] = useState(false);
  const [holidays, setHolidays] = useState<MarketHoliday[]>([]);
  const [events, setEvents] = useState<EventPage | null>(null);

  useEffect(() => { setPage(1); }, [q, impact, from, to, pageSize, includePast]);

  useEffect(() => {
    let cancelled = false;
    // Medio segundo de espera antes de buscar: sin esto cada tecla lanza una
    // peticion, y escribir "employment" dispara diez.
    const t = setTimeout(() => {
      api
        .calendarEvents({ q, impact, from, to, page, pageSize, includePast })
        .then((d) => { if (!cancelled) setEvents(d); })
        .catch(() => {});
    }, 350);

    return () => { cancelled = true; clearTimeout(t); };
  }, [q, impact, from, to, page, pageSize, includePast, result]);

  useEffect(() => {
    api.holidays().then(setHolidays).catch(() => {});
  }, [result]);

  function doClear() {
    if (!confirm('Vaciar el calendario? Se recupera reimportando los ficheros.')) return;
    api
      .clearCalendar()
      .then((r) => setResult(`Calendario vaciado: ${r.deleted} eventos borrados. Importa de nuevo.`))
      .catch((e: Error) => setResult(`Error: ${e.message}`));
  }

  const now = Date.now();
  const stale = data.coverTo !== null && data.coverTo < now;

  function doImport() {
    setImporting(true);
    api
      .importCalendar()
      .then((r) => {
        setResult(
          r.files === 0
            ? `No hay ficheros .ics ni .csv en ${r.dir}`
            : `${r.files} ficheros · ${r.read} eventos leidos · ${r.added} nuevos` +
                (r.floating ? ` · ${r.floating} sin zona horaria, tomados como UTC` : ''),
        );
      })
      .catch((e: Error) => setResult(`Error: ${e.message}`))
      .finally(() => setImporting(false));
  }

  return (
    <>
      {/* El aviso va arriba del todo y a pantalla completa cuando toca: un
          recuadro discreto en mitad de la pagina no sirve para lo que existe. */}
      {data.activeNow.length > 0 && (
        <div className="news-alert">
          <b>No operar</b>
          {data.activeNow.map((b) => (
            <span key={b.event.id}>
              {b.event.title}
              {' · '}
              {b.minutesTo > 0
                ? `en ${b.minutesTo} min`
                : b.minutesTo === 0
                ? 'ahora'
                : `hace ${Math.abs(b.minutesTo)} min`}
            </span>
          ))}
        </div>
      )}

      <div className="panel">
        <h2>Calendario economico</h2>

        {data.total === 0 ? (
          <div className="empty">
            <p>No hay eventos importados.</p>
            <p className="note">
              Exporta el calendario de la web que uses en <b>.ics</b> o <b>.csv</b>, dejalo en la
              carpeta <code>journal/calendar</code> y pulsa importar. La importacion es idempotente:
              reimportar el mismo fichero no duplica nada.
            </p>
          </div>
        ) : (
          <>
            <div className="cal-meta">
              <span>
                {data.total} eventos
                {data.coverTo !== null && <> · hasta {dateTime(data.coverTo)}</>}
              </span>
              {stale && <span className="warn-text">el calendario esta caducado, toca reimportar</span>}
            </div>

            <div className="filters" style={{ marginBottom: 10 }}>
              <label>
                Buscar
                <input
                  type="search"
                  value={q}
                  placeholder="CPI, NFP, Powell..."
                  style={{ width: 200 }}
                  onChange={(e) => setQ(e.target.value)}
                />
              </label>
              <label>
                Impacto
                <select value={impact} onChange={(e) => setImpact(e.target.value)}>
                  <option value="">todos</option>
                  <option value="high">alto</option>
                  <option value="medium">medio</option>
                  <option value="low">bajo</option>
                </select>
              </label>
              <label>Desde <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label>Hasta <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
              <label title="Normalmente solo interesa lo que viene. Enciendelo para repasar una operacion vieja y ver que habia ese dia.">
                <input
                  type="checkbox"
                  checked={includePast}
                  onChange={(e) => setIncludePast(e.target.checked)}
                />
                {' '}Ver tambien lo ya pasado
              </label>
              {(q || impact || from || to || includePast) && (
                <button onClick={() => { setQ(''); setImpact(''); setFrom(''); setTo(''); setIncludePast(false); }}>
                  Limpiar
                </button>
              )}
            </div>

            <table>
              <thead>
                <tr>
                  <th>Cuando</th>
                  <th>Impacto</th>
                  <th>Divisa</th>
                  <th>Evento</th>
                  <th title="Lo que se esperaba. El precio no reacciona al dato, reacciona a la diferencia con esto.">
                    Previsto
                  </th>
                  <th title="El dato de la vez anterior">Anterior</th>
                </tr>
              </thead>
              <tbody>
                {(events?.items ?? []).map((e) => {
                  const mins = Math.round((e.ts - now) / 60_000);
                  return (
                    <tr key={e.id} className={e.impact === 'high' ? 'hi' : ''}>
                      <td>
                        {dateTime(e.ts)}
                        {mins >= 0 && mins < 180 && <span className="note"> · en {mins} min</span>}
                      </td>
                      <td><Impact value={e.impact} /></td>
                      <td>{e.currency ?? ''}</td>
                      <td>
                        {e.title}
                        {e.reference_period && <span className="note"> · {e.reference_period}</span>}
                        {/*
                          Preliminar importa: ese dato se revisa despues, y la
                          revision mueve el precio otra vez. No es lo mismo
                          operar la lectura buena que un adelanto.
                        */}
                        {e.preliminary === 1 && <span className="note"> · preliminar</span>}
                      </td>
                      <td>{fmt(e.forecast, e)}</td>
                      <td>
                        {fmt(e.previous, e)}
                        {e.revision && (
                          <span className={e.revision === 'positive' ? 'pos' : 'neg'}>
                            {' '}(antes {fmt(e.previous_revised_from, e)})
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {events && events.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="note">
                      Ningun evento con esos filtros, de {events.grandTotal} importados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {events && events.pages > 1 && (
              <div className="pager">
                <label>
                  por pagina
                  <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                    {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <span className="note">
                  {events.total} eventos · pag {events.page}/{events.pages}
                </span>
                <button disabled={events.page <= 1} onClick={() => setPage(events.page - 1)}>‹</button>
                <button disabled={events.page >= events.pages} onClick={() => setPage(events.page + 1)}>›</button>
              </div>
            )}
          </>
        )}

        <div className="cal-actions">
          <button onClick={doImport} disabled={importing}>
            {importing ? 'importando...' : 'Importar calendario'}
          </button>
          <button onClick={doClear}>Vaciar calendario</button>
          <span className="note">
            ventana de silencio: {data.blackout.beforeMin} min antes y {data.blackout.afterMin} despues
            de un dato de impacto alto
          </span>
        </div>

        {result && <div className="note">{result}</div>}
      </div>

      <div className="panel">
        <h2>Cuanto te cuesta operar con noticia</h2>

        <table>
          <thead>
            <tr><th></th><th>Operaciones</th><th>Resultado</th><th>Mediana</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Dentro de la ventana</td>
              <td>{news.inside.count}</td>
              <td className={signClass(news.inside.pnl)}>{num(news.inside.pnl)}</td>
              <td className={signClass(news.inside.median ?? 0)}>
                {news.inside.median === null ? '—' : num(news.inside.median)}
              </td>
            </tr>
            <tr>
              <td>Fuera</td>
              <td>{news.outside.count}</td>
              <td className={signClass(news.outside.pnl)}>{num(news.outside.pnl)}</td>
              <td className={signClass(news.outside.median ?? 0)}>
                {news.outside.median === null ? '—' : num(news.outside.median)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="note">
          <p>
            Mira la <b>mediana</b> antes que el total: con pocas operaciones dentro de la ventana,
            una sola grande decide el signo de la suma y hace parecer un patron lo que es una
            casualidad.
          </p>
          <p>
            Esta tabla existe para comprobar si la regla &quot;no operar con noticia&quot; te aplica
            a <b>ti</b>. Puede que te cueste dinero y puede que no; sin medirlo es una norma
            prestada.
          </p>
          {news.inside.count === 0 && data.total > 0 && (
            <p>Ninguna de tus operaciones cae dentro de una ventana de impacto alto importada.</p>
          )}
        </div>
      </div>

      {holidays.length > 0 && (
        <div className="panel">
          <h2>Mercado cerrado y medias sesiones</h2>
          <table>
            <thead>
              <tr><th>Dia</th><th>Que pasa</th><th>Motivo</th></tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.id} className={h.full_day ? '' : 'hi'}>
                  <td>{h.day.slice(8)}/{h.day.slice(5, 7)}</td>
                  <td className={h.full_day ? 'note' : 'neg'}>
                    {h.full_day
                      ? 'cerrado todo el dia'
                      : `media sesion: cierra a las ${dateTime(h.from_ts).slice(6)}`}
                  </td>
                  <td>{h.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note">
            <p>
              <b>Las medias sesiones son la fila que importa</b>, y van marcadas. Un dia cerrado no
              engana a nadie: no se puede operar y punto. En una media sesion si: el mercado abre
              con normalidad, nada te impide entrar, y la liquidez se desploma a partir del cierre
              anticipado. Una operacion de esa tarde no se parece en nada a una de un martes
              cualquiera, y el diario las estaba mezclando sin decir nada.
            </p>
            <p>
              Estas fechas son de las bolsas de acciones (NYSE, NASDAQ). El CME, que es donde se
              negocia tu MNQ, tiene su propio calendario: suele coincidir en los dias y en el
              cierre anticipado, pero <b>no es la misma lista</b>. Para una fecha concreta,
              comprueba en el CME antes de contar con ella.
            </p>
          </div>
        </div>
      )}

    </>
  );
}
