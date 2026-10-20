import { useEffect, useState } from 'react';
import { num, pct, sessionLabel } from '../format';

/**
 * Como se comporta cada killzone en su APERTURA.
 *
 * Se lee igual que la tabla de patrones: una fila por franja, con su linea
 * base al lado y la columna que dice si aguanta.
 *
 * La diferencia esta en COMO se construye esa linea base, y es lo unico que
 * hace util la tabla. Comparando las aperturas contra momentos al azar, el
 * latigazo de NY AM salia 23,8% contra 0,9%: un efecto enorme. Pero NY AM abre
 * con tres veces el rango normal, y con esa amplitud romper los dos extremos
 * de la hora previa es mas facil por aritmetica, sin que nadie manipule nada.
 *
 * Por eso cada apertura se compara contra momentos de fuera que tuvieron la
 * MISMA expansion de rango. Con ese control, el control sube al 16,6% y la
 * diferencia deja de ser significativa. Dos tercios del hallazgo eran
 * volatilidad.
 */

interface Row {
  session: string;
  samples: number;
  expansion: number;
  expansionLow: number;
  expansionHigh: number;
  sweepHigh: number;
  sweepHighReversed: number;
  sweepLow: number;
  sweepLowReversed: number;
  whipsaw: number;
  whipsawRate: number;
  controlRate: number;
  controlSamples: number;
  edge: number;
  p: number;
  survives: boolean;
}

interface Report {
  symbol: string;
  prevMin: number;
  openMin: number;
  afterMin: number;
  rows: Row[];
}

const share = (hits: number, total: number) => (total > 0 ? `${hits}/${total}` : '—');

export function OpeningsPanel() {
  const [data, setData] = useState<Report | null>(null);

  useEffect(() => {
    fetch('/api/study/openings')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return <div className="empty">calculando...</div>;
  if (!data.rows.length) return <div className="empty">todavia no hay aperturas suficientes</div>;

  return (
    <>
      <div className="note" style={{ marginBottom: 10 }}>
        Primeros <b>{data.openMin} minutos</b> de cada killzone, comparados con los{' '}
        <b>{data.prevMin}</b> anteriores. La vuelta se mira {data.afterMin} minutos despues.
        Una apertura por franja y dia: la muestra crece <b>cinco al dia</b>.
      </div>

      <table>
        <thead>
          <tr>
            <th>Killzone</th>
            <th title="Aperturas analizadas. Una por dia.">Aperturas</th>
            <th title="Rango de la apertura dividido entre el rango tipico de 15 min de la hora previa. 3x significa que el mismo stop vale la tercera parte.">
              Expansion <span className="note">(x)</span>
            </th>
            <th title="Barrio el maximo de la hora previa, y de esos cuantos volvieron a cerrar por debajo">
              Barre alto <span className="note">(se gira)</span>
            </th>
            <th title="Barrio el minimo de la hora previa, y de esos cuantos volvieron a cerrar por encima">
              Barre bajo <span className="note">(se gira)</span>
            </th>
            <th title="Barrio los DOS lados en la misma ventana. Es la firma de lo que se llama manipulacion.">
              Latigazo
            </th>
            <th title="El mismo porcentaje en momentos de fuera de aperturas que tuvieron la MISMA expansion de rango. Esta es la comparacion honesta.">
              Base igual volatilidad
            </th>
            <th title="Diferencia entre el latigazo de la apertura y el de su control">Ventaja</th>
            <th title="Probabilidad de ver esa diferencia por azar">p</th>
            <th title="Si sobrevive a la correccion por haber mirado cinco franjas a la vez">
              ¿Aguanta?
            </th>
          </tr>
        </thead>

        <tbody>
          {data.rows.map((r) => (
            <tr key={r.session}>
              <td>{sessionLabel(r.session)}</td>
              <td>{r.samples}</td>

              <td title={`intervalo de confianza del 95%: ${num(r.expansionLow, 2)}x a ${num(r.expansionHigh, 2)}x`}>
                <b>{num(r.expansion, 2)}x</b>
                <span className="note"> [{num(r.expansionLow, 2)}–{num(r.expansionHigh, 2)}]</span>
              </td>

              <td>
                {share(r.sweepHighReversed, r.sweepHigh)}
                {r.sweepHigh > 0 && (
                  <span className="note"> {pct(r.sweepHighReversed / r.sweepHigh)}</span>
                )}
              </td>
              <td>
                {share(r.sweepLowReversed, r.sweepLow)}
                {r.sweepLow > 0 && (
                  <span className="note"> {pct(r.sweepLowReversed / r.sweepLow)}</span>
                )}
              </td>

              <td>
                {pct(r.whipsawRate)}
                <span className="note"> ({r.whipsaw})</span>
              </td>
              <td className="note">
                {pct(r.controlRate)} ({r.controlSamples})
              </td>

              <td className={r.edge > 0 ? 'pos' : r.edge < 0 ? 'neg' : ''}>
                {r.edge >= 0 ? '+' : ''}
                {num(r.edge * 100, 1)} pp
              </td>
              <td>{num(r.p, 3)}</td>
              <td className={r.survives ? 'pos' : 'note'}>{r.survives ? 'SI' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="note" style={{ marginTop: 10, lineHeight: 1.5 }}>
        <b>Expansion</b> es lo unico que ya esta demostrado, y es lo accionable: el mismo stop
        vale distinto segun la franja. En la apertura de NY AM el precio recorre el triple que
        media hora despues; en NY Lunch el rango se <i>encoge</i>, y ahi un stop ancho es tirar
        dinero.
        <br />
        <b>Base igual volatilidad</b> es la columna que impide engañarse. Comparar contra
        momentos al azar daria a NY AM un latigazo de 23,8% contra 0,9% y parecia una mina;
        comparando contra momentos con la misma amplitud, el control sube a ~16% y la diferencia
        se desinfla. Dos tercios de aquello era volatilidad, no manipulacion.
        <br />
        <b>¿Aguanta?</b> corrige por haber mirado cinco franjas a la vez. Sin esa correccion, una
        de cada cinco saldria «significativa» solo por haber mirado cinco veces.
      </div>
    </>
  );
}
