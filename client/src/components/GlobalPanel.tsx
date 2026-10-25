import { Fragment, useEffect, useRef, useState } from 'react';
import { num, signClass } from '../format';
import { useSort } from '../sortable';

/**
 * News: contexto de mercado. Materias primas, bonos, indices, resultados y
 * noticias.
 *
 * Lee de `/api/global`, que a su vez lee de la base. El servidor es quien habla
 * con el proveedor, cada diez minutos: si cada pestaña abierta pidiera por su
 * cuenta, el plan gratuito se gastaria en una mañana.
 *
 * DOS SUBPESTAÑAS, Y NO ES COSMETICO. Los numeros se miran antes de abrir -que
 * se mueve hoy, quien presenta esta semana- y los titulares se leen cuando algo
 * ya se movio. Mezclarlos obliga a bajar media pantalla de noticias para ver un
 * precio, que es como estaba y por lo que no se usaba.
 */

type QuoteKind = 'materia' | 'bono' | 'indice' | 'accion';

/** Lo que devuelve el servidor: la cotizacion mas lo que sabemos de ella. */
interface Row {
  symbol: string; label: string; kind: QuoteKind;
  price: number; changePct: number | null; ts: number;
  name: string; weight: number | null; changePct5d: number | null;
}
interface Earning {
  symbol: string; name: string; date: string; when: string | null;
  epsEstimate: number | null; epsActual: number | null;
  revenueEstimate: number | null; revenueActual: number | null; daysTo: number;
}
interface NewsItem {
  id: string; ts: number; headline: string; source: string | null;
  url: string | null; summary: string | null; symbols: string | null;
  /** De -1 a +1. null = nadie la ha puntuado, que no es lo mismo que neutro. */
  sentiment: number | null;
  relevance: number | null;
  /** De que va: una de tus empresas, el terreno de juego, u otra cosa. */
  topic?: 'empresa' | 'macro' | 'otra';
}

/** Como le fue a cada fuente por separado. */
interface BlockState {
  name: string;
  okAt: number | null;
  rows: number | null;
  failAt: number | null;
  error: string | null;
  /** Apagada porque el proveedor no la da gratis. Ni avisa ni se reintenta. */
  disabled?: boolean;
  /** Lo que tenemos de esta fuente ya es viejo. Es lo unico que avisa. */
  stale: boolean;
}
interface Alert { kind: 'noticia' | 'movimiento' | 'resultados'; text: string; key: string }

interface Report {
  quotes: Row[]; earnings: Earning[]; news: NewsItem[];
  updatedAt: number | null; error: string | null; alerts: Alert[];
  /** Cuota diaria del proveedor de pago por peticion. */
  alpha: { day: string; used: number; budget: number };
  /** Fase del mercado americano de contado y cuando toca el siguiente ciclo. */
  phase: string | null;
  nextAt: number | null;
  /** Cuantos dias de titulares trae `news`. */
  newsWindowDays: number;
  blocks: BlockState[];
}

/** Lo que contesta POST /api/global/refresh. */
interface RefreshResult {
  quotes: number; earnings: number; newsNew: number;
  errors: string[]; did: string[]; fase: string;
  alpha: { used: number; budget: number };
}

const KIND_LABEL: Record<QuoteKind, string> = {
  materia: 'Materias primas', bono: 'Bonos EE.UU.', indice: 'Indices', accion: 'Acciones',
};

const hora = (ms: number) => new Date(ms).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Porcentaje con signo. null se pinta como raya, no como cero. */
function pct(v: number | null) {
  if (v === null) return <span className="note">—</span>;
  return <span className={signClass(v)}>{v > 0 ? '+' : ''}{v.toFixed(2)}%</span>;
}

/**
 * La puntuacion de una noticia, cuando la tiene.
 *
 * Solo la traen las de Alpha Vantage. Una noticia sin puntuar no pinta nada:
 * un "0" diria que la han leido y les parecio neutra, y no es verdad.
 */
function animo(v: number | null) {
  if (v === null) return null;
  const clase = v <= -0.15 ? 'neg' : v >= 0.15 ? 'pos' : 'tibio';
  return <span className={`animo ${clase}`}>{v > 0 ? '+' : ''}{v.toFixed(2)}</span>;
}

const FASE_TEXTO: Record<string, string> = {
  abierto: 'mercado abierto',
  extendido: 'fuera de horas',
  cerrado: 'mercado cerrado',
};

/**
 * Texto sin tildes ni mayusculas, para buscar.
 *
 * Sin esto, escribir "inflacion" no encuentra "inflación" y escribir "nvda" no
 * encuentra "NVDA", que son justo las dos formas en que uno teclea con prisa.
 * `normalize('NFD')` separa la letra de su tilde y el reemplazo se la quita.
 */
const plano = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Dia de la noticia, para el separador de la lista. */
const diaDe = (ms: number) =>
  new Date(ms).toLocaleDateString('es', { weekday: 'long', day: '2-digit', month: 'long' });

/** Solo la hora: la fecha ya la dice el separador de dia de arriba. */
const soloHora = (ms: number) =>
  new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

const POR_PAGINA = 25;

/** "en 4 min". Para que se entienda que la pantalla no esta parada. */
function dentroDe(ms: number): string {
  const min = Math.round((ms - Date.now()) / 60_000);
  if (min <= 0) return 'en breve';
  if (min < 60) return `en ${min} min`;
  return `en ${Math.round(min / 60)} h`;
}

/** "hace 4 min". null cuando nunca paso. */
function haceCuanto(ms: number | null): string {
  if (ms === null) return 'nunca';
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  if (min < 60 * 48) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} dias`;
}

type Tema = 'relevantes' | 'empresas' | 'todas';

const TEMA_TEXTO: Record<Tema, string> = {
  relevantes: 'relevantes',
  empresas: 'mis empresas',
  todas: 'todas',
};

/**
 * Pitido generado al vuelo, sin fichero de sonido.
 *
 * Un .mp3 habria que servirlo, cachearlo y acordarse de no borrarlo. Dos tonos
 * cortos con el oscilador del navegador no dependen de nada y suenan igual en
 * cualquier equipo. Si el navegador bloquea el audio porque aun no has tocado
 * la pagina, falla en silencio: no es motivo para romper la pantalla.
 */
function pitar(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    const now = ctx.currentTime;

    for (const [i, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      // Subida y bajada suaves: un tono que empieza de golpe da un chasquido.
      gain.gain.setValueAtTime(0, now + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.12, now + i * 0.18 + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + i * 0.18 + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.16);
    }

    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* sin audio disponible; la alerta se ve igual en pantalla */
  }
}

export function GlobalPanel() {
  const [data, setData] = useState<Report | null>(null);
  const [sonido, setSonido] = useState(true);
  const [pendientes, setPendientes] = useState<Alert[]>([]);
  const [sub, setSub] = useState<'metricas' | 'noticias'>('metricas');
  // Por defecto solo lo relevante. El canal general trae de todo, y de catorce
  // titulares reales solo dos podian mover el Nasdaq.
  const [tema, setTema] = useState<Tema>('relevantes');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [pidiendo, setPidiendo] = useState(false);
  const [ultimo, setUltimo] = useState<string | null>(null);

  // Claves ya avisadas. En un ref y no en estado: cambiarlo no tiene que
  // repintar nada, y en estado provocaria un ciclo con el efecto de abajo.
  const vistas = useRef<Set<string>>(new Set());
  const primera = useRef(true);

  useEffect(() => {
    let vivo = true;

    const cargar = () => {
      fetch('/api/global')
        .then((r) => r.json())
        .then((d: Report) => {
          if (!vivo) return;
          setData(d);

          const nuevas = (d.alerts ?? []).filter((a) => !vistas.current.has(a.key));
          for (const a of nuevas) vistas.current.add(a.key);

          // En la PRIMERA carga no suena. Al abrir el diario te encontrarias
          // con el pitido de todo lo que paso mientras no mirabas, que es
          // justo el ruido que hace que acabes silenciandolo.
          if (primera.current) { primera.current = false; return; }

          if (nuevas.length > 0) {
            setPendientes((p) => [...nuevas, ...p].slice(0, 6));
            if (sonido) pitar();
          }
        })
        .catch(() => {});
    };

    cargar();
    const t = setInterval(cargar, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, [sonido]);

  /**
   * Forzar un ciclo a mano.
   *
   * Existe por un motivo muy concreto: cuando no sale nada en esta pantalla,
   * la pregunta es "¿falla la clave, falla el proveedor o es que aun no ha
   * tocado el ciclo?", y hasta ahora la unica forma de saberlo era mirar la
   * consola del servidor. Esto pide los cuatro bloques y dice CUAL fallo.
   *
   * Gasta cuota de Alpha Vantage (5 de las 20 del dia), asi que el boton lo
   * avisa en vez de esconderlo.
   */
  const refrescar = () => {
    setPidiendo(true);
    setUltimo(null);

    fetch('/api/global/refresh', { method: 'POST' })
      .then((r) => r.json())
      .then((r: RefreshResult) => {
        const resumen =
          `pedido: ${r.did.join(', ')} · ${r.quotes} cotizaciones, ` +
          `${r.newsNew} noticias nuevas · alpha ${r.alpha.used}/${r.alpha.budget}`;
        setUltimo(r.errors.length > 0 ? `${resumen} · FALLOS: ${r.errors.join(' · ')}` : resumen);
        return fetch('/api/global').then((x) => x.json());
      })
      .then((d: Report) => setData(d))
      .catch((e: Error) => setUltimo(`no se pudo pedir: ${e.message}`))
      .finally(() => setPidiendo(false));
  };

  const acciones = data?.quotes.filter((q) => q.kind === 'accion') ?? [];

  const tabla = useSort(
    acciones,
    {
      ticker: (q) => q.symbol,
      empresa: (q) => q.name,
      peso: (q) => q.weight,
      precio: (q) => q.price,
      dia: (q) => q.changePct,
      cinco: (q) => q.changePct5d,
      resultados: (q) => q.symbol,
    },
    null,
  );

  if (data === null) return <div className="empty">cargando contexto de mercado...</div>;

  const porFecha = new Map(data.earnings.map((e) => [e.symbol, e]));
  const proximos = data.earnings.filter((e) => e.daysTo >= 0 && e.daysTo <= 14);
  const sinClave = data.updatedAt === null && (data.error === null || data.error === '');

  const suben = acciones.filter((q) => (q.changePct ?? 0) > 0).length;
  const bajan = acciones.filter((q) => (q.changePct ?? 0) < 0).length;

  // El buscador mira el titular, el resumen, la fuente y los simbolos: si lo
  // que recuerdas de una noticia es que la dio Reuters, con eso basta.
  const consulta = plano(busca.trim());
  const noticias = data.news.filter((n) => {
    if (tema === 'empresas' && n.topic !== 'empresa') return false;
    if (tema === 'relevantes' && n.topic === 'otra') return false;
    if (consulta === '') return true;
    return plano(`${n.headline} ${n.summary ?? ''} ${n.source ?? ''} ${n.symbols ?? ''}`)
      .includes(consulta);
  });

  const descartadas = data.news.filter((n) => n.topic === 'otra').length;

  // Sin clave configurada no se pide nada, asi que TODAS saldrian viejas y el
  // aviso seria un muro rojo que no dice lo que pasa. Ese caso ya lo cuenta su
  // propio cartel de arriba.
  const viejas = sinClave ? [] : data.blocks.filter((b) => b.stale);

  // La pagina se recorta en vez de corregirse con un efecto: si borras el
  // buscador estando en la pagina 7 y solo quedan 3, se enseña la 3 y ya. Un
  // `setPagina` dentro de un efecto repintaria dos veces y parpadearia.
  const paginas = Math.max(1, Math.ceil(noticias.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas);
  const visibles = noticias.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA);

  /** Cambiar de filtro vuelve al principio: la pagina 7 de otra busqueda no
   *  significa nada en esta. */
  const filtrar = (fn: () => void) => { fn(); setPagina(1); };

  return (
    <>
      {/* Los avisos van FUERA de las subpestañas: si algo suena, tiene que
          verse estes mirando numeros o titulares. */}
      {sinClave && (
        <div className="news-alert" style={{ marginBottom: 10 }}>
          <b>Falta la clave del proveedor</b>
          <span>
            Pon <code>FINNHUB_API_KEY</code> y <code>ALPHA_API_KEY</code> en el fichero{' '}
            <code>.env</code> y reinicia el diario. Sin ellas esta pestaña no pide nada y el
            resto de la aplicacion funciona igual.
          </span>
        </div>
      )}

      {/* EL AVISO SOLO SALE SI ALGO ESTA DE VERDAD VIEJO.
          Antes saltaba con cualquier fallo, asi que un corte de red de treinta
          segundos -que el ciclo siguiente arregla solo- dejaba el mismo cartel
          rojo que una fuente caida dos dias. Ahora lo que manda es cuanto
          lleva cada fuente sin traer nada, no si el ultimo intento fallo. */}
      {viejas.length > 0 && (
        <div className="news-alert" style={{ marginBottom: 10 }}>
          <b>{viejas.length === 1 ? 'Una fuente lleva sin contestar' : 'Hay fuentes sin contestar'}</b>
          <span>
            {viejas.map((b) => `${b.name} (${haceCuanto(b.okAt)})`).join(' · ')}.
            El resto de la pantalla esta al dia. Abajo, en estado de las fuentes, esta el
            motivo exacto.
          </span>
        </div>
      )}

      {pendientes.length > 0 && (
        <div className="aviso-fuerte" style={{ marginBottom: 10 }}>
          <b>Avisos</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {pendientes.map((a) => <li key={a.key}>{a.text}</li>)}
          </ul>
          <button className="clear" style={{ marginTop: 6 }} onClick={() => setPendientes([])}>
            visto
          </button>
        </div>
      )}

      <div className="tabs">
        <button className={sub === 'metricas' ? 'on' : ''} onClick={() => setSub('metricas')}>
          Metricas
        </button>
        <button className={sub === 'noticias' ? 'on' : ''} onClick={() => setSub('noticias')}>
          Noticias ({data.news.length})
        </button>
      </div>

      <div className="filters" style={{ margin: '10px 0' }}>
        <label className="kz-toggle">
          <input type="checkbox" checked={sonido} onChange={(e) => setSonido(e.target.checked)} />
          sonido
        </label>

        {sub === 'noticias' && (
          <>
            <input
              type="search"
              value={busca}
              placeholder="buscar en los titulares..."
              style={{ minWidth: 220 }}
              onChange={(e) => filtrar(() => setBusca(e.target.value))}
            />
            <select value={tema} onChange={(e) => filtrar(() => setTema(e.target.value as Tema))}>
              {(['relevantes', 'empresas', 'todas'] as const).map((t) => (
                <option key={t} value={t}>{TEMA_TEXTO[t]}</option>
              ))}
            </select>
          </>
        )}

        {sub === 'metricas' && acciones.length > 0 && (
          <span className="note">
            hoy <span className="pos">{suben} suben</span> · <span className="neg">{bajan} bajan</span>
          </span>
        )}

        <span className="note">
          {data.updatedAt ? `actualizado ${hora(data.updatedAt)}` : 'sin datos todavia'}
          {data.phase && ` · ${FASE_TEXTO[data.phase] ?? data.phase}`}
          {data.nextAt && `, siguiente ${dentroDe(data.nextAt)}`}
        </span>

        <span className={`cuota ${data.alpha.used >= data.alpha.budget ? 'apurada' : ''}`}>
          cuota Alpha Vantage {data.alpha.used}/{data.alpha.budget}
        </span>

        <button className="clear" disabled={pidiendo} onClick={refrescar}>
          {pidiendo ? 'pidiendo...' : 'refrescar ahora'}
        </button>
      </div>

      {ultimo && (
        <div className="note" style={{ marginTop: 0, marginBottom: 10 }}>{ultimo}</div>
      )}

      {sub === 'metricas' && (
        <>
          {/* Precios: materias primas, bonos e indices como tarjetas. Son pocos
              y se consultan de un vistazo, no se comparan en tabla. */}
          {(['materia', 'bono', 'indice'] as const).map((k) => {
            const filas = data.quotes.filter((q) => q.kind === k);
            if (filas.length === 0) return null;
            return (
              <div key={k} style={{ marginBottom: 10 }}>
                <div className="tag-grupo-titulo">{KIND_LABEL[k]}</div>
                <div className="tiles compact">
                  {filas.map((q) => (
                    <div className="tile" key={q.symbol}>
                      <div className="k">{q.label}</div>
                      <div className="v">{num(q.price, 2)}</div>
                      <div className="n">
                        {q.changePct === null
                          ? <span className="note">cierre diario</span>
                          : pct(q.changePct)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {proximos.length > 0 && (
            <div className="news-alert" style={{ marginBottom: 10 }}>
              <b>Presentan resultados en los proximos 14 dias</b>
              <span>
                {proximos.map((e) => `${e.symbol} (${e.date.slice(8)}/${e.date.slice(5, 7)})`).join(' · ')}
              </span>
            </div>
          )}

          {acciones.length === 0 ? (
            <div className="empty">todavia no han llegado cotizaciones</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <tabla.Th k="ticker">Ticker</tabla.Th>
                  <tabla.Th k="empresa" className="izq">Empresa</tabla.Th>
                  <tabla.Th k="peso">Peso QQQ %</tabla.Th>
                  <tabla.Th k="precio">Precio</tabla.Th>
                  <tabla.Th k="dia">1d %</tabla.Th>
                  <tabla.Th k="cinco">5d %</tabla.Th>
                  <th>Prox. resultados</th>
                  <th>Resultados en</th>
                </tr>
              </thead>
              <tbody>
                {tabla.rows.map((q) => {
                  const e = porFecha.get(q.symbol);
                  const inminente = e !== undefined && e.daysTo >= 0 && e.daysTo <= 2;
                  return (
                    <tr key={q.symbol} className={inminente ? 'hi' : ''}>
                      <td><b>{q.symbol}</b></td>
                      <td className="izq">{q.name}</td>
                      <td className="note">{q.weight === null ? '—' : q.weight.toFixed(1)}</td>
                      <td>{num(q.price, 2)}</td>
                      <td>{pct(q.changePct)}</td>
                      <td>{pct(q.changePct5d)}</td>
                      <td className="note">{e ? e.date : '—'}</td>
                      <td className={inminente ? 'neg' : 'note'}>{e ? `${e.daysTo} dias` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {acciones.length > 0 && acciones.every((q) => q.changePct5d === null) && (
            <div className="note" style={{ marginTop: 8 }}>
              La columna <b>5d %</b> sale vacia hasta que el diario lleve cinco jornadas
              abierto: se calcula con nuestros propios cierres guardados, porque las series
              diarias ya no entran en el plan gratuito de ningun proveedor.
            </div>
          )}

          <div className="note" style={{ marginTop: 14 }}>
            <b>QQQ no es el Nasdaq 100.</b> Es el fondo cotizado que lo replica, y vale
            unas cuarenta veces menos que el indice: si el Nasdaq 100 esta en 25.000, el
            QQQ ronda los 700. Lo que si coincide es la <b>variacion del dia</b>, que es
            lo que miras aqui. El valor del indice no lo da gratis ningun proveedor, y
            estimarlo multiplicando seria inventarselo.
          </div>

          {/* ESTADO DE LAS FUENTES.
              Contesta la pregunta que antes solo contestaba la consola: no es
              "fallo el refresco" sino que fuente, cuando trajo algo por
              ultima vez y cuanto trajo. */}
          <h3 style={{ marginTop: 18 }}>Estado de las fuentes</h3>
          <table>
            <thead>
              <tr>
                <th>Fuente</th>
                <th>Ultimo dato</th>
                <th>Filas</th>
                <th className="izq">Ultimo fallo</th>
              </tr>
            </thead>
            <tbody>
              {data.blocks.map((b) => (
                <tr key={b.name} className={b.stale ? 'hi' : ''}>
                  <td><b>{b.name}</b></td>
                  <td className={b.stale ? 'neg' : 'note'}>
                    {b.disabled ? 'apagada' : haceCuanto(b.okAt)}
                  </td>
                  <td className="note">{b.rows ?? '—'}</td>
                  <td className="izq note" title={b.error ?? undefined}>
                    {b.disabled ? 'no entra en el plan gratuito del proveedor'
                      : b.failAt === null ? '—'
                      : `${haceCuanto(b.failAt)}${b.error ? ` · ${b.error.slice(0, 90)}` : ''}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {sub === 'noticias' && (
        noticias.length === 0 ? (
          <div className="empty">
            {consulta !== '' ? `ninguna noticia dice "${busca.trim()}"`
              : tema === 'empresas' ? 'ninguna noticia habla de tus empresas'
              : tema === 'relevantes' ? 'ninguna noticia de mercado en estos dias'
              : 'todavia no han llegado noticias'}
          </div>
        ) : (
          <>
            <div className="paginado">
              <span className="note" style={{ margin: 0 }}>
                {noticias.length}
                {noticias.length === data.news.length
                  ? ` titulares de los ultimos ${data.newsWindowDays} dias`
                  : ` de ${data.news.length} titulares`}
                {paginas > 1 && ` · pagina ${pag} de ${paginas}`}
                {tema !== 'todas' && descartadas > 0 &&
                  ` · ${descartadas} fuera de tema sin enseñar`}
              </span>

              {paginas > 1 && (
                <span className="botones">
                  <button className="clear" disabled={pag <= 1} onClick={() => setPagina(pag - 1)}>
                    anterior
                  </button>
                  <button className="clear" disabled={pag >= paginas} onClick={() => setPagina(pag + 1)}>
                    siguiente
                  </button>
                </span>
              )}
            </div>

            <ul className="noticias">
              {visibles.map((n, i) => {
                // Separador al cambiar de dia. Con tres dias de titulares, sin
                // el no se distingue lo de esta mañana de lo de anteayer.
                const anterior = i > 0 ? visibles[i - 1] : undefined;
                const nuevoDia = anterior === undefined || diaDe(anterior.ts) !== diaDe(n.ts);

                return (
                  <Fragment key={n.id}>
                    {nuevoDia && <li className="dia">{diaDe(n.ts)}</li>}
                    <li>
                      <span className="cuando">{soloHora(n.ts)}</span>
                      {animo(n.sentiment)}
                      {n.symbols && <span className="tag">{n.symbols}</span>}
                      {n.url
                        ? <a href={n.url} target="_blank" rel="noreferrer">{n.headline}</a>
                        : <span>{n.headline}</span>}
                      {n.source && <span className="note"> · {n.source}</span>}
                    </li>
                  </Fragment>
                );
              })}
            </ul>

            {/* La leyenda solo si hay algo que explicar. Con el endpoint de
                sentimiento apagado no se puntua ninguna, y un parrafo sobre
                unos numeros que no estan solo confunde. */}
            {noticias.some((n) => n.sentiment !== null) && (
              <div className="note">
                El numero de la izquierda es el sentimiento, de −1 a +1. Solo lo traen las
                noticias puntuadas; las que llegan sin puntuar no llevan nada, que no es lo
                mismo que neutras.
              </div>
            )}
          </>
        )
      )}
    </>
  );
}
