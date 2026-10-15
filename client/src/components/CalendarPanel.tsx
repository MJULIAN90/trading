import { useState } from 'react';
import { api, type CalendarStatus, type NewsImpact } from '../api';
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

export function CalendarPanel({ data, news }: { data: CalendarStatus; news: NewsImpact }) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

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

            <table>
              <thead>
                <tr><th>Cuando</th><th>Impacto</th><th>Divisa</th><th>Evento</th></tr>
              </thead>
              <tbody>
                {data.upcoming.map((e) => {
                  const mins = Math.round((e.ts - now) / 60_000);
                  return (
                    <tr key={e.id} className={e.impact === 'high' ? 'hi' : ''}>
                      <td>
                        {dateTime(e.ts)}
                        {mins >= 0 && mins < 180 && <span className="note"> · en {mins} min</span>}
                      </td>
                      <td><Impact value={e.impact} /></td>
                      <td>{e.currency ?? ''}</td>
                      <td>{e.title}</td>
                    </tr>
                  );
                })}
                {data.upcoming.length === 0 && (
                  <tr><td colSpan={4} className="note">Nada por delante en lo importado.</td></tr>
                )}
              </tbody>
            </table>
          </>
        )}

        <div className="cal-actions">
          <button onClick={doImport} disabled={importing}>
            {importing ? 'importando...' : 'Importar calendario'}
          </button>
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
    </>
  );
}
