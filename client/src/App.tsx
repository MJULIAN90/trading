import { useCallback, useEffect, useState } from 'react';
import { api, type Dashboard, type Filters } from './api';
import { Breakdown } from './components/Breakdown';
import { BarsChart, EquityChart } from './components/Charts';
import { Operations } from './components/Operations';
import { date, num, pct, sessionLabel, setMarketOffset, signClass, dateTime } from './format';

function Tiles({ s }: { s: Dashboard['summary'] }) {
  const profitable = s.payoff >= s.breakevenPayoff;
  const tiles: Array<[string, React.ReactNode, string]> = [
    ['P&L bruto', <span className={signClass(s.grossPnl)}>{num(s.grossPnl)}</span>, `${s.operations} operaciones`],
    ['Acierto', pct(s.winRate), `${s.wins} ganadas / ${s.losses} perdidas`],
    ['Ganancia media', <span className="pos">{num(s.avgWin)}</span>, `${num(s.avgWinMinutes, 1)} min de media`],
    ['Perdida media', <span className="neg">{num(s.avgLoss)}</span>, `${num(s.avgLossMinutes, 1)} min de media`],
    ['Payoff', <span className={profitable ? 'pos' : 'neg'}>{num(s.payoff)}</span>, `necesita ${num(s.breakevenPayoff)} para no perder`],
    ['Esperanza', <span className={signClass(s.expectancy)}>{num(s.expectancy)}</span>, 'por operacion'],
    ['Racha perdedora', String(s.maxLossStreak), `mejor racha: ${s.maxWinStreak}`],
    ['Peor operacion', <span className="neg">{num(s.worst)}</span>, `mejor: ${num(s.best)}`],
  ];

  return (
    <div className="tiles">
      {tiles.map(([k, v, n]) => (
        <div className="tile" key={k}>
          <div className="k">{k}</div>
          <div className="v">{v}</div>
          <div className="n">{n}</div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [filters, setFilters] = useState<Filters>({});
  const [data, setData] = useState<Dashboard | null>(null);
  const [live, setLive] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .dashboard(filters)
      .then((d) => { setMarketOffset(d.marketOffsetHours); setData(d); setError(null); })
      .catch((e: Error) => setError(e.message));

    api
      .status()
      .then((s) => {
        if (!s.autoIngest) { setLive('ingesta automatica apagada'); return; }
        setLive(s.lastIngest ? `ultima novedad ${dateTime(s.lastIngest.at)}` : 'sin novedades aun');
      })
      .catch(() => { /* el servidor puede estar reiniciando */ });
  }, [filters]);

  useEffect(() => {
    load();
    // El servidor mantiene la base al dia solo; basta con volver a pedir.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <>
      <h1>Diario de trading</h1>
      <div className="sub">
        {data
          ? `${data.count} operaciones${data.count ? ` · hasta ${data.equity.length ? date(data.equity[data.equity.length - 1]!.ts) : ''}` : ''} (hora de mercado)`
          : 'cargando...'}
      </div>

      <div className="filters">
        <label>Desde <input type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} /></label>
        <label>Hasta <input type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} /></label>
        <label>
          Sesion
          <select value={filters.session ?? ''} onChange={(e) => set({ session: e.target.value || undefined })}>
            <option value="">todas</option>
            {['ASIA', 'LONDON', 'NY_AM', 'NY_LUNCH', 'NY_PM', 'OUTSIDE'].map((s) => (
              <option key={s} value={s}>{sessionLabel(s)}</option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={!!filters.includeTests} onChange={(e) => set({ includeTests: e.target.checked })} />
          incluir pruebas
        </label>
        <button onClick={load}>Actualizar</button>
        <span className="live"><b>en vivo</b> · {live}</span>
      </div>

      {error && <div className="error">No se pudo cargar: {error}</div>}

      {data && (
        <>
          <Tiles s={data.summary} />

          <div className="panel">
            <h2>Curva de capital (P&amp;L bruto acumulado)</h2>
            <EquityChart points={data.equity} />
          </div>

          <div className="grid2">
            <div className="panel">
              <h2>P&amp;L por sesion</h2>
              <BarsChart rows={data.bySession} label={(k) => sessionLabel(String(k))} />
            </div>
            <div className="panel">
              <h2>P&amp;L por hora de mercado</h2>
              <BarsChart rows={data.byHour} label={(k) => `${String(k).padStart(2, '0')}:00`} />
            </div>
          </div>

          <div className="panel">
            <h2>Metricas por grupo</h2>
            <Breakdown data={data} />
          </div>

          <div className="panel">
            <h2>Que cuesta dinero</h2>
            <table>
              <thead>
                <tr><th>Observacion</th><th>Veces</th><th>P&amp;L acumulado</th></tr>
              </thead>
              <tbody>
                {data.flagImpact.map((f) => (
                  <tr key={f.code}>
                    <td>{f.title}</td>
                    <td>{f.count}</td>
                    <td className={signClass(f.pnl)}>{num(f.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="note">
              Suma del resultado de todas las operaciones que llevan cada observacion. Una misma
              operacion puede aparecer en varias filas, asi que los totales no se suman entre si.
            </div>
          </div>

          <div className="panel">
            <h2>Operaciones</h2>
            <Operations filters={filters} />
          </div>
        </>
      )}
    </>
  );
}
