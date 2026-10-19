import { useEffect, useState } from 'react';

/**
 * El cruce completo: patron x temporalidad x tendencia de 4h x sentido.
 *
 * La tabla es lo de menos. Lo que importa es el recuadro de arriba, porque
 * responde a la unica pregunta que hace falta antes de mirar una sola fila:
 * ¿cuantas de estas combinaciones saldrian bien aunque no hubiera nada que
 * encontrar? Si se prueban setenta y cinco cosas, casi cuatro van a dar
 * p < 0,05 por pura casualidad. Enseñar la tabla sin ese numero delante seria
 * invitar a pescar.
 */

interface Row {
  timeframe: number;
  pattern: string;
  patternLabel: string;
  trend: 'ALCISTA' | 'BAJISTA' | 'RANGO';
  side: 'LONG' | 'SHORT';
  aligned: boolean | null;
  patternAgrees: boolean | null;
  samples: number;
  hitRate: number;
  baseline: number;
  edge: number;
  pValue: number;
  qValue: number;
  firstHalf: number | null;
  secondHalf: number | null;
  consistent: boolean;
}

interface Report {
  symbol: string;
  targetTicks: number;
  horizonMin: number;
  tested: number;
  expectedByChance: number;
  rawHits: number;
  survivors: number;
  consistentSurvivors: number;
  rows: Row[];
}

const TF = (n: number) => (n >= 60 ? `${n / 60}h` : `${n}m`);
const pc = (v: number) => `${(v * 100).toFixed(1)}%`;

export function GridPanel() {
  const [data, setData] = useState<Report | null>(null);
  const [target, setTarget] = useState(40);
  const [tf, setTf] = useState('');
  const [trend, setTrend] = useState('');
  const [side, setSide] = useState('');
  const [onlyAligned, setOnlyAligned] = useState(false);
  const [onlyConsistent, setOnlyConsistent] = useState(false);

  useEffect(() => {
    setData(null);
    fetch(`/api/study/grid?targetTicks=${target}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [target]);

  const rows = (data?.rows ?? []).filter((r) => {
    if (tf && String(r.timeframe) !== tf) return false;
    if (trend && r.trend !== trend) return false;
    if (side && r.side !== side) return false;
    if (onlyAligned && r.aligned !== true) return false;
    if (onlyConsistent && !r.consistent) return false;
    return true;
  });

  return (
    <div className="panel">
      <h2>Todas las combinaciones</h2>

      {!data ? (
        <div className="empty">calculando...</div>
      ) : (
        <>
          <div className="grid-summary">
            <div>
              <div className="k">Preguntas probadas</div>
              <div className="v">{data.tested}</div>
            </div>
            <div>
              <div className="k">Saldrian por azar</div>
              <div className="v warn-text">{data.expectedByChance}</div>
            </div>
            <div>
              <div className="k">Dan p &lt; 0,05</div>
              <div className="v">{data.rawHits}</div>
            </div>
            <div>
              <div className="k">Sobreviven a la correccion</div>
              <div className={`v ${data.survivors > 0 ? 'pos' : 'neg'}`}>{data.survivors}</div>
            </div>
          </div>

          <div className={data.survivors === 0 ? 'news-alert' : 'note'} style={{ marginBottom: 12 }}>
            {data.survivors === 0 ? (
              <>
                <b>Nada aguanta</b>
                <span>
                  Se probaron {data.tested} combinaciones. El azar puro produciria{' '}
                  {data.expectedByChance} con p &lt; 0,05, y salieron {data.rawHits}. Es la misma
                  cifra: lo que ves abajo es ruido con forma de hallazgo. Ninguna sobrevive a la
                  correccion por el numero de pruebas.
                </span>
              </>
            ) : (
              <>
                <b>{data.survivors} combinacion(es) sobreviven a la correccion</b>, y{' '}
                {data.consistentSurvivors} ademas se repiten en las dos mitades del historico. Eso
                ya merece mirarse: abre esas operaciones en el grafico antes de creertelo.
              </>
            )}
          </div>

          <div className="filters" style={{ marginBottom: 10 }}>
            <label>
              Objetivo y stop
              <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                {[20, 40, 60, 80, 100].map((n) => <option key={n} value={n}>{n} ticks</option>)}
              </select>
            </label>
            <label>
              Vela
              <select value={tf} onChange={(e) => setTf(e.target.value)}>
                <option value="">todas</option>
                {[1, 5, 15, 60].map((n) => <option key={n} value={n}>{TF(n)}</option>)}
              </select>
            </label>
            <label>
              Tendencia 4h
              <select value={trend} onChange={(e) => setTrend(e.target.value)}>
                <option value="">todas</option>
                <option value="ALCISTA">alcista</option>
                <option value="BAJISTA">bajista</option>
                <option value="RANGO">rango</option>
              </select>
            </label>
            <label>
              Entrada
              <select value={side} onChange={(e) => setSide(e.target.value)}>
                <option value="">ambas</option>
                <option value="LONG">compra</option>
                <option value="SHORT">venta</option>
              </select>
            </label>
            <label>
              <input type="checkbox" checked={onlyAligned} onChange={(e) => setOnlyAligned(e.target.checked)} />
              solo a favor de la 4h
            </label>
            <label>
              <input type="checkbox" checked={onlyConsistent} onChange={(e) => setOnlyConsistent(e.target.checked)} />
              solo las que se repiten
            </label>
          </div>

          <table>
            <thead>
              <tr>
                <th>Vela</th>
                <th>Patron</th>
                <th>4h</th>
                <th>Entrada</th>
                <th>Casos</th>
                <th>Acierto</th>
                <th title="El mismo cajon sin mirar el patron">Base</th>
                <th>Ventaja</th>
                <th title="Sin corregir">p</th>
                <th title="Corregido por el numero de pruebas">q</th>
                <th title="Acierto en la primera y la segunda mitad del historico">Mitades</th>
                <th title="Las dos mitades van en el mismo sentido">Repite</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 60).map((r, i) => (
                <tr key={i} className={r.qValue < 0.05 ? 'hi' : ''}>
                  <td>{TF(r.timeframe)}</td>
                  <td>{r.patternLabel}</td>
                  <td>{r.trend === 'RANGO' ? 'rango' : r.trend.toLowerCase()}</td>
                  <td>
                    {r.side === 'LONG' ? 'compra' : 'venta'}
                    {r.aligned !== null && (
                      <span className="note"> · {r.aligned ? 'a favor' : 'en contra'}</span>
                    )}
                  </td>
                  <td>{r.samples.toLocaleString('es')}</td>
                  <td>{pc(r.hitRate)}</td>
                  <td className="note">{pc(r.baseline)}</td>
                  <td className={r.edge > 0 ? 'pos' : r.edge < 0 ? 'neg' : ''}>
                    {r.edge > 0 ? '+' : ''}{r.edge.toFixed(1)}
                  </td>
                  <td>{r.pValue.toFixed(3)}</td>
                  <td className={r.qValue < 0.05 ? 'pos' : 'note'}>{r.qValue.toFixed(2)}</td>
                  <td className="note">
                    {r.firstHalf === null || r.secondHalf === null
                      ? '—'
                      : `${pc(r.firstHalf)} / ${pc(r.secondHalf)}`}
                  </td>
                  <td className={r.consistent ? 'pos' : 'note'}>{r.consistent ? 'si' : 'no'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={12} className="note">Ninguna combinacion con esos filtros.</td></tr>
              )}
            </tbody>
          </table>

          {rows.length > 60 && (
            <div className="note">Se ensenan las 60 primeras por q-valor, de {rows.length}.</div>
          )}

          <div className="note">
            <p>
              Cada fila simula entrar al cierre de esa vela con objetivo y stop de{' '}
              <b>{data.targetTicks} ticks</b>, y apunta cual se tocó antes dentro de{' '}
              {data.horizonMin} minutos. Solo entran combinaciones con al menos 120 casos.
            </p>
            <p>
              <b>Base</b> es el acierto de ese mismo cajon —misma vela, misma tendencia, mismo
              sentido— sin mirar el patron. Comparar contra ella y no contra el 50% es lo que separa
              lo que aporta el dibujo de lo que ya aportaba la tendencia.
            </p>
            <p>
              <b>q</b> es el p corregido por las {data.tested} pruebas. Mirar solo el p con esta
              cantidad de combinaciones garantiza encontrar &quot;algo&quot;. Y <b>Repite</b> es el
              filtro mas duro: parte el historico por la mitad y exige que las dos vayan en el mismo
              sentido. Una casualidad rara vez lo hace.
            </p>
            <p>
              Compra y venta de la misma fila son la misma pregunta vista del derecho y del reves:
              si comprar acierta el 60%, vender acierta el 40%. Por eso la correccion se calcula
              sobre {data.tested} preguntas y no sobre el doble de filas.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
