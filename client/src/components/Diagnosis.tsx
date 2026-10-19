import type { Replay } from '../api';
import { dist, sessionLabel } from '../format';
import { PatternGlyph } from './PatternGlyph';

/**
 * Todo lo que se sabe de una entrada, en un bloque.
 *
 * Antes esto estaba repartido: la tendencia debajo del grafico, las banderas en
 * otra pestana, el recorrido en una tercera. Para juzgar una entrada hay que
 * ver las cuatro cosas a la vez —donde estaba el mercado, que hizo la vela,
 * donde de la sesion entraste y cuanto se mueve normalmente esa franja— porque
 * cada una sola admite demasiadas explicaciones.
 *
 * Lo que NO hace es decir "bien" o "mal". Con la muestra que hay, un veredicto
 * seria una opinion disfrazada de medida. Se ponen los hechos con su numero al
 * lado y el juicio lo pone quien opero.
 */

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="dg-row">
      <div className="dg-k">{k}</div>
      <div className="dg-v">{children}</div>
    </div>
  );
}

export function Diagnosis({ data }: { data: Replay }) {
  const op = data.operation;
  const long = op.direction === 'LONG';
  const stat = data.sessionStat;
  const ex = data.excursion;

  const marcos = [
    { label: '4 horas', read: data.trend.h4 },
    { label: 'Diaria', read: data.trend.daily },
    { label: 'Semanal', read: data.trend.weekly },
  ];

  const enContra = marcos.filter(
    (m) => m.read && m.read.label !== 'RANGO' && m.read.label !== (long ? 'ALCISTA' : 'BAJISTA'),
  );

  return (
    <div className="panel dg">
      <h2>Diagnostico de la entrada</h2>

      <Row k="Marcos grandes">
        <div className="dg-chips">
          {marcos.map((m) => {
            if (!m.read) return <span key={m.label} className="dg-chip off">{m.label}: sin datos</span>;
            const rango = m.read.label === 'RANGO';
            const favor = m.read.label === (long ? 'ALCISTA' : 'BAJISTA');
            return (
              <span key={m.label} className={`dg-chip ${rango ? 'neutral' : favor ? 'ok' : 'bad'}`}>
                {m.label}: {rango ? 'rango' : favor ? 'a favor' : 'en contra'}
                <b>{m.read.ratio >= 0 ? '+' : ''}{m.read.ratio.toFixed(2)}</b>
              </span>
            );
          })}
        </div>
        {enContra.length > 0 && (
          <div className="note">
            Entraste contra {enContra.length === 1 ? 'la' : 'las'}{' '}
            {enContra.map((m) => m.label.toLowerCase()).join(' y ')}.
          </div>
        )}
      </Row>

      {data.pattern && (
        <Row k="Vela de 15m al entrar">
          <div className="dg-chips">
            <PatternGlyph code={data.pattern.code} size={34} />
            <span>{data.pattern.label}</span>
          </div>
          <div className="note">{data.pattern.help}</div>
        </Row>
      )}

      <Row k="Donde de la sesion">
        {data.minutesIntoSession === null ? (
          <>Fuera de las killzones.</>
        ) : (
          <>
            {sessionLabel(String(op.session))}, a los <b>{data.minutesIntoSession} minutos</b> de
            abrir.
            {data.minutesIntoSession <= 10 && (
              <div className="note">
                En los primeros diez minutos: es donde se concentra el rango y donde el stop se
                barre mas facil.
              </div>
            )}
          </>
        )}
      </Row>

      {stat && (
        <Row k="Lo normal en esa franja">
          <table className="dg-table">
            <thead>
              <tr><th></th><th>El mercado</th><th>Tu operacion</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Llega en contra</td>
                <td className="neg">{dist(stat.advP50)} ticks</td>
                <td className={ex.mae !== null && ex.mae > stat.advP75 ? 'neg' : ''}>
                  {ex.mae === null ? '—' : `${dist(ex.mae)} ticks`}
                </td>
              </tr>
              <tr>
                <td>Llega a favor</td>
                <td className="pos">{dist(stat.favP50)} ticks</td>
                <td className={ex.mfe !== null && ex.mfe >= stat.favP50 ? 'pos' : ''}>
                  {ex.mfe === null ? '—' : `${dist(ex.mfe)} ticks`}
                </td>
              </tr>
              <tr>
                <td>Stop que aguanta 3 de 4</td>
                <td className="neg">{dist(stat.suggestedStop)} ticks</td>
                <td className="note">sugerido por el mercado</td>
              </tr>
              <tr>
                <td>Objetivo que llega la mitad</td>
                <td className="pos">{dist(stat.suggestedTarget)} ticks</td>
                <td className="note">sugerido por el mercado</td>
              </tr>
            </tbody>
          </table>

          <div className="note">
            {ex.mae !== null && ex.mae > stat.advP75 ? (
              <>
                Se fue <b>{dist(ex.mae)} ticks</b> en contra, mas de lo que esta franja hace en tres
                de cada cuatro ocasiones ({dist(stat.advP75)}). No fue ruido normal: el precio hizo
                algo que ahi no suele hacer.
              </>
            ) : ex.mae !== null ? (
              <>
                Los {dist(ex.mae)} ticks que se fue en contra caben dentro del movimiento habitual
                de esta franja. Si te saco de la operacion, el stop estaba dentro del ruido.
              </>
            ) : (
              <>Sin velas suficientes para medir el recorrido.</>
            )}
            {ex.mfe !== null && ex.givenBack !== null && ex.givenBack > stat.favP50 && (
              <>
                {' '}Y devolviste <b>{dist(ex.givenBack)} ticks</b>, mas que el objetivo que esta
                franja alcanza la mitad de las veces.
              </>
            )}
          </div>
        </Row>
      )}

      <div className="note">
        Nada de esto dice si la entrada fue buena o mala, a proposito. Dice donde estaba el mercado,
        que hizo la vela, en que punto de la sesion entraste y cuanto se mueve normalmente esa franja.
        Con las cuatro cosas delante el juicio es tuyo y se puede comprobar; un veredicto automatico
        con esta cantidad de operaciones seria una opinion con aspecto de medida.
      </div>
    </div>
  );
}
