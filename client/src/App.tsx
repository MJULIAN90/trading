import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Dashboard, type Filters } from './api';
import { Breakdown } from './components/Breakdown';
import { BarsChart, EquityChart, RecentBarsChart } from './components/Charts';
import { DayTable } from './components/DayTable';
import { OpeningsPanel } from './components/OpeningsPanel';

/**
 * Indices de Date.getUTCDay(): 0 es domingo. El servidor manda ese numero y no
 * el nombre para que el orden sea el de la semana y no el alfabetico, que
 * pondria el jueves antes que el lunes.
 */
const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
import { CalendarPanel } from './components/CalendarPanel';
import { CostPanel } from './components/CostPanel';
import { MarketPanel } from './components/MarketPanel';
import { Operations } from './components/Operations';
import { PatternPanel } from './components/PatternPanel';
import { ScratchPanel } from './components/ScratchPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { date, dateTime, num, pct, sessionLabel, setMarketOffset, signClass, signedUsd, ticks, usd } from './format';

function Tiles({ s, costs }: { s: Dashboard['summary']; costs: Dashboard['costs'] }) {
  const profitable = s.payoff >= s.breakevenPayoff;
  const netTicks = costs.ticksWon + costs.ticksLost;

  const tiles: Array<[string, React.ReactNode, string]> = [
    ['P&L neto (USD)', <span className={signClass(costs.netPnl)}>{signedUsd(costs.netPnl)}</span>, `${signedUsd(costs.grossPnl)} bruto − ${usd(costs.commission)} comisiones`],
    ['Ticks', <span className={signClass(netTicks)}>{ticks(netTicks)}</span>, `+${ticks(costs.ticksWon)} / ${ticks(costs.ticksLost)}`],
    ['Acierto', pct(s.winRate), `${s.wins} ganadas / ${s.losses} perdidas`],
    ['Ganancia media (USD)', <span className="pos">{usd(s.avgWin)}</span>, `${num(s.avgWinMinutes, 1)} min de media`],
    ['Perdida media (USD)', <span className="neg">{usd(s.avgLoss)}</span>, `${num(s.avgLossMinutes, 1)} min de media`],
    ['Payoff', <span className={profitable ? 'pos' : 'neg'}>{num(s.payoff)}</span>, `veces lo que pierdes · necesita ${num(s.breakevenPayoff)} para no perder`],
    ['Esperanza (USD)', <span className={signClass(s.expectancy)}>{signedUsd(s.expectancy)}</span>, 'por operacion'],
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

type Tab = 'resumen' | 'operaciones' | 'mercado' | 'costes' | 'noticias' | 'ajustes';

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

  /**
   * Refresco automatico, pero NO en las pestanas donde estorba.
   *
   * En Resumen y Noticias interesa que se actualice solo: son numeros que
   * cambian al cerrar una operacion, y el aviso de "no operar" tiene que
   * aparecer sin que nadie pulse nada.
   *
   * En Operaciones y Ajustes hace dano. Las dos tienen estado propio que el
   * usuario acaba de poner con la mano —la temporalidad del grafico, un color a
   * medio elegir— y recargar debajo lo pisa. Perder lo que estabas mirando cada
   * treinta segundos convierte la pantalla en inutilizable.
   */
  const autoRefresh = tab === 'resumen' || tab === 'noticias';

  useEffect(() => {
    load();
    if (!autoRefresh) return;

    // El servidor mantiene la base al dia solo; basta con volver a pedir.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load, autoRefresh]);

  /**
   * Preferencias con identidad estable.
   *
   * Cada recarga trae un objeto NUEVO aunque el contenido sea identico, y abajo
   * hay efectos que reaccionan a ese objeto para aplicar los ajustes recien
   * guardados. Sin esto, el refresco automatico le devolvia el grafico a su
   * temporalidad por defecto cada treinta segundos mientras lo estabas mirando.
   *
   * Comparar por contenido serializado y no por identidad hace que esos efectos
   * salten solo cuando los ajustes cambian de verdad.
   */
  const prefsKey = data ? JSON.stringify(data.chartPrefs) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chartPrefs = useMemo(() => data?.chartPrefs ?? null, [prefsKey]);

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
        {/* El selector de cuenta va el primero de la fila: es el filtro que mas
            cambia lo que ves, porque dos cuentas distintas son dos historiales
            distintos y mezclarlos no tiene ningun sentido. */}
        {data && data.accounts.length > 0 && (
          <label>
            Cuenta
            <select value={filters.account ?? ''} onChange={(e) => set({ account: e.target.value || undefined })}>
              <option value="">todas ({data.accounts.reduce((a, c) => a + c.operations, 0)})</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {a.operations} ops · desde {date(a.from)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Base
          <select value={filters.basis ?? 'net'} onChange={(e) => set({ basis: e.target.value as 'net' | 'gross' })}>
            <option value="net">neto</option>
            <option value="gross">bruto</option>
          </select>
        </label>
        {data && <CommissionSetting value={data.costSettings.commissionPerContract} onChange={saveCommission} />}
        <button onClick={load}>Actualizar</button>
        <span className="live"><b>en vivo</b> · {live}</span>
      </div>

      {error && <div className="error">No se pudo cargar: {error}</div>}

      {/* Elegir una cuenta y ver cero operaciones solo puede pasar ya por el
          filtro de fechas o el de sesion, no por el de pruebas: la cuenta
          siempre se ensena entera. */}
      {data && data.count === 0 && filters.account && (filters.from || filters.to || filters.session) && (
        <div className="news-alert">
          <b>Nada que mostrar</b>
          <span>
            Esa cuenta no tiene operaciones dentro del filtro de fecha o sesion que tienes puesto.{' '}
            <button onClick={() => set({ from: undefined, to: undefined, session: undefined })}>
              Quitar esos filtros
            </button>
          </span>
        </div>
      )}

      {data && (
        <>
          <div className="tabs main">
            {(['resumen', 'operaciones', 'mercado', 'costes', 'noticias', 'ajustes'] as const).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'resumen' ? 'Resumen'
                  : t === 'operaciones' ? `Operaciones (${data.count})`
                  : t === 'mercado' ? 'Mercado'
                  : t === 'costes' ? 'Costes y recorrido'
                  : t === 'ajustes' ? 'Ajustes'
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

          {tab === 'mercado' && <MarketPanel />}

          {tab === 'noticias' && <CalendarPanel data={data.calendar} news={data.news} />}

          {tab === 'ajustes' && (
            <SettingsPanel
              prefs={chartPrefs ?? data.chartPrefs}
              commission={data.costSettings.commissionPerContract}
              onSaved={load}
            />
          )}

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

              <div className="grid2">
                <div className="panel">
                  <h2>P&amp;L por dia de la semana</h2>
                  <BarsChart rows={data.byWeekday} label={(k) => WEEKDAYS[Number(k)] ?? String(k)} />
                </div>
                <div className="panel">
                  <h2>P&amp;L por fecha</h2>
                  <RecentBarsChart
                    rows={data.byDay}
                    label={(k) => String(k).slice(8) + '/' + String(k).slice(5, 7)}
                  />
                </div>
              </div>

              <div className="panel">
                <h2>Resumen por jornada</h2>
                <div className="note" style={{ marginBottom: 8 }}>
                  Cuantas operaciones hubo cada dia, como se repartieron entre compras y
                  ventas, y cuanto dejo cada jornada. Las cifras de dinero son{' '}
                  <b>dolares por contrato</b>, en bruto: sin comisiones.
                </div>
                <DayTable
                  rows={data.byDay}
                  label={(k) => String(k).slice(8) + '/' + String(k).slice(5, 7)}
                />
              </div>

              <div className="panel">
                <h2>Metricas por grupo</h2>
                <Breakdown data={data} />
              </div>

              <div className="panel">
                <h2>Aperturas de killzone</h2>
                <OpeningsPanel />
              </div>

              <div className="panel">
                <h2>Patron de la vela de 15 minutos</h2>
                <PatternPanel data={data.patterns} />
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
                        <td className={signClass(f.pnl)}>{signedUsd(f.pnl)}</td>
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

          {tab === 'operaciones' && (
            <Operations filters={filters} offsetHours={data.marketOffsetHours} prefs={chartPrefs ?? data.chartPrefs} />
          )}

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
