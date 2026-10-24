import type { PatternReport } from '../api';
import { num, pct, signClass, signedUsd, ticks } from '../format';
import { useSort } from '../sortable';
import { PatternGlyph } from './PatternGlyph';

/**
 * Resultados repartidos por el patron de la vela de 15 minutos que estaba
 * cerrada al abrir.
 *
 * Se ensenan juntas las dos preguntas que de verdad se hacen aqui: cuanto
 * dinero dejo cada patron, y cuanto se llego a tener y se devolvio. La segunda
 * separa "mala entrada" de "mala salida", que se corrigen de forma distinta.
 */
export function PatternPanel({ data }: { data: PatternReport }) {
  if (data.rows.length === 0) {
    return (
      <div className="empty">
        Todavia no hay velas capturadas para clasificar. Enciende &quot;Guardar contexto para el
        diario&quot; en j_Flujo.
      </div>
    );
  }

  const total = data.rows.reduce((a, r) => a + r.operations, 0);

  const tabla = useSort(
    data.rows,
    {
      patron: (r) => r.label,
      ops: (r) => r.operations,
      acierto: (r) => (r.operations > 0 ? r.wins / r.operations : 0),
      pnl: (r) => r.pnl,
      porop: (r) => (r.operations > 0 ? r.pnl / r.operations : 0),
      mfe: (r) => r.medianMfe,
      resultado: (r) => r.medianResult,
      devuelto: (r) => r.medianGivenBack,
    },
    null,
  );

  return (
    <>
      <div className="news-alert" style={{ marginBottom: 10 }}>
        <b>Cuidado al leer esto</b>
        <span>
          {total} operaciones repartidas en {data.rows.length} patrones. Con cubos de cinco o diez,
          una sola operacion grande mueve la media entera. Sirve para abrir y mirar las operaciones
          de un patron, no para decidir cual funciona.
        </span>
      </div>

      <table>
        <thead>
          <tr>
            <tabla.Th k="patron">Patron de la vela de 15m</tabla.Th>
            <tabla.Th k="ops" title="Cuantas operaciones abriste despues de esa vela">Ops</tabla.Th>
            <tabla.Th k="acierto">Acierto</tabla.Th>
            <tabla.Th k="pnl" title="SUMA de todas. Dos operaciones grandes la levantan entera.">P&amp;L</tabla.Th>
            <tabla.Th k="porop" title="Media. Tambien se la llevan dos operaciones grandes.">Por op.</tabla.Th>
            <tabla.Th k="mfe" title="Mediana de lo que llego a ir a favor desde tu entrada">A favor (MFE)</tabla.Th>
            <tabla.Th
              k="resultado"
              title="Mediana del resultado. Sale del MISMO grupo que el MFE, asi que estas dos si se pueden comparar: la diferencia entre las dos es lo que devuelve la operacion tipica."
            >
              Acabo en
            </tabla.Th>
            <tabla.Th
              k="devuelto"
              title="Mediana de los ticks que llegaste a tener y no te llevaste. OJO: solo cuenta las operaciones que llegaron a ir a favor, asi que sale de un grupo mas pequeño y NO se puede restar del MFE."
            >
              Devuelto
            </tabla.Th>
          </tr>
        </thead>
        <tbody>
          {tabla.rows.map((r) => (
            <tr key={r.code}>
              <td title={r.help}>
                <span className="pat-cell">
                  <PatternGlyph code={r.code} />
                  <span>
                    {r.label}
                {/* Menos de cinco operaciones no es una muestra, es una anecdota.
                    Se marca en la propia fila para que no haga falta acordarse. */}
                    {r.operations < 5 && (
                      <span style={{ color: 'var(--ink-muted)', fontSize: 11 }}> · muy pocas</span>
                    )}
                  </span>
                </span>
              </td>
              <td>{r.operations}</td>
              <td>{pct(r.wins / r.operations)}</td>
              <td className={signClass(r.pnl)}>{signedUsd(r.pnl)}</td>
              <td className={signClass(r.pnl / r.operations)}>{signedUsd(r.pnl / r.operations)}</td>
              <td className="pos">{r.medianMfe === null ? '—' : `${ticks(r.medianMfe)} ticks`}</td>
              <td className={r.medianResult === null ? '' : signClass(r.medianResult)}>
                {r.medianResult === null ? '—' : `${ticks(r.medianResult)} ticks`}
              </td>
              <td className="neg">
                {r.medianGivenBack === null ? '—' : `${ticks(r.medianGivenBack)} ticks`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="note">
        Se clasifica la vela de 15 minutos <b>ya cerrada</b> en el momento de abrir, nunca la que
        estaba formandose: esa todavia podia acabar en cualquier sitio, y usar su cierre definitivo
        seria mirar el futuro. Si tu entrada reaccionaba a lo que pasaba <i>dentro</i> de la vela en
        curso, esta fila no describe lo que viste.
        <br />
        Las definiciones son geometricas y se miden sobre el rango de la propia vela, asi que valen
        igual en un dia tranquilo que en uno volatil. Pasa el raton por el nombre para ver cada una.
        {data.incomplete > 0 && (
          <>
            <br />
            <b>{data.incomplete}</b> de esas velas no tenian los 15 minutos completos por huecos en
            la captura.
          </>
        )}
        {data.skipped > 0 && (
          <>
            <br />
            <b>{data.skipped}</b> operaciones quedan fuera por no tener velas suficientes antes.
          </>
        )}
      </div>
    </>
  );
}
