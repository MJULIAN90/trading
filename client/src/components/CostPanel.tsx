import type { CostSettings, CostSummary, ExcursionSummary } from '../api';
import { num, signClass, signedUsd, ticks, usd } from '../format';

/**
 * Lo que cuesta operar y lo que recorre el precio mientras estas dentro.
 *
 * Son las dos cosas que no salen en un resumen normal y que mas cambian las
 * conclusiones: una estrategia puede ganar en bruto y perder en neto, y una
 * ganadora puede haber sido una mala entrada que sobrevivio.
 */
export function CostPanel({
  costs,
  excursion,
  settings,
}: {
  costs: CostSummary;
  excursion: ExcursionSummary;
  settings: CostSettings;
}) {
  const share = costs.commissionShare;

  return (
    <>
      <div className="panel">
        <h2>Coste de operar</h2>

        <table>
          <tbody>
            <tr>
              <td>Resultado bruto</td>
              <td className={signClass(costs.grossPnl)}>{signedUsd(costs.grossPnl)}</td>
              <td className="note">{costs.operations} operaciones · {num(costs.contracts, 0)} contratos en total</td>
            </tr>
            <tr>
              <td>Comisiones simuladas</td>
              <td className="neg">−{usd(costs.commission)}</td>
              <td className="note">
                {usd(settings.commissionPerContract)} USD por contrato, ida y vuelta
              </td>
            </tr>
            <tr>
              <td><b>Resultado neto</b></td>
              <td className={signClass(costs.netPnl)}><b>{signedUsd(costs.netPnl)}</b></td>
              <td className="note">
                {share !== null && `las comisiones se llevan el ${(share * 100).toFixed(0)}% del bruto`}
              </td>
            </tr>
            <tr>
              <td>Ticks ganados / perdidos</td>
              <td className={signClass(costs.ticksWon + costs.ticksLost)}>
                {ticks(costs.ticksWon + costs.ticksLost)}
              </td>
              <td className="note">
                +{ticks(costs.ticksWon)} contra {ticks(costs.ticksLost)} · media de{' '}
                {costs.avgTicksPerTrade === null ? '—' : ticks(costs.avgTicksPerTrade)} por contrato y operacion
              </td>
            </tr>
            <tr>
              <td>Umbral de rentabilidad</td>
              <td>{ticks(costs.breakevenTicks)}</td>
              <td className="note">ticks por contrato que hay que sacar solo para cubrir la comision</td>
            </tr>
          </tbody>
        </table>

        <div className="note">
          Los totales de ticks estan en ticks-contrato: ticks multiplicados por el numero de
          contratos. Sumar ticks por contrato de operaciones de distinto tamano daria un numero
          que no cuadra con los dolares.
        </div>
      </div>

      <div className="panel">
        <h2>Recorrido mientras estabas dentro</h2>

        <table>
          <thead>
            <tr>
              <th></th>
              <th>Operaciones</th>
              <th>En contra (MAE)</th>
              <th>A favor (MFE)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Ganadoras</td>
              <td>{excursion.wins.count}</td>
              <td>{excursion.wins.avgMae === null ? '—' : `${ticks(excursion.wins.avgMae)} ticks`}</td>
              <td className="pos">{excursion.wins.avgMfe === null ? '—' : `${ticks(excursion.wins.avgMfe)} ticks`}</td>
            </tr>
            <tr>
              <td>Perdedoras</td>
              <td>{excursion.losses.count}</td>
              <td className="neg">{excursion.losses.avgMae === null ? '—' : `${ticks(excursion.losses.avgMae)} ticks`}</td>
              <td>{excursion.losses.avgMfe === null ? '—' : `${ticks(excursion.losses.avgMfe)} ticks`}</td>
            </tr>
          </tbody>
        </table>

        <div className="note">
          <p>
            <b>MAE</b> es lo maximo que fue en contra desde tu entrada; <b>MFE</b>, lo maximo a favor.
            Es lo que separa una buena entrada de un buen resultado.
          </p>
          <p>
            Si el MAE de tus ganadoras es mucho menor que el de las perdedoras, hay un nivel de dolor
            a partir del cual la operacion casi nunca vuelve: ese es tu stop, y sale de tus datos y no
            de una regla prestada. Si el MFE de las perdedoras es alto, llegaste a estar en beneficio
            y lo devolviste, que es un problema de salida y no de entrada.
          </p>
          {excursion.skipped > 0 && (
            <p>
              {excursion.skipped} operaciones sin velas capturadas en ese tramo, quedan fuera de este
              calculo.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
