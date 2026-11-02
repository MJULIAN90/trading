import { Fragment, useEffect, useRef, useState } from 'react';
import { dateTime, faseDeCotizacion, hora as horaDelReloj, num, signClass, zonaCorta, type FaseCotizacion } from '../format';
import { useSort } from '../sortable';
import { ReactionPanel } from './ReactionPanel';

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
  /** Variacion a 1 y 5 jornadas en las unidades de la serie, no en %. */
  change1d: number | null;
  change5d: number | null;
  /** Jornadas de cierre guardadas. Con menos de 6 no hay 5d. */
  dias: number;
  /** Cuando COTIZO, segun el proveedor. null = no lo dice. */
  quoteTs: number | null;
  prevClose: number | null;
  name: string; weight: number | null; changePct5d: number | null;
}
interface Earning {
  symbol: string; name: string; date: string; when: string | null;
  epsEstimate: number | null; epsActual: number | null;
  revenueEstimate: number | null; revenueActual: number | null; daysTo: number;
  /** Instante de CONVENCION del informe, epoch ms. null si no se pudo calcular. */
  at: number | null;
  /** "16:01", hora de Nueva York. */
  hhmm: string | null;
  /** null = convencion. Si no, de cuantos informes sale y con que rango. */
  medido: { hhmm: string; n: number; rango: string } | null;
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

// Pasa por `dateTime` y no por `toLocaleString` para que siga el reloj
// elegido en Ajustes: con `toLocaleString` esta linea se quedaba en hora del
// navegador aunque el resto de la aplicacion estuviera en hora de Nueva York.
const hora = (ms: number) => dateTime(ms).slice(0, 11);

/** Porcentaje con signo. null se pinta como raya, no como cero. */
/**
 * "hoy", "maniana", "en 3 dias", "ayer", "hace 2 dias".
 *
 * Antes salia el numero crudo, y los que ya habian presentado ponian cosas
 * como "-1 dias", que hay que traducir mentalmente cada vez. Un signo menos no
 * es una forma de decir "ya paso".
 */
function cuandoPresenta(dias: number): string {
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'maniana';
  if (dias === -1) return 'ayer';
  return dias > 0 ? `en ${dias} dias` : `hace ${-dias} dias`;
}

/**
 * Como se llama cada tramo en pantalla, y que significa.
 *
 * `desconocida` no es un fallo: las series de petroleo y bonos son DIARIAS y
 * Alpha Vantage no da hora. Decir "cierre diario" es exacto; decir "en vivo"
 * seria mentir sobre un dato que puede ser de ayer.
 */
const FASE_LABEL: Record<FaseCotizacion, string> = {
  regular: 'sesion regular',
  pre: 'pre-mercado',
  post: 'after',
  nocturno: 'fuera de horario',
  finde: 'cierre del viernes',
  desconocida: 'cierre diario',
};

const FASE_AYUDA: Record<FaseCotizacion, string> = {
  regular: 'Precio operado durante la sesion de 09:30 a 16:00 de Nueva York.',
  pre: 'Precio operado en el pre-mercado, entre las 04:00 y las 09:30 de Nueva York.',
  post: 'Precio operado en el after, entre las 16:00 y las 20:00 de Nueva York.',
  nocturno: 'Precio de fuera de horario: la ultima operacion antes de las 04:00 o despues de las 20:00 de Nueva York.',
  finde: 'El mercado de contado lleva cerrado desde el viernes. Este es el ultimo precio de esa sesion.',
  desconocida: 'Serie diaria: el proveedor da el valor del dia, no una hora. Puede ser el de ayer.',
};

/** "despues del cierre" / "antes de abrir", que es lo unico que da el proveedor. */
function franja(when: string | null): string {
  return (when ?? '').toLowerCase().includes('bmo') ? 'antes de abrir' : 'despues del cierre';
}

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
  const [sub, setSub] = useState<'metricas' | 'noticias' | 'reaccion'>('metricas');
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

  // El telon de fondo, en el orden en que se lee: primero el crudo, luego la
  // curva de tipos de menor a mayor plazo. Alfabeticamente saldria US10Y antes
  // que US5Y y la curva no se entenderia.
  const ORDEN_FONDO = ['WTI', 'BRENT', 'US5Y', 'US10Y', 'US30Y'];
  const fondo = (data?.quotes ?? [])
    .filter((q) => q.kind === 'materia' || q.kind === 'bono')
    .sort((a, b) => ORDEN_FONDO.indexOf(a.symbol) - ORDEN_FONDO.indexOf(b.symbol));

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

  /**
   * Las tarjetas de precios de un grupo.
   *
   * Es una funcion y no un bloque suelto porque ahora se pinta DOS VECES: el
   * indice arriba, pegado a la tabla de acciones a la que acompaña, y el
   * petroleo y los bonos ABAJO. No es orden alfabetico: el QQQ es el mismo
   * mercado que operas y las diez empresas que lo mueven; el petroleo y los
   * bonos son telon de fondo, se miran una vez al dia y no tienen por que
   * empujar la tabla hacia abajo cada vez que abres la pestaña.
   */
  const tarjetas = (kinds: readonly QuoteKind[]) =>
    kinds.map((k) => {
      const filas = data.quotes.filter((q) => q.kind === k);
      if (filas.length === 0) return null;
      return (
        <div key={k} style={{ marginBottom: 10 }}>
          <div className="tag-grupo-titulo">{KIND_LABEL[k]}</div>
          <div className="tiles compact">
            {filas.map((q) => {
              const f = faseDeCotizacion(q.quoteTs);
              return (
                // El tramo va en el `title` y no escrito en la baldosa: son
                // fichas pequeñas y una tercera linea las rompe. En la tabla
                // de acciones, que tiene sitio, si va escrito.
                <div
                  className="tile"
                  key={q.symbol}
                  title={
                    FASE_AYUDA[f] +
                    (q.quoteTs === null ? '' : ` Cotizo a las ${horaDelReloj(q.quoteTs)} ${zonaCorta()}.`)
                  }
                >
                  <div className="k">{q.label}</div>
                  <div className="v">{num(q.price, 2)}</div>
                  <div className="n">
                    {q.changePct === null
                      ? <span className="note">{FASE_LABEL[f]}</span>
                      : pct(q.changePct)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    });

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
        {/* "Reaccion" y no "Interpretaciones": ver la cabecera de
            `ReactionPanel.tsx`. El nombre es parte de lo que promete. */}
        <button className={sub === 'reaccion' ? 'on' : ''} onClick={() => setSub('reaccion')}>
          Reaccion
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
          {tarjetas(['indice'])}

          {/* El aviso de "presentan en los proximos dias" se fue a la barra de
              arriba, donde se ve desde cualquier pestaña y donde puede sonar
              la alarma. Aqui se quedan los proximos mas lejanos, en su columna
              de la tabla: ahi son contexto, no un aviso. */}
          {proximos.length > 0 && (
            <div className="note" style={{ marginBottom: 10 }}>
              Presentan en los proximos 14 dias:{' '}
              {proximos.map((e) => `${e.symbol} (${e.date.slice(8)}/${e.date.slice(5, 7)})`).join(' · ')}
              . Los de tres dias o menos salen arriba, en la barra, con hora y alarma.
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
                  <tabla.Th
                    k="precio"
                    title="El ultimo precio que dio el proveedor, con la hora a la que se opero y en que tramo de la sesion cayo. No es necesariamente de ahora mismo."
                  >
                    Precio
                  </tabla.Th>
                  <tabla.Th
                    k="dia"
                    title="Cuanto se ha movido HOY respecto al cierre de ayer. Es la reaccion del dia."
                  >
                    1d %
                  </tabla.Th>
                  <tabla.Th
                    k="cinco"
                    title="Cuanto se ha movido en las ultimas CINCO jornadas. Es la tendencia de la semana, calculada con nuestros propios cierres guardados."
                  >
                    5d %
                  </tabla.Th>
                  <th title="Fecha y hora de convencion del proximo informe de resultados">
                    Prox. resultados
                  </th>
                  <th>Cuando</th>
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
                      {/* El precio, y DEBAJO de donde sale. Un numero suelto
                          no distingue "operado hace un minuto" de "el cierre
                          de ayer", y a las siete de la mañana eso es
                          exactamente lo que estas mirando. */}
                      <td className="precio-celda">
                        {num(q.price, 2)}
                        {(() => {
                          const f = faseDeCotizacion(q.quoteTs);
                          return (
                            <span className={`cotiz ${f}`} title={FASE_AYUDA[f]}>
                              {FASE_LABEL[f]}
                              {q.quoteTs !== null && ` · ${horaDelReloj(q.quoteTs)} ${zonaCorta()}`}
                            </span>
                          );
                        })()}
                      </td>
                      <td>{pct(q.changePct)}</td>
                      <td>{pct(q.changePct5d)}</td>
                      <td className="note">
                        {e ? (
                          <>
                            {e.date}
                            {e.at !== null && (
                              // Subrayado de puntos, como todo lo que lleva
                              // explicacion detras: la hora no la publica la
                              // empresa, la ponemos nosotros.
                              <u
                                className="hora-convencion"
                                title={
                                  e.medido
                                    ? `${franja(e.when)} · ${e.hhmm} en Nueva York · mediana de ${e.medido.n} informes reales (rango ${e.medido.rango}), medida sobre los 8-K de la SEC`
                                    : `${franja(e.when)} · ${e.hhmm} en Nueva York · hora de convencion: no hay medicion de esta empresa. Se cambia en Ajustes → Avisos.`
                                }
                              >
                                {horaDelReloj(e.at)} {zonaCorta()}
                              </u>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={inminente ? 'neg' : 'note'}>
                        {e ? cuandoPresenta(e.daysTo) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="note" style={{ marginTop: 10 }}>
            <b>Debajo de cada precio sale de cuando es.</b> No es lo mismo un precio operado
            hace un minuto que el cierre de ayer, y a las siete de la mañana es justo lo que
            estas mirando. La hora la da el proveedor con el propio precio, no la ponemos
            nosotros.
            <br />
            <b>Si a esa hora nunca ves &quot;pre-mercado&quot; ni &quot;after&quot;</b>, es que
            tu plan de Finnhub no los trae: el precio se queda clavado en el cierre hasta que
            abre la sesion regular. No hace falta creerse la documentacion de nadie, se ve en
            la tabla. El petroleo y los bonos ponen siempre <b>cierre diario</b> porque esas
            series son diarias y Alpha Vantage no da hora.
            <br />
            <b>Cada cuanto se pide</b>: 5 minutos con el mercado abierto, 15 en pre-mercado y
            after (04:00–09:30 y 16:00–20:00 de Nueva York) y 60 de noche y en fin de semana.
            Se ajusta solo; los tres intervalos estan en el <code>.env</code>. El boton
            &quot;refrescar ahora&quot; de arriba pide todo sin esperar al ciclo.
          </div>

          <div className="note" style={{ marginTop: 10 }}>
            <b>1d %</b> es lo que se ha movido hoy respecto al cierre de ayer: la reaccion
            del dia. <b>5d %</b> es lo mismo pero contra el cierre de hace cinco jornadas:
            la tendencia de la semana.{' '}
            <b>Juntas dicen si hoy continua o corrige.</b> Un -1 % con el 5d en -12 % es la
            quinta sesion seguida cayendo; el mismo -1 % con el 5d en +7 % es una pausa.
            <br />
            Sirven por el <b>peso en el QQQ</b> de la columna de al lado: operas el Nasdaq
            100, no acciones sueltas. Que NVDA pese 8,3 % y caiga un 4 % empuja el indice
            casi tres veces mas que la misma caida en TSLA, que pesa 2,8 %. Y un 5d muy
            negativo justo antes de que esa empresa presente resultados es posicionamiento,
            no noticia: el mercado ya ha apostado.
          </div>

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

          {/* El telon de fondo, al final. Ni el petroleo ni los bonos se
              operan aqui: explican el dia, no lo deciden, asi que no tienen
              por que ser lo primero que ves al abrir la pestaña. */}
          <h3 style={{ marginTop: 18 }}>Telon de fondo</h3>
          <div className="note" style={{ marginBottom: 8 }}>
            Ni el petroleo ni los bonos se operan aqui. Estan porque mueven al Nasdaq por
            detras: <b>un 10 anios subiendo le quita aire a las tecnologicas</b> —descuenta mas
            los beneficios futuros, que es de lo que viven— y el crudo marca por donde va la
            inflacion que luego decide los tipos. La curva entera (5, 10 y 30 anios) dice ademas
            si el mercado espera recorte o subida: cuando el 5 sube mas rapido que el 30, el
            susto es de tipos a corto.
          </div>

          <table>
            <thead>
              <tr>
                <th>Serie</th>
                <th className="izq">Que es</th>
                <th title="El ultimo valor publicado de la serie. Son series DIARIAS: puede ser el de ayer.">
                  Ultimo
                </th>
                <th title="Variacion contra el cierre anterior que tenemos guardado.">1d</th>
                <th title="Variacion contra el cierre de hace cinco jornadas.">5d</th>
                <th title="Jornadas de cierre guardadas. Con menos de 6 la columna 5d no se puede calcular.">
                  Historico
                </th>
              </tr>
            </thead>
            <tbody>
              {fondo.map((q) => {
                // UN BONO NO SE LEE EN PORCENTAJE. El 10 anios de 4,98 a 5,05
                // son "+7 puntos basicos", que es como lo dice todo el mundo;
                // el +1,4% que saldria de dividir es un porcentaje DE un
                // porcentaje y no significa nada. El petroleo si va en %.
                const esBono = q.kind === 'bono';
                const var1 = esBono
                  ? q.change1d === null ? null : `${q.change1d > 0 ? '+' : ''}${Math.round(q.change1d * 100)} pb`
                  : q.change1d === null || q.price === q.change1d ? null
                    : `${q.change1d > 0 ? '+' : ''}${num((q.change1d / (q.price - q.change1d)) * 100, 2)}%`;
                const var5 = esBono
                  ? q.change5d === null ? null : `${q.change5d > 0 ? '+' : ''}${Math.round(q.change5d * 100)} pb`
                  : q.changePct5d === null ? null : `${q.changePct5d > 0 ? '+' : ''}${num(q.changePct5d, 2)}%`;

                return (
                  <tr key={q.symbol}>
                    <td><b>{q.symbol}</b></td>
                    <td className="izq">{q.label}</td>
                    <td>
                      {num(q.price, 2)}
                      {esBono && <span className="note"> %</span>}
                    </td>
                    {/* EN LOS BONOS NO SE PINTA EL SIGNO. Verde y rojo aqui
                        quieren decir "bueno" y "malo", y en un bono es al
                        reves de lo que parece: un 10 anios SUBIENDO es un
                        problema para el Nasdaq, justo lo que dice el parrafo
                        de arriba. Pintarlo verde seria contradecirlo en la
                        misma pantalla. El petroleo si lleva color, que ahi
                        subir es subir. */}
                    <td className={esBono ? '' : signClass(q.change1d ?? 0)}>
                      {var1 ?? <span className="note">—</span>}
                    </td>
                    <td className={esBono ? '' : signClass(q.changePct5d ?? 0)}>
                      {var5 ?? <span className="note">—</span>}
                    </td>
                    <td className="note">
                      {q.dias} jornada{q.dias === 1 ? '' : 's'}
                      {q.dias < 6 && <span className="note"> · faltan {6 - q.dias} para el 5d</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="note" style={{ marginTop: 8 }}>
            <b>Los bonos van en puntos basicos, no en porcentaje.</b> Un 10 anios que pasa de
            4,98 a 5,05 ha subido <b>7 pb</b>; decir &quot;+1,4 %&quot; seria un porcentaje de un
            porcentaje y no lo usa nadie. El petroleo si va en porcentaje, que es como se mira.
            <br />
            Los bonos van <b>sin color</b> a proposito: en un bono subir no es bueno. Un 10 anios
            al alza es viento en contra del Nasdaq, asi que el verde diria lo contrario de lo que
            dice el parrafo de arriba. El petroleo si lleva color.
            <br />
            Las dos variaciones se calculan con <b>nuestros propios cierres guardados</b>, no las
            da el proveedor: Alpha Vantage manda la serie diaria sin variacion. Por eso la
            columna de historico — hasta la sexta jornada el 5d no existe, y sale rayado en vez
            de inventado.
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

      {sub === 'reaccion' && <ReactionPanel />}
    </>
  );
}
