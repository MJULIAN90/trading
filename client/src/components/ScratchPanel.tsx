import { useEffect, useState } from 'react';
import type { ScratchReport } from '../api';
import { dateTime, num, sessionLabel, signClass, ticks } from '../format';

/**
 * Salidas en plano: cuantas hay y que hizo el precio despues.
 *
 * El panel ensena a la vez las dos caras a proposito. Mostrar solo cuanto subio
 * despues convertiria esto en un argumento para dejar correr las perdidas, y
 * aguantar significa aguantar tambien las que se van en contra.
 */
export function ScratchPanel({ data, operations }: { data: ScratchReport; operations: number }) {
  // Paginado: la lista crece con cada sesion y una tabla de doscientas filas no
  // se repasa, se hojea. Veinte entran de un vistazo.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Si cambian los filtros de arriba la lista se encoge; quedarse en la pagina 7
  // de algo que ahora tiene 2 no ensena nada y parece un fallo.
  useEffect(() => { setPage(1); }, [data.cases.length, pageSize]);

  const { config } = data;

  if (data.total === 0) {
    return (
      <div className="panel">
        <h2>Salidas en plano</h2>
        <div className="empty">
          Ninguna operacion cerro dentro de {config.maxTicks} ticks del precio de entrada.
        </div>
      </div>
    );
  }

  const resolved = data.wouldHaveWorked + data.wouldHaveFailed;
  const hitRate = resolved > 0 ? data.wouldHaveWorked / resolved : null;

  const pages = Math.max(1, Math.ceil(data.cases.length / pageSize));
  const current = Math.min(page, pages);
  const visible = data.cases.slice((current - 1) * pageSize, current * pageSize);

  return (
    <div className="panel">
      <h2>Salidas en plano</h2>

      <div className="tiles compact">
        <div className="tile">
          <div className="k">Cerradas en plano</div>
          <div className="v">{data.total}</div>
          <div className="n">
            de {operations} operaciones ({((data.total / Math.max(1, operations)) * 100).toFixed(0)}%)
            · dentro de {config.maxTicks} ticks
          </div>
        </div>

        <div className="tile">
          <div className="k">Habrian funcionado</div>
          <div className="v">
            <span className={data.wouldHaveWorked > data.wouldHaveFailed ? 'pos' : ''}>
              {data.wouldHaveWorked}
            </span>
            <span className="n"> / {data.wouldHaveFailed} no</span>
          </div>
          <div className="n">
            llegaron a +{config.targetTicks} ticks antes que a −{config.targetTicks}
            {hitRate !== null && ` · ${(hitRate * 100).toFixed(0)}%`}
          </div>
        </div>

        <div className="tile">
          <div className="k">Saldo de aguantar</div>
          <div className="v">
            <span className={signClass(data.symmetricTicks ?? 0)}>
              {data.symmetricTicks === null ? '—' : ticks(data.symmetricTicks)}
            </span>
          </div>
          <div className="n">ticks, con objetivo y riesgo iguales</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Apertura</th>
            <th>Lado</th>
            <th>Sesion</th>
            <th>Cerro en <span className="note">(ticks)</span></th>
            <th>Luego a favor <span className="note">(ticks)</span></th>
            <th>Luego en contra <span className="note">(ticks)</span></th>
            <th>Resuelve</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((c) => (
            <tr key={c.id}>
              <td>{dateTime(c.openedAt)}</td>
              <td>
                <span className={`side ${c.direction === 'LONG' ? 'buy' : 'sell'}`}>
                  {c.direction === 'LONG' ? 'BUY' : 'SELL'}
                  <b>{c.quantity}</b>
                </span>
              </td>
              <td>{sessionLabel(c.session)}</td>
              <td className={signClass(c.ticks)}>{ticks(c.ticks)}</td>
              <td className="pos">{num(c.afterFavourable, 0)}</td>
              <td className="neg">{num(c.afterAdverse, 0)}</td>
              <td className={c.resolved === 1 ? 'pos' : c.resolved === -1 ? 'neg' : ''}>
                {c.resolved === 1 ? `+${config.targetTicks} primero`
                  : c.resolved === -1 ? `−${config.targetTicks} primero`
                  : 'ninguno'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.cases.length > pageSize && (
        <div className="pager">
          <label>
            por pagina
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span className="note">
            {data.cases.length} salidas en plano · pag {current}/{pages}
          </span>
          <button disabled={current <= 1} onClick={() => setPage(current - 1)}>‹</button>
          <button disabled={current >= pages} onClick={() => setPage(current + 1)}>›</button>
        </div>
      )}

      <div className="note">
        <p>
          <b>Como leer esto.</b> &quot;Luego a favor&quot; y &quot;luego en contra&quot; son los
          recorridos maximos en los {config.horizonMinutes} minutos siguientes a tu salida, medidos
          desde tu precio de <b>entrada</b>.
        </p>
        <p>
          Esos maximos son <b>un techo, no una ganancia disponible</b>: nadie sale en el punto exacto
          mas alto. La cifra que si significa algo es la columna &quot;Resuelve&quot;, porque pregunta
          que llego antes, el objetivo o el riesgo, y por tanto lleva las perdidas incluidas.
        </p>
        <p>
          Cuando una vela toca los dos niveles a la vez no se sabe cual llego primero, y se cuenta
          como que salto el riesgo. En una medida que puede empujar a aguantar perdidas conviene
          equivocarse hacia el lado prudente.
        </p>
        {data.analyzed < data.total && (
          <p>{data.total - data.analyzed} sin velas capturadas despues de la salida, quedan fuera.</p>
        )}
      </div>
    </div>
  );
}
