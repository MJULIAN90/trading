import { useCallback, useEffect, useState } from 'react';
import { api, type Dashboard, type Filters } from './api';
import { Breakdown } from './components/Breakdown';
import { BarsChart, EquityChart } from './components/Charts';
import { CalendarPanel } from './components/CalendarPanel';
import { CostPanel } from './components/CostPanel';
import { Operations } from './components/Operations';
import { ScratchPanel } from './components/ScratchPanel';
import { date, num, pct, sessionLabel, setMarketOffset, signClass, dateTime, ticks } from './format';

function Tiles({ s, costs }: { s: Dashboard['summary']; costs: Dashboard['costs'] }) {
  const profitable = s.payoff >= s.breakevenPayoff;
  const netTicks = costs.ticksWon + costs.ticksLost;

  const tiles: Array<[string, React.ReactNode, string]> = [
    ['P&L neto', <span className={signClass(costs.netPnl)}>{num(costs.netPnl)}</span>, `${num(costs.grossPnl)} bruto − ${num(costs.commission)} comisiones`],
    ['Ticks', <span className={signClass(netTicks)}>{ticks(netTicks)}</span>, `+${ticks(costs.ticksWon)} / ${ticks(costs.ticksLost)}`],
    ['Acierto', pct(s.winRate), `${s.wins} ganadas / ${s.losses} perdidas`],
    ['Ganancia media', <span className="pos">{num(s.avgWin)}</span>, `${num(s.avgWinMinutes, 1)} min de media`],
    ['Perdida media', <span className="neg">{num(s.avgLoss)}</span>, `${num(s.avgLossMinutes, 1)} min de media`],
    ['Payoff', <span className={profitable ? 'pos' : 'neg'}>{num(s.payoff)}</span>, `necesita ${num(s.breakevenPayoff)} para no perder`],
    ['Esperanza', <span className={signClass(s.expectancy)}>{num(s.expectancy)}</span>, 'por operacion'],
    ['Racha perdedora', String(s.maxLossStreak), `mejor racha: ${s.maxWinStreak}`],
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

/**
 * Ajuste de la comision, en la cabecera y no escondido en un fichero de
 * configuracion: ese numero cambia las metricas de toda la aplicacion, asi que
 * tiene que estar a la vista mientras las miras.
 */
function CommissionSetting({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => { setDraft(String(value)); }, [value]);

  return (
    <label title="Comision mas tasas por contrato, ida y vuelta completa">
      Comision
      <input
        type="number"
        step="0.05"
        min="0"
        value={draft}
        style={{ width: 70 }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (Number.isFinite(n) && n >= 0 && n !== value) onChange(n);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      $/contrato
    </label>
  );
}

type Tab = 'resumen' | 'operaciones' | 'costes' | 'noticias';

export default function App() {
  const [filters, setFilters] = useState<Filters>({});
  const [tab, setTab] = useState<Tab>('resumen');
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

  function saveCommission(v: number) {
    api.saveSettings(v).then(load);
  }

  return (
    <>
      <h1>Diario de trading</h1>
      <div className="sub">
        {data
          ? `${data.count} operaciones${data.count && data.equity.length ? ` · hasta ${date(data.equity[data.equity.length - 1]!.ts)}` : ''} · ` +
            `cifras en ${data.basis === 'net' ? 'NETO, con comisiones' : 'BRUTO'} · hora de mercado`
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
          Base
          <select value={filters.basis ?? 'net'} onChange={(e) => set({ basis: e.target.value as 'net' | 'gross' })}>
            <option value="net">neto</option>
            <option value="gross">bruto</option>
          </select>
        </label>
        {data && <CommissionSetting value={data.costSettings.commissionPerContract} onChange={saveCommission} />}
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
          <div className="tabs main">
            {(['resumen', 'operaciones', 'costes', 'noticias'] as const).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'resumen' ? 'Resumen'
                  : t === 'operaciones' ? `Operaciones (${data.count})`
                  : t === 'costes' ? 'Costes y recorrido'
                  : `Noticias${data.calendar.activeNow.length ? ' ●' : ''}`}
              </button>
            ))}
          </div>

          {/* El aviso de noticia se ensena en TODAS las pestanas, no solo en la
              suya: si hay que no operar, tiene que verse estes donde estes. */}
          {data.calendar.activeNow.length > 0 && tab !== 'noticias' && (
            <div className="news-alert">
              <b>No operar</b>
              {data.calendar.activeNow.map((b) => (
                <span key={b.event.id}>
                  {b.event.title} · {b.minutesTo > 0 ? `en ${b.minutesTo} min` : b.minutesTo === 0 ? 'ahora' : `hace ${Math.abs(b.minutesTo)} min`}
                </span>
              ))}
            </div>
          )}

          {tab === 'noticias' && <CalendarPanel data={data.calendar} news={data.news} />}

          {tab === 'resumen' && (
            <>
              <Tiles s={data.summary} costs={data.costs} />

              <div className="panel">
                <h2>Curva de capital ({data.basis === 'net' ? 'neta' : 'bruta'})</h2>
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
            </>
          )}

          {tab === 'operaciones' && <Operations filters={filters} offsetHours={data.marketOffsetHours} />}

          {tab === 'costes' && (
            <>
              <CostPanel costs={data.costs} excursion={data.excursion} settings={data.costSettings} />
              <ScratchPanel data={data.scratch} operations={data.count} />
            </>
          )}
        </>
      )}
    </>
  );
}
