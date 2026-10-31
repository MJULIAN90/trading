import type { SessionDrawdownReport } from '../api';
import { num, sessionLabel, signClass, signedUsd, usd } from '../format';

/**
 * El drawdown dentro de cada killzone.
 *
 * Tres bloques, y el orden no es decorativo: va de lo que se puede usar a lo
 * que no.
 *
 *   1. CUANTO HOYO HACE CADA FRANJA. Aritmetica. Sirve para dimensionar la
 *      cuenta y para saber cual te obliga a aguantar mas.
 *   2. LOS HUECOS. Un tercio de las operaciones cae en "Fuera", que no es un
 *      sitio sino cinco huecos entre killzones. Partirlos destapo la hora que
 *      mas dinero cuesta del mes entero.
 *   3. SI EXISTE UN NIVEL AL QUE PARAR. Inferencia, y la unica de las tres que
 *      hay que demostrar. Sale la ultima porque, con los datos de octubre, la
 *      respuesta es que no.
 */

const hhmm = (h: number) =>
  `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

export function SessionDrawdownPanel({ data }: { data: SessionDrawdownReport }) {
  if (data.rows.length === 0) {
    return <div className="empty">Sin operaciones en el filtro.</div>;
  }

  const limite = data.dailyLossLimit > 0;

  return (
    <>
      {/* ---------------------------------------------------- 1. el drawdown */}
      <div className="panel">
        <h2>El drawdown de cada franja</h2>
        <div className="note" style={{ marginBottom: 10 }}>
          El <b>drawdown</b> es cuanto bajaste desde tu mejor momento <b>dentro de esa franja y
          ese dia</b>, no desde cero: la cuenta empieza plana cuando te sientas. Es lo que
          tuviste que aguantar para llegar al final, y no se deduce del resultado — una franja
          puede acabar en verde despues de haber estado quinientos abajo.
          <br />
          Dolares <b>por contrato</b>, en bruto.
        </div>

        <table>
          <thead>
            <tr>
              <th className="izq">Franja</th>
              <th title="Jornadas en las que operaste esta franja. Es la unidad de toda la tabla.">
                Jornadas
              </th>
              <th>Ops</th>
              <th>Total</th>
              <th title="Resultado por operacion. Es la cifra comparable entre franjas.">$/op</th>
              <th title="El drawdown de una jornada normal.">Drawdown tipico</th>
              <th title="Una de cada cuatro jornadas llega a un drawdown mayor que este.">Drawdown p75</th>
              <th title="El peor drawdown de una sola jornada.">Peor dia</th>
              <th title="Drawdown de la curva de la franja encadenando todas sus jornadas. Es otra cosa que el peor dia: una franja puede no haber tenido nunca un dia horrible y llevar mil de drawdown acumulado a base de dias malos pequenios.">
                Acumulado
              </th>
              <th>Verdes</th>
              <th title="Operaciones perdedoras seguidas dentro de una misma franja.">Racha</th>
              {limite && (
                <th title={`Jornadas cuyo drawdown llego a tu limite diario de ${usd(data.dailyLossLimit)}.`}>
                  Pasan limite
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              // Con dos jornadas, ninguna cifra de la fila significa nada. Se
              // apaga en vez de esconderse: que Londres casi no exista ES el
              // dato de Londres.
              <tr key={r.session} className={r.days < 5 ? 'apagada' : ''}>
                <td className="izq">
                  <b>{sessionLabel(r.session)}</b>
                </td>
                <td>{r.days}</td>
                <td>{r.trades}</td>
                <td className={signClass(r.total)}>{signedUsd(r.total, 0)}</td>
                <td className={signClass(r.perTrade)}>{signedUsd(r.perTrade)}</td>
                <td>{usd(r.drawdownMedian, 0)}</td>
                <td>{usd(r.drawdownP75, 0)}</td>
                <td className="neg">
                  {usd(r.drawdownWorst, 0)}
                  {r.drawdownWorstDay && (
                    <span className="note" style={{ display: 'block', fontSize: 10 }}>
                      {r.drawdownWorstDay.slice(8)}/{r.drawdownWorstDay.slice(5, 7)}
                    </span>
                  )}
                </td>
                <td className="neg">{usd(r.chainedDrawdown, 0)}</td>
                <td>
                  {r.greenDays}/{r.days}
                </td>
                <td>{r.worstStreak}</td>
                {limite && <td className={r.overLimit ? 'neg' : ''}>{r.overLimit}</td>}
              </tr>
            ))}
          </tbody>
        </table>

        {!limite && (
          <div className="note" style={{ marginTop: 8 }}>
            No tienes puesto el <b>limite de perdida diaria</b> en Ajustes → Costes. Si lo pones,
            aparece una columna mas con las veces que el drawdown de cada franja habria llegado a el.
            Eso no es estadistica, es contar: es la unica regla de parada que no hay que demostrar.
          </div>
        )}
      </div>

      {/* --------------------------------------------------- 2. los huecos */}
      {data.gaps.length > 0 && (
        <div className="panel">
          <h2>Lo que esconde &laquo;Fuera&raquo;</h2>
          <div className="note" style={{ marginBottom: 10 }}>
            <b>&laquo;Fuera&raquo; no es un sitio.</b> Son los huecos entre killzones, y se
            portan de forma muy distinta entre si: juntarlos en una fila promedia una hora que
            te cuesta dinero con otra que te lo da, y el promedio no describe ninguna de las
            dos. Esta tabla parte ese cajon por el hueco en el que entraste.
          </div>

          <table>
            <thead>
              <tr>
                <th className="izq">Hora</th>
                <th className="izq">Que es</th>
                <th>Jornadas</th>
                <th>Ops</th>
                <th>Total</th>
                <th>$/op</th>
                <th>Peor dia</th>
                <th>Verdes</th>
              </tr>
            </thead>
            <tbody>
              {data.gaps.map((g) => (
                <tr key={g.from} className={g.days < 5 ? 'apagada' : ''}>
                  <td className="izq">
                    <b>
                      {hhmm(g.from)}–{hhmm(g.to)}
                    </b>
                  </td>
                  <td className="izq">{g.label}</td>
                  <td>{g.days}</td>
                  <td>{g.trades}</td>
                  <td className={signClass(g.total)}>{signedUsd(g.total, 0)}</td>
                  <td className={signClass(g.perTrade)}>{signedUsd(g.perTrade)}</td>
                  <td className="neg">{usd(g.drawdownWorst, 0)}</td>
                  <td>
                    {g.greenDays}/{g.days}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="note" style={{ marginTop: 8 }}>
            Las horas salen de las <b>mismas ventanas que pinta el indicador KillZones</b>: un
            hueco es simplemente el rato que el indicador no colorea. Si alguna vez mueves una
            ventana en el indicador, estos huecos se mueven solos.
          </div>
        </div>
      )}

      {/* ----------------------------------------------- 3. el nivel de parada */}
      <div className="panel">
        <h2>¿Existe un nivel al que convenga parar?</h2>

        <div className={data.survivors > 0 ? 'note' : 'aviso-fuerte'} style={{ marginBottom: 12 }}>
          {data.survivors > 0 ? (
            <>
              <b>
                {data.survivors} de {data.tested} celdas
              </b>{' '}
              sobreviven a la correccion por multiples pruebas. Miralas abajo marcadas, pero
              antes de usarlas: ¿hay dosis-respuesta, o es un umbral suelto rodeado de celdas
              que dicen lo contrario?
            </>
          ) : (
            <>
              <b>No. Con estos datos, parar por drawdown es supersticion.</b> Se han probado{' '}
              {data.tested} combinaciones de franja y umbral y{' '}
              <b>ninguna sobrevive</b> a la correccion por multiples pruebas (Benjamini-Hochberg
              al {Math.round(data.fdr * 100)} %). Con tantas celdas, que una o dos bajen de
              p&nbsp;=&nbsp;0,05 es exactamente lo que da el azar.
            </>
          )}
        </div>

        <div className="note" style={{ marginBottom: 12 }}>
          <b>Lo que se mide, y por que no es lo obvio.</b> Mirar &laquo;cuando estuve 200 abajo,
          la franja acabo mal&raquo; no demuestra nada: acabo mal <i>por estar 200 abajo</i>, que
          es la misma frase dos veces. Lo unico que se puede usar es lo que paso{' '}
          <b>despues</b> de cruzar el umbral, comparado con la media normal de esa misma franja.
          Si seguir estando abajo da lo mismo que seguir sin estarlo, el drawdown no informa de nada.
          <br />
          <b>Y aun asi falta la prueba.</b> Cada celda se contrasta barajando{' '}
          {data.permutations.toLocaleString('es')} veces el <b>orden</b> de las operaciones dentro
          de cada jornada, conservando exactamente las mismas operaciones. Barajar destruye
          cualquier &laquo;estar abajo predice lo siguiente&raquo; y deja intacto todo lo demas.
          Las celdas con menos de {data.minTradesAfter} operaciones detras salen en gris: el
          numero existe, pero una sola operacion mala lo mueve veinte dolares.
        </div>

        <table>
          <thead>
            <tr>
              <th className="izq">Franja</th>
              {data.thresholds.map((t) => (
                <th key={t} title={`Jornadas que llegaron a estar ${usd(t, 0)} por debajo de su mejor momento.`}>
                  −{usd(t, 0)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.session}>
                <td className="izq">
                  <b>{sessionLabel(r.session)}</b>
                  <span className="note" style={{ display: 'block', fontSize: 10 }}>
                    base <span className={signClass(r.perTrade)}>{signedUsd(r.perTrade)}</span>/op
                  </span>
                </td>
                {data.thresholds.map((t) => {
                  const c = data.cells.find((x) => x.session === r.session && x.threshold === t);

                  if (!c) return <td key={t} className="note">—</td>;

                  // Lo que se enseña es la DIFERENCIA contra la base, no el
                  // resultado pelado: un -2 en una franja cuya media ya es -2
                  // no dice nada, y pintarlo de rojo mentiria.
                  //
                  // El color va por SIGNO, como en todo el diario: verde arriba
                  // y rojo abajo. Lo que NO dice el color es si la celda
                  // significa algo — eso lo dicen el p-valor de debajo y el
                  // visto bueno. Es la unica tabla del diario donde las dos
                  // cosas no coinciden, y por eso el pie lo deja escrito.
                  return (
                    <td key={t} className={signClass(c.diff ?? 0)}>
                      <span style={c.enough ? undefined : { opacity: 0.5 }}>
                        {c.diff === null ? '—' : signedUsd(c.diff, 1)}
                      </span>
                      <span
                        className="note"
                        style={{ display: 'block', fontSize: 10, opacity: c.enough ? 1 : 0.5 }}
                        title={
                          `${c.days} jornada${c.days === 1 ? '' : 's'} llegaron a este drawdown` +
                          (c.daysWithRest < c.days
                            ? `, ${c.days - c.daysWithRest} de ellas en su ultima operacion (ahi ya paraste)`
                            : '') +
                          `. Despues: ${c.tradesAfter} operaciones, ${
                            c.perTradeAfter === null ? 'nada' : signedUsd(c.perTradeAfter) + '/op'
                          }, mediana por jornada ${
                            c.medianAfter === null ? '—' : signedUsd(c.medianAfter, 0)
                          }.`
                        }
                      >
                        {c.tradesAfter} ops
                        {c.p !== null && ` · p ${num(c.p, 3)}`}
                        {c.survives && ' ✓'}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="note" style={{ marginTop: 10 }}>
          Cada celda: lo que dio <b>seguir operando</b> despues de cruzar ese nivel de drawdown,{' '}
          <b>menos</b> la media normal de la franja. Debajo, cuantas operaciones hubo despues y
          el p-valor del barajado.
          <br />
          <b>Aqui el color dice el signo, no si la celda significa algo.</b> Verde es que seguir
          fue mejor que la media de la franja y rojo que fue peor, igual que en todo el diario.
          Pero <b>ninguna de estas celdas sobrevive a la correccion</b>: el verde grande de una y
          el rojo grande de otra son, hasta donde se puede medir, el mismo ruido. Lo que separa
          un hallazgo de un numero bonito es el <b>p-valor</b> de debajo y el <b>✓</b>, que hoy
          no lo lleva ninguna. Si alguna vez aparece, ese es el que vale.
          <br />
          Las jornadas que cruzaron el umbral <b>en su ultima operacion</b> cuentan para
          &laquo;cuantas veces pasa&raquo; pero no para &laquo;que dio seguir&raquo;: ahi no
          seguiste. Pasa el raton por el numero gris para ver el reparto.
        </div>
      </div>
    </>
  );
}
