import { pct, signClass, signedUsd, usd } from '../format';
import type { Group } from '../api';
import { RowLimit, lastRows, useRowLimit } from './RowLimit';

/**
 * Una fila por jornada, con el reparto completo.
 *
 * El grafico de barras de al lado contesta "cuanto gane ese dia". Esto
 * contesta las dos preguntas que el grafico no puede: de cuantas operaciones
 * salio ese numero, y de que lado venian.
 *
 * Por que importa el reparto compra/venta: un dia de -400 con nueve ventas y
 * una compra no es un mal dia, es un sesgo. Y eso no se ve en una barra roja.
 *
 * TODAS las cifras de dinero llevan el simbolo y la columna dice la unidad.
 * El diario trabaja en dolares por contrato porque es lo que devuelve el
 * broker; un "-64" suelto no dice si son dolares, ticks o puntos, y en MNQ
 * confundirlos es un factor de dos.
 */
export function DayTable({ rows, label }: { rows: Group[]; label: (k: string | number) => string }) {
  // El hook va ANTES del return temprano: React exige que se llamen siempre
  // los mismos hooks en el mismo orden, y saltarselo cuando no hay datos
  // rompe el componente en cuanto llegue la primera operacion.
  const [limit, setLimit] = useRowLimit('jornadas', 30);

  if (!rows.length) return <div className="empty">sin datos</div>;

  // Las ultimas N jornadas. Los totales se calculan sobre LO QUE SE VE, no
  // sobre el historico entero: una tabla que enseña 30 dias y suma 200 es una
  // trampa para el que la lee.
  const visibles = lastRows(rows, limit);

  const t = visibles.reduce(
    (a, r) => ({
      operations: a.operations + r.summary.operations,
      wins: a.wins + r.summary.wins,
      losses: a.losses + r.summary.losses,
      longs: a.longs + r.summary.longs,
      shorts: a.shorts + r.summary.shorts,
      grossPnl: a.grossPnl + r.summary.grossPnl,
    }),
    { operations: 0, wins: 0, losses: 0, longs: 0, shorts: 0, grossPnl: 0 },
  );

  const winRate = t.operations > 0 ? t.wins / t.operations : 0;

  return (
    <>
      <RowLimit
        value={limit}
        onChange={setLimit}
        total={rows.length}
        shown={visibles.length}
        noun="jornadas"
      />

      <table>
      <thead>
        <tr>
          <th>Dia</th>
          <th title="Operaciones cerradas ese dia">Ops</th>
          <th title="Operaciones que acabaron en ganancia">Ganadoras</th>
          <th title="Operaciones que acabaron en perdida o a cero">Perdedoras</th>
          <th title="Porcentaje de ganadoras sobre el total del dia">Acierto</th>
          <th title="Operaciones en COMPRA (largo). Entre parentesis, cuantas ganaron">
            Compras
          </th>
          <th title="Operaciones en VENTA (corto). Entre parentesis, cuantas ganaron">
            Ventas
          </th>
          <th title="Resultado bruto del dia, sin comisiones, en dolares por contrato">
            Resultado <span className="note">(USD)</span>
          </th>
          <th title="Resultado dividido entre el numero de operaciones del dia">
            Por operacion <span className="note">(USD)</span>
          </th>
        </tr>
      </thead>

      <tbody>
        {visibles.map((r) => {
          const s = r.summary;
          const porOp = s.operations > 0 ? s.grossPnl / s.operations : 0;

          return (
            <tr key={String(r.key)}>
              <td>{label(r.key)}</td>
              <td>{s.operations}</td>
              <td className={s.wins > 0 ? 'pos' : ''}>{s.wins}</td>
              <td className={s.losses > 0 ? 'neg' : ''}>{s.losses}</td>
              <td>{pct(s.winRate)}</td>

              {/* El reparto por lado lleva sus aciertos al lado: saber que
                  hubo 6 compras no dice nada si no se sabe como salieron. */}
              <td>
                {s.longs}
                {s.longs > 0 && <span className="note"> ({s.longWins} ok)</span>}
              </td>
              <td>
                {s.shorts}
                {s.shorts > 0 && <span className="note"> ({s.shortWins} ok)</span>}
              </td>

              <td className={signClass(s.grossPnl)}>{signedUsd(s.grossPnl, 2)}</td>
              <td className={signClass(porOp)}>{signedUsd(porOp, 2)}</td>
            </tr>
          );
        })}
      </tbody>

      <tfoot>
        <tr>
          <td><b>Total</b></td>
          <td><b>{t.operations}</b></td>
          <td className={t.wins > 0 ? 'pos' : ''}><b>{t.wins}</b></td>
          <td className={t.losses > 0 ? 'neg' : ''}><b>{t.losses}</b></td>
          <td><b>{pct(winRate)}</b></td>
          <td><b>{t.longs}</b></td>
          <td><b>{t.shorts}</b></td>
          <td className={signClass(t.grossPnl)}><b>{signedUsd(t.grossPnl, 2)}</b></td>
          <td className={signClass(t.grossPnl)}>
            <b>{t.operations > 0 ? signedUsd(t.grossPnl / t.operations, 2) : usd(0, 2)}</b>
          </td>
        </tr>
      </tfoot>
      </table>
    </>
  );
}
