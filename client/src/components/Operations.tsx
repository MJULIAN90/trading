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
import { useSticky } from '../sticky';
import { KINDS, type Kind, sortByPolarity, tagClass, tagsOfKind } from '../tags';
import { DayCalendar } from './DayCalendar';
import { OpTooltip, type GloboDatos } from './OpTooltip';
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

/**
 * Titulos del filtro. Mas cortos que los de `KIND_LABEL`: ahi el ancho sobra y
 * conviene explicar, aqui la columna mide 300px y "Contexto del mercado" parte
 * en dos lineas por cada grupo.
 */
const KIND_CORTO: Record<Kind, string> = {
  estrategia: 'Estrategia',
  contexto: 'Contexto',
  conducta: 'Conducta',
};

function Detail({
  op,
  offsetHours,
  prefs,
  onNotesSaved,
}: {
  op: Operation;
  offsetHours: number;
  prefs: ChartPrefs;
  /** Para avisar al listado de que esta fila cambio de notas o etiquetas. */
  onNotesSaved: () => void;
}) {
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

      {/* Las pestanas en columna a la izquierda y no en una fila arriba.
          Son cinco y ocupaban una banda entera de alto justo encima del
          grafico, que es lo que se mira; de lado no le quitan ni un pixel de
          altura y encima se quedan visibles al bajar por una lista larga de
          observaciones. */}
      <div className="detail-body">
        <nav className="tabs lateral">
          {(['grafico', 'lectura', 'numeros', 'notas', 'observaciones'] as const).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'grafico' ? 'Grafico'
                : t === 'lectura' ? 'Lectura'
                : t === 'numeros' ? 'Numeros'
                : t === 'notas' ? 'Notas'
                : <>Observaciones <span className="n">{flags.length}</span></>}
            </button>
          ))}
        </nav>

        <div className="detail-pane">
          {/* La clave fuerza a React a reconstruir el grafico al cambiar de
              operacion, en vez de reutilizar el anterior con datos nuevos. */}
          {tab === 'grafico' && <Replayer key={op.id} id={op.id} offsetHours={offsetHours} prefs={prefs} />}
          {tab === 'lectura' && (reading ? <Reading narrative={reading} /> : <div className="empty">leyendo la operacion...</div>)}
          {tab === 'numeros' && <Numbers op={op} />}
          {tab === 'notas' && (
            <TradeNotes key={op.id} operationId={op.id} prefs={prefs} onSaved={onNotesSaved} />
          )}

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
      </div>
    </div>
  );
}

export function Operations({
  filters,
  offsetHours = -4,
  prefs,
  refreshKey = 0,
}: {
  filters: Filters;
  offsetHours?: number;
  prefs: ChartPrefs;
  /** Sube al pulsar "Actualizar" arriba. Vuelve a pedir el listado. */
  refreshKey?: number;
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

  // Fila sobre la que esta el raton, con su globo ya calculado. null = ninguna.
  const [globo, setGlobo] = useState<GloboDatos | null>(null);

  // El bloque de etiquetas cerrado por defecto. Con diecisiete etiquetas ocupa
  // casi trescientos pixeles y empuja el listado fuera de la pantalla, y el
  // listado es lo que se usa en cada operacion mientras que el filtro se toca
  // de vez en cuando. Se recuerda abierto si lo dejaste abierto.
  const [tagsAbierto, setTagsAbierto] = useSticky<boolean>('ops.tagsAbierto', false);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Contador que se sube al guardar una nota, para volver a pedir el listado.
   *
   * POR QUE RECARGAR Y NO PARCHEAR LA FILA A MANO. Lo que cambia al anotar no
   * es solo el punto de esa fila: el catalogo de etiquetas de arriba lleva el
   * numero de operaciones de cada una, y el servidor aplica sus propias reglas
   * al guardar —una sola estrategia por operacion, por ejemplo—. Reconstruir
   * todo eso aqui seria copiar reglas que ya viven en el servidor, y copiarlas
   * es garantizar que algun dia dejen de coincidir.
   *
   * Cuesta una llamada por nota guardada, 600 ms despues de dejar de teclear,
   * y el listado va paginado. No se nota.
   */
  const [revision, setRevision] = useState(0);

  /** Cuando se cargo el listado que estas viendo. */
  const [cargado, setCargado] = useState(() => Date.now());

  /**
   * Recargar a mano. VUELVE A LA PAGINA 1, y esa es la parte importante.
   *
   * Las operaciones nuevas entran por arriba -el listado va de la mas reciente
   * a la mas antigua-, asi que recargar estando en la pagina 3 vuelve a pedir
   * los datos, los recibe, y no enseña ni una de las nuevas. Parece que el
   * boton no hace nada.
   *
   * Era justo lo que hacia que funcionara irse a Resumen y volver: eso desmonta
   * el componente y la pagina vuelve a 1 de rebote.
   *
   * Guardar una nota NO pasa por aqui: ahi se recarga igual pero conservando la
   * pagina, porque no quieres que anotar la operacion 40 te mande a la 1.
   */
  const recargar = () => {
    setPage(1);
    setRevision((r) => r + 1);
  };

  // Cambiar filtros reinicia la paginacion: quedarse en la pagina 7 de un
  // listado que ahora tiene 2 no muestra nada y parece un fallo.
  // `refreshKey` entra aqui -y no solo en la peticion- por el mismo motivo que
  // el boton: el "Actualizar" de la cabecera se pulsa para ver lo ultimo, y lo
  // ultimo esta en la pagina 1.
  useEffect(() => { setPage(1); }, [filters, onlyFlagged, pageSize, direction, result, sessions, days, tagFilter, refreshKey]);

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
        setCargado(Date.now());
        // Se abre la primera por defecto: un panel de detalle vacio no explica
        // que hay que hacer para llenarlo.
        setSelected((s) => (s !== null && d.items.some((o) => o.id === s) ? s : d.items[0]?.id ?? null));
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
    // `revision` va AQUI y no en el efecto que reinicia la paginacion: si
    // estuviera alli, guardar una nota en la pagina 4 te devolveria a la 1.
  }, [filters, page, pageSize, onlyFlagged, direction, result, sessions, days, tagFilter, revision, refreshKey]);

  if (error) return <div className="error">No se pudo cargar: {error}</div>;
  if (!data) return <div className="empty">cargando...</div>;

  const current = data.items.find((o) => o.id === selected) ?? null;

  return (
    <div className="master-detail">
      <div className="master">
        {/* Lo primero de la columna: cuantas hay, de cuando son, y el boton de
            recargar. Estaba abajo del todo, detras de los filtros y de la
            lista entera, que es como tener el interruptor fuera de la
            habitacion. */}
        <div className="list-top">
          <button className="recargar" onClick={recargar} title="Vuelve a pedir el listado y salta a la pagina 1, que es donde entran las nuevas">
            ↻ actualizar
          </button>
          <span className="note">
            {data.total} ops · cargado {dateTime(cargado)}
          </span>
        </div>

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
          <div className="tag-box">
            {/* Cabecera siempre visible. Cuando esta cerrado tiene que decir
                QUE esta filtrando, no solo cuantas: "2 puestas" obliga a abrir
                para saber si lo que estas viendo son las de miedo o las de
                revancha. Y "limpiar" vive aqui para poder quitar el filtro sin
                abrir nada. */}
            <div className="tag-head">
              <button
                className="tag-toggle"
                onClick={() => setTagsAbierto(!tagsAbierto)}
                aria-expanded={tagsAbierto}
                title={tagsAbierto ? 'Esconder las etiquetas' : 'Filtrar por etiqueta'}
              >
                <span className="caret">{tagsAbierto ? '▾' : '▸'}</span>
                <span className="titulo">Etiquetas</span>
                {tagFilter.length > 0 ? (
                  <span className="puestas">{tagFilter.join(', ')}</span>
                ) : (
                  <span className="cuenta">{data.tags.length}</span>
                )}
              </button>

              {tagFilter.length > 0 && (
                <button className="clear" onClick={() => setTagFilter([])}>limpiar</button>
              )}
            </div>

            {tagsAbierto && (
              <div className="tag-grupos">
                {(() => {
                  const cuenta = new Map((data.tags ?? []).map((r) => [r.tag, r.count]));
                  const todas = (data.tags ?? []).map((r) => r.tag);

                  const pinta = (tag: string) => {
                    const n = cuenta.get(tag) ?? 0;
                    const on = tagFilter.includes(tag);
                    return (
                      <button
                        key={tag}
                        className={`${on ? 'on' : ''} ${tagClass(tag, prefs.tagPolarity, prefs.tagKind)} ${n === 0 ? 'vacia' : ''}`}
                        title={
                          n === 0
                            ? 'Ninguna operacion la lleva con los filtros puestos'
                            : `${n} operacion${n === 1 ? '' : 'es'} con los filtros puestos`
                        }
                        onClick={() =>
                          setTagFilter((cur) => (on ? cur.filter((x) => x !== tag) : [...cur, tag]))
                        }
                      >
                        {tag} <span className="note">{n}</span>
                      </button>
                    );
                  };

                  // Por eje y no en un monton suelto. Son tres preguntas
                  // distintas -que clase de operacion era, que habia en el
                  // mercado, que hice yo- y mezcladas en una sola parrafada
                  // de botones no se encuentra ninguna. Dentro de conducta
                  // van buenas, neutras y malas en ese orden.
                  return KINDS.map((eje) => {
                    const dentro = tagsOfKind(todas, prefs.tagKind, eje, prefs.tagPolarity);
                    if (dentro.length === 0) return null;

                    return (
                      <div className="tag-grupo" key={eje}>
                        <div className="tag-grupo-titulo">{KIND_CORTO[eje]}</div>
                        <div className="session-filter tag-filter">{dentro.map(pinta)}</div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
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
          {/* Hueco de los puntos de etiquetas. Va SIN texto porque la columna
              mide lo que midan los puntos, pero tiene que existir: la fila
              emite seis celdas y una cabecera de cinco descoloca las dos
              ultimas, que son justo las cifras. */}
          <span title="Un punto por etiqueta y un circulo hueco si hay nota. Pasa el raton por la fila para leerlas." />
          <span title="Ticks POR CONTRATO: el recorrido que capturaste, sin el tamano de la posicion">Ticks</span>
          <span title="Bruto menos comision. Los ticks son por contrato, asi que con varios contratos el bruto es el doble o el triple; la comision se paga aparte.">Neto</span>
        </div>

        {/* El globo va anclado a coordenadas de pantalla, asi que si la lista
            se desplaza debajo se queda flotando sobre una fila que ya no es la
            suya. Se esconde y vuelve a salir en cuanto el raton se mueve. */}
        <div className="op-list" onScroll={() => setGlobo(null)}>
          {data.items.map((op) => {
            const alerts = op.review.decisionAlerts;

            const etiquetas = sortByPolarity(op.tags ?? [], prefs.tagPolarity);
            const nota = (op.note ?? '').trim();

            // Las dos cifras de la fila parecen descuadradas -28,5 ticks y
            // -$30,50- y no lo estan: los ticks son POR CONTRATO y la comision
            // se cobra aparte. Con la cuenta desglosada deja de parecer un
            // error. Es tambien lo que explica que una operacion de 0 ticks
            // salga en negativo: la ida y vuelta se paga igual.
            const detalle = (caja: DOMRect): GloboDatos => ({
              ancla: { top: caja.top, bottom: caja.bottom, left: caja.left },
              // La salida solo con la hora: la fecha ya la lleva la apertura y
              // repetirla en una operacion de noventa segundos es ruido.
              cuando:
                `${dateTime(op.opened_at)} → ${dateTime(op.closed_at).slice(6)}` +
                ` · ${duration(op.duration_sec)}`,
              sesion: sessionLabel(op.session),
              formula:
                op.ticks === null || op.tickValue === null
                  ? null
                  : `${ticks(op.ticks)} ticks x ${op.max_quantity} contrato${op.max_quantity === 1 ? '' : 's'} x ${usd(op.tickValue)}`,
              bruto: op.ticks === null ? null : signedUsd(op.rawGrossPnl),
              comision: signedUsd(-op.commission),
              neto: signedUsd(op.netPnl),
              netoClase: signClass(op.netPnl),
              etiquetas: etiquetas.map((nombre) => ({
                nombre,
                clase: tagClass(nombre, prefs.tagPolarity, prefs.tagKind),
              })),
              nota,
            });

            return (
              <button
                key={op.id}
                className={`op-item ${op.id === selected ? 'on' : ''}`}
                onClick={() => setSelected(op.id)}
                onMouseEnter={(e) => setGlobo(detalle(e.currentTarget.getBoundingClientRect()))}
                onMouseLeave={() => setGlobo(null)}
                onFocus={(e) => setGlobo(detalle(e.currentTarget.getBoundingClientRect()))}
                onBlur={() => setGlobo(null)}
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
                      className={`dot ${tagClass(t, prefs.tagPolarity, prefs.tagKind)}`}
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

        {globo !== null && <OpTooltip datos={globo} />}

        <div className="legend">
          <b>Ticks</b> por contrato y <b>Neto</b> = bruto &minus; comision, por eso las dos cifras
          de una fila no cuadran a simple vista: con 2 contratos el bruto es el doble de los ticks,
          y una operacion de 0 ticks sale en negativo porque la ida y vuelta se paga igual.
          Pasa el raton por una fila y te sale la cuenta entera. El importe por contrato se ajusta
          en Ajustes &rsaquo; Costes ·{' '}
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
        <Detail
          op={current}
          offsetHours={offsetHours}
          prefs={prefs}
          onNotesSaved={() => setRevision((r) => r + 1)}
        />
      ) : (
        <div className="detail"><div className="empty">selecciona una operacion</div></div>
      )}
    </div>
  );
}
