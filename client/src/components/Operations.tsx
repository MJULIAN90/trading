import { useEffect, useState } from 'react';
import {
  api,
  TIMEFRAMES,
  timeframeLabel,
  type ChartPrefs,
  type Filters,
  type Narrative,
  type Operation,
  type Page,
  type Replay,
} from '../api';
import { dateTime, duration, num, sessionLabel, signClass, signedUsd, ticks, usd } from '../format';
import { polarityApplies, polarityClass, polarityOf, sortByPolarity } from '../tags';
import { DayCalendar } from './DayCalendar';
import { Diagnosis } from './Diagnosis';
import { TradeChart } from './TradeChart';
import { TradeNotes } from './TradeNotes';
import { TrendStrip } from './TrendStrip';

/**
 * Panel de operaciones en dos mitades: el listado a la izquierda y el detalle de
 * la seleccionada a la derecha.
 *
 * Antes cada fila se desplegaba hacia abajo y empujaba todo lo demas, asi que
 * comparar dos operaciones obligaba a cerrar una, buscar la otra y perder el
 * sitio. Con el detalle fijo a un lado se salta de una a otra sin recolocar nada.
 */

const SEVERITY_ORDER = { alert: 0, warn: 1, info: 2, good: 3 } as const;

const SESSIONS = ['ASIA', 'LONDON', 'NY_AM', 'NY_LUNCH', 'NY_PM', 'OUTSIDE'];

/**
 * Distintivo de direccion. Va primero en la fila y con el color del lado porque
 * es el dato que mas rapido hay que reconocer al repasar: antes decia "L2" o
 * "C2" y habia que pararse a descifrarlo en cada linea.
 */
function Side({ direction, qty }: { direction: 'LONG' | 'SHORT'; qty?: number }) {
  const buy = direction === 'LONG';
  return (
    <span className={`side ${buy ? 'buy' : 'sell'}`}>
      {buy ? 'BUY' : 'SELL'}
      {qty !== undefined && <b>{qty}</b>}
    </span>
  );
}

function orderFlags(op: Operation) {
  // Las de decision primero: son las unicas sobre las que se puede actuar la
  // proxima vez. Las de resultado solo describen como acabo.
  return [...op.review.flags].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'decision' ? -1 : 1;
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });
}

function Replayer({
  id,
  offsetHours,
  prefs,
}: {
  id: number;
  offsetHours: number;
  prefs: ChartPrefs;
}) {
  // La temporalidad arranca en la de los ajustes, pero se puede cambiar sin
  // guardarla: mirar una operacion en 4h un momento no deberia cambiar como se
  // abren todas las demas a partir de ahora.
  const [timeframe, setTimeframe] = useState(prefs.timeframe);
  const [candles, setCandles] = useState(prefs.candles);
  const [data, setData] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Depende de los VALORES, no del objeto: si dependiera del objeto, cualquier
  // recarga del panel —aunque los ajustes no hubieran cambiado— devolveria el
  // grafico a su temporalidad por defecto mientras lo estas mirando.
  useEffect(() => { setTimeframe(prefs.timeframe); }, [prefs.timeframe]);
  useEffect(() => { setCandles(prefs.candles); }, [prefs.candles]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    api
      .replay(id, timeframe, candles)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [id, timeframe, candles]);

  return (
    <div className="replay">
      <div className="filters" style={{ marginBottom: 8 }}>
        <div className="tf-switch">
          {TIMEFRAMES.map((t) => (
            <button key={t} className={timeframe === t ? 'on' : ''} onClick={() => setTimeframe(t)}>
              {timeframeLabel(t)}
            </button>
          ))}
        </div>
        <label>
          velas
          {/* La lista incluye SIEMPRE el valor actual, aunque no sea uno de los
              de siempre. Un <select> cuyo valor no coincide con ninguna opcion
              ensena la primera: con 250 guardado en los ajustes, el desplegable
              decia 60 mientras el grafico pedia 250. Mentia sobre lo que
              estabas viendo. */}
          <select value={candles} onChange={(e) => setCandles(Number(e.target.value))}>
            {[...new Set([60, 120, 180, 300, 500, candles])]
              .sort((a, b) => a - b)
              .map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {data?.excursion && data.excursion.mae !== null && (
          <span className="live">
            fue <b className="neg">{ticks(data.excursion.mae)} ticks</b> en contra y{' '}
            <b className="pos">{ticks(data.excursion.mfe ?? 0)}</b> a favor
            {data.excursion.capture !== null && ` · te llevaste el ${(data.excursion.capture * 100).toFixed(0)}%`}
          </span>
        )}
      </div>

      {error && <div className="error">No se pudo cargar el grafico: {error}</div>}
      {!error && !data && <div className="empty">cargando grafico...</div>}
      {data && <TradeChart data={data} offsetHours={offsetHours} prefs={prefs} />}
      {data && <TrendStrip trend={data.trend} pattern={data.pattern} direction={String(data.operation.direction)} />}
      {data && <Diagnosis data={data} />}
    </div>
  );
}

/**
 * Lectura de la operacion en prosa. La escribe el servidor a partir de los
 * hechos, no un modelo: cada frase corresponde a un numero que esta en la ficha.
 */
function Reading({ narrative }: { narrative: Narrative }) {
  return (
    <div className="reading">
      {narrative.lines.map((l, i) => <p key={i}>{l}</p>)}
      {narrative.takeaway && (
        <p className="takeaway"><b>Lo que hay que corregir:</b> {narrative.takeaway}</p>
      )}
    </div>
  );
}

/** Ficha de numeros: ticks, costes y lo que quedo neto. */
function Numbers({ op }: { op: Operation }) {
  return (
    <table className="numbers">
      <tbody>
        <tr>
          <td>Direccion</td>
          <td><Side direction={op.direction} /> · {op.max_quantity} contrato{op.max_quantity === 1 ? '' : 's'}</td>
        </tr>
        <tr>
          <td>Entrada → salida <span className="note">(precio)</span></td>
          <td>{num(op.entry_price)} → {num(op.exit_price)}</td>
        </tr>
        <tr>
          <td>Ticks por contrato</td>
          <td className={signClass(op.ticks ?? 0)}>
            {op.ticks === null ? '—' : ticks(op.ticks)}
            {op.points !== null && <span className="note"> ({num(op.points)} puntos)</span>}
          </td>
        </tr>
        <tr>
          <td>Bruto</td>
          <td className={signClass(op.rawGrossPnl)}>{signedUsd(op.rawGrossPnl)}</td>
        </tr>
        <tr>
          <td>Comision</td>
          <td className="neg">−{usd(op.commission)}</td>
        </tr>
        <tr>
          <td><b>Neto</b></td>
          <td className={signClass(op.netPnl)}><b>{signedUsd(op.netPnl)}</b></td>
        </tr>
        <tr>
          <td>Duracion</td>
          <td>{duration(op.duration_sec)} · {op.fills_count} ejecuciones</td>
        </tr>
        <tr>
          <td>Sesion</td>
          <td>{sessionLabel(op.session)} · abierta {dateTime(op.opened_at)}</td>
        </tr>

        {op.excursion && op.excursion.mae !== null && (
          <>
            <tr><td colSpan={2} className="row-sep">Recorrido mientras estuvo abierta</td></tr>
            <tr>
              <td>Fue en contra (MAE)</td>
              <td className="neg">{ticks(op.excursion.mae)} ticks</td>
            </tr>
            <tr>
              <td>Fue a favor (MFE)</td>
              <td className="pos">{ticks(op.excursion.mfe ?? 0)} ticks</td>
            </tr>
            <tr>
              <td>Devuelto</td>
              <td className={op.excursion.givenBack && op.excursion.givenBack > 0 ? 'neg' : ''}>
                {op.excursion.givenBack === null ? '—' : `${ticks(op.excursion.givenBack)} ticks`}
                {op.excursion.capture !== null && (
                  <span className="note"> (te llevaste el {(op.excursion.capture * 100).toFixed(0)}%)</span>
                )}
              </td>
            </tr>
          </>
        )}
      </tbody>
    </table>
  );
}

/**
 * Lectura en una linea de lo que paso con el recorrido.
 *
 * Existe porque la cifra sola no acciona nada: "MFE 39" no dice que hacer, pero
 * "estuviste 39 ticks arriba y acabaste perdiendo" senala directamente a la
 * salida y no a la entrada, que es donde casi todo el mundo busca el fallo.
 */
function ExcursionNote({ op }: { op: Operation }) {
  const ex = op.excursion;
  if (!ex || ex.mae === null || ex.mfe === null) return null;

  const won = op.netPnl > 0;

  if (!won && ex.givenBack !== null && ex.mfe >= 8) {
    return (
      <div className="flag warn">
        <span className="dot" />
        <span>
          <div className="title">Estuviste en beneficio y lo devolviste</div>
          <div className="detail-text">
            Llego a ir {ticks(ex.mfe)} ticks a tu favor antes de cerrar en {signedUsd(op.netPnl)} USD.
            Eso apunta a la salida, no a la entrada.
          </div>
        </span>
      </div>
    );
  }

  if (won && ex.capture !== null && ex.capture < 0.4 && ex.mfe >= 20) {
    return (
      <div className="flag info">
        <span className="dot" />
        <span>
          <div className="title">Saliste pronto</div>
          <div className="detail-text">
            Te llevaste el {(ex.capture * 100).toFixed(0)}% del recorrido: {ticks(ex.mfe)} ticks
            disponibles.
          </div>
        </span>
      </div>
    );
  }

  return null;
}

function Detail({ op, offsetHours, prefs }: { op: Operation; offsetHours: number; prefs: ChartPrefs }) {
  const [tab, setTab] = useState<'grafico' | 'lectura' | 'numeros' | 'notas' | 'observaciones'>('grafico');
  const [reading, setReading] = useState<Narrative | null>(null);
  const flags = orderFlags(op);

  // Endpoint propio, minimo. Antes esto se traia el replay ENTERO —todas las
  // velas, la tendencia, el patron— para quedarse solo con la narrativa y tirar
  // el resto. Con 300 velas de 4h eso son decenas de miles de velas de un
  // minuto pedidas dos veces por cada operacion que abres.
  useEffect(() => {
    let cancelled = false;
    setReading(null);
    api.reading(op.id).then((d) => { if (!cancelled) setReading(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [op.id]);

  return (
    <div className="detail">
      <div className="detail-head">
        <Side direction={op.direction} qty={op.max_quantity} />
        <span className="when">{dateTime(op.opened_at)}</span>
        <span className="ses">{sessionLabel(op.session)}</span>
        <span className={`pnl ${signClass(op.netPnl)}`}>{signedUsd(op.netPnl)}</span>
        <span className={`pnl ${signClass(op.ticks ?? 0)}`}>{op.ticks === null ? '' : `${ticks(op.ticks)} ticks`}</span>
      </div>

      <div className="tabs">
        {(['grafico', 'lectura', 'numeros', 'notas', 'observaciones'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'grafico' ? 'Grafico'
              : t === 'lectura' ? 'Lectura'
              : t === 'numeros' ? 'Numeros'
              : t === 'notas' ? 'Notas'
              : `Observaciones (${flags.length})`}
          </button>
        ))}
      </div>

      {/* La clave fuerza a React a reconstruir el grafico al cambiar de
          operacion, en vez de reutilizar el anterior con datos nuevos. */}
      {tab === 'grafico' && <Replayer key={op.id} id={op.id} offsetHours={offsetHours} prefs={prefs} />}
      {tab === 'lectura' && (reading ? <Reading narrative={reading} /> : <div className="empty">leyendo la operacion...</div>)}
      {tab === 'numeros' && <Numbers op={op} />}
      {tab === 'notas' && <TradeNotes key={op.id} operationId={op.id} prefs={prefs} />}

      {tab === 'observaciones' && (
        <>
          <ExcursionNote op={op} />
          {flags.length === 0 && <div className="op-meta">Sin observaciones.</div>}
          {flags.map((f) => (
            <div key={f.code} className={`flag ${f.severity}`}>
              <span className="dot" />
              <span>
                <div className="title">{f.title}</div>
                <div className="detail-text">{f.detail}</div>
              </span>
              <span className="kind">{f.kind === 'decision' ? 'decision' : 'resultado'}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function Operations({
  filters,
  offsetHours = -4,
  prefs,
}: {
  filters: Filters;
  offsetHours?: number;
  prefs: ChartPrefs;
}) {
  const [page, setPage] = useState(1);
  // 15 por defecto: con esa cantidad el listado entra entero sin barra de
  // scroll, y una pagina que se ve de un vistazo se repasa; una de cincuenta
  // se hojea.
  const [pageSize, setPageSize] = useState(15);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [direction, setDirection] = useState<'' | 'LONG' | 'SHORT'>('');
  // Ganadoras / perdedoras. Se decide sobre el NETO, igual que lo que pinta la
  // tabla, no sobre el bruto.
  const [result, setResult] = useState<'' | 'win' | 'loss'>('');
  // Sesiones en multiple: comparar "NY AM contra NY PM" es una pregunta normal,
  // y con un desplegable de una sola opcion habria que mirarlas por separado y
  // sumar de cabeza.
  const [sessions, setSessions] = useState<string[]>([]);
  const [days, setDays] = useState<string[]>([]);
  // Etiquetas en multiple, igual que las sesiones: "ensename las de revancha o
  // fuera de plan" es una pregunta normal. Cruza por CUALQUIERA, no por todas.
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [data, setData] = useState<Page<Operation> | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cambiar filtros reinicia la paginacion: quedarse en la pagina 7 de un
  // listado que ahora tiene 2 no muestra nada y parece un fallo.
  useEffect(() => { setPage(1); }, [filters, onlyFlagged, pageSize, direction, result, sessions, days, tagFilter]);

  useEffect(() => {
    let cancelled = false;
    api
      .operations(
        {
          ...filters,
          onlyFlagged,
          direction: direction || undefined,
          result: result || undefined,
          // El filtro de la cabecera sigue mandando si esta puesto; estos
          // botones son para afinar dentro de lo que ya se esta mirando.
          sessions: sessions.length ? sessions : undefined,
          days: days.length ? days : undefined,
          tags: tagFilter.length ? tagFilter : undefined,
        },
        page,
        pageSize,
      )
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        // Se abre la primera por defecto: un panel de detalle vacio no explica
        // que hay que hacer para llenarlo.
        setSelected((s) => (s !== null && d.items.some((o) => o.id === s) ? s : d.items[0]?.id ?? null));
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [filters, page, pageSize, onlyFlagged, direction, result, sessions, days, tagFilter]);

  if (error) return <div className="error">No se pudo cargar: {error}</div>;
  if (!data) return <div className="empty">cargando...</div>;

  const current = data.items.find((o) => o.id === selected) ?? null;

  return (
    <div className="master-detail">
      <div className="master">
        {/* Separar compras de ventas no es solo filtrar: el mismo mercado se
            opera distinto en cada sentido, y mezclarlos esconde que uno de los
            dos lados puede estar costando todo el dinero. */}
        <div className="side-filter">
          {([['', 'Todas'], ['LONG', 'BUY'], ['SHORT', 'SELL']] as const).map(([v, label]) => (
            <button
              key={v}
              className={`${direction === v ? 'on' : ''} ${v === 'LONG' ? 'buy' : v === 'SHORT' ? 'sell' : ''}`}
              onClick={() => setDirection(v)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="side-filter">
          {([['', 'Todas'], ['win', 'Ganadoras'], ['loss', 'Perdedoras']] as const).map(([v, label]) => (
            <button
              key={v}
              className={`${result === v ? 'on' : ''} ${v === 'win' ? 'buy' : v === 'loss' ? 'sell' : ''}`}
              onClick={() => setResult(v)}
            >
              {label}
            </button>
          ))}
        </div>

        {data.days && data.days.length > 0 && (
          <DayCalendar
            days={data.days}
            selected={days}
            onToggle={(d) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
            onClear={() => setDays([])}
          />
        )}

        <div className="session-filter">
          {SESSIONS.map((sv) => {
            const on = sessions.includes(sv);
            return (
              <button
                key={sv}
                className={on ? 'on' : ''}
                onClick={() =>
                  setSessions((cur) => (on ? cur.filter((x) => x !== sv) : [...cur, sv]))
                }
              >
                {sessionLabel(sv)}
              </button>
            );
          })}
          {sessions.length > 0 && (
            <button className="clear" onClick={() => setSessions([])}>limpiar</button>
          )}
        </div>

        {/* Las etiquetas que de verdad aparecen en lo que se esta mirando, con
            su cuenta. Salen del servidor SIN aplicar este mismo filtro: si
            salieran de lo ya filtrado, al marcar una desapareceria el resto de
            botones y no habria forma de cambiar sin limpiar primero. */}
        {data.tags && data.tags.length > 0 && (
          <div className="session-filter tag-filter">
            {(() => {
              // Las marcadas PRIMERO, y una raya detras. Asi se ve lo que
              // esta puesto sin una seccion aparte arriba que empuje el
              // calendario media pantalla hacia abajo.
              const todas = sortByPolarity(data.tags?.map((t) => t.tag) ?? [], prefs.tagPolarity);
              const puestas = todas.filter((t) => tagFilter.includes(t));
              const resto = todas.filter((t) => !tagFilter.includes(t));

              const pinta = (tag: string) => {
                const row = data.tags?.find((t) => t.tag === tag);
                const on = tagFilter.includes(tag);
                return (
                  <button
                    key={tag}
                    className={`${on ? 'on' : ''} ${
                      polarityApplies(tag, prefs.tagKind)
                        ? polarityClass(polarityOf(tag, prefs.tagPolarity))
                        : ''
                    }`}
                    onClick={() =>
                      setTagFilter((cur) => (on ? cur.filter((x) => x !== tag) : [...cur, tag]))
                    }
                  >
                    {tag} <span className="note">{row?.count ?? 0}</span>
                  </button>
                );
              };

              return (
                <>
                  {puestas.map(pinta)}
                  {puestas.length > 0 && <span className="tag-sep" />}
                  {resto.map(pinta)}
                  {tagFilter.length > 0 && (
                    <button className="clear" onClick={() => setTagFilter([])}>limpiar</button>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {data.totals && (
          <div className="side-totals">
            <span className={signClass(data.totals.netPnl)}>{signedUsd(data.totals.netPnl)}</span>
            <span className={signClass(data.totals.ticksWon + data.totals.ticksLost)}>
              {ticks(data.totals.ticksWon + data.totals.ticksLost)} ticks
            </span>
            <span className="note">{data.totals.operations} ops</span>
          </div>
        )}

        <div className="filters compact">
          <label>
            <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
            solo con alertas
          </label>
          <label>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[10, 15, 25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>

        {data.items.length === 0 && <div className="empty">no hay operaciones con estos filtros</div>}

        {/* Cabecera de columnas con la misma rejilla que las filas. Sin ella el
            numero circulado parece un dato de la operacion cuando en realidad
            es un aviso, y los ticks se confunden con el resultado en dolares. */}
        <div className="op-head">
          <span title="Lado y numero de contratos">Lado</span>
          <span title="Hora de mercado en que se abrio">Apertura</span>
          <span title="Reentradas inmediatas tras perder y entradas en mitad de una racha perdedora">Avisos</span>
          <span title="Ticks por contrato: el recorrido que capturaste, sin el tamano">Ticks</span>
          <span title="Resultado despues de comisiones">Neto</span>
        </div>

        <div className="op-list">
          {data.items.map((op) => {
            const alerts = op.review.decisionAlerts;

            // Globo nativo del navegador y no un componente propio: asi sale
            // igual con la lista desplazada y no lo recorta el borde del panel,
            // que es justo donde viven estas filas.
            const etiquetas = sortByPolarity(op.tags ?? [], prefs.tagPolarity);
            const nota = (op.note ?? '').trim();
            const globo =
              (etiquetas.length > 0 ? etiquetas.join('  ·  ') : 'sin etiquetas') +
              (nota ? `\n\n${nota}` : '');

            return (
              <button
                key={op.id}
                className={`op-item ${op.id === selected ? 'on' : ''}`}
                onClick={() => setSelected(op.id)}
                title={globo}
              >
                <Side direction={op.direction} qty={op.max_quantity} />
                <span className="when">{dateTime(op.opened_at)}</span>
                {alerts > 0
                  ? <span className="chip alert" title={`${alerts} aviso${alerts === 1 ? '' : 's'}: reentrada tras perder o racha perdedora. Mira la pestana Observaciones.`}>{alerts}</span>
                  : <span />}

                {/* Un punto por etiqueta, con su color. Dice que HAY algo
                    anotado sin robarle sitio a las cifras; el detalle lo da
                    el globo. Sin esto no hay forma de saber que filas tienen
                    nota sin pasar el raton por todas. */}
                <span className="op-dots">
                  {etiquetas.slice(0, 4).map((t) => (
                    <i
                      key={t}
                      className={`dot ${
                        polarityApplies(t, prefs.tagKind)
                          ? polarityClass(polarityOf(t, prefs.tagPolarity))
                          : ''
                      }`}
                    />
                  ))}
                  {nota && <i className="dot nota" />}
                </span>

                <span className={`t ${signClass(op.ticks ?? 0)}`}>{op.ticks === null ? '' : ticks(op.ticks)}</span>
                <span className={`pnl ${signClass(op.netPnl)}`}>{signedUsd(op.netPnl)}</span>
              </button>
            );
          })}
        </div>

        <div className="legend">
          <b>Ticks</b> por contrato · <b>Neto</b> tras comision ·{' '}
          <b>Avisos</b>: reentraste a los pocos minutos de perder, o entraste con varias perdidas
          seguidas encima. No dice que la operacion este mal, dice que fue una reaccion.
        </div>

        <div className="pager">
          <span className="info">{data.total} · pag {data.page}/{data.totalPages}</span>
          <button disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
          <button disabled={data.page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
        </div>
      </div>

      {current ? (
        <Detail op={current} offsetHours={offsetHours} prefs={prefs} />
      ) : (
        <div className="detail"><div className="empty">selecciona una operacion</div></div>
      )}
    </div>
  );
}
