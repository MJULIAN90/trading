import type { PatternReport } from '../api';
import { num, pct, signClass, ticks } from '../format';
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
            <th>Patron de la vela de 15m</th>
            <th title="Cuantas operaciones abriste despues de esa vela">Ops</th>
            <th>Acierto</th>
            <th>P&amp;L</th>
            <th>Por op.</th>
            <th title="Mediana de lo que llego a ir a favor desde tu entrada">A favor (MFE)</th>
            <th title="Mediana de los ticks que llegaste a tener y no te llevaste">Devuelto</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
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
              <td className={signClass(r.pnl)}>{num(r.pnl)}</td>
              <td className={signClass(r.pnl / r.operations)}>{num(r.pnl / r.operations)}</td>
              <td className="pos">{r.medianMfe === null ? '—' : `${ticks(r.medianMfe)} ticks`}</td>
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
