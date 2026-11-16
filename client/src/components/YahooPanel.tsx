import { useEffect, useRef, useState } from 'react';
import { api, type FilaYahoo, type ParteYahoo, type VistaYahoo } from '../api';
import { signClass } from '../format';
import { useSort } from '../sortable';

/**
 * Yahoo Finance, enfrentado a lo que el diario ya tenia.
 *
 * NO es un panel de cotizaciones -- eso ya esta en News. Esto contesta una
 * pregunta que antes no se podia contestar: de las dos fuentes que tiene el
 * diario, ¿cual va mejor servida en cada serie?
 *
 * Y para contestarla hacen falta tres columnas, no una:
 *
 *   el precio ....... lo que dice cada una
 *   la diferencia ... cuanto se separan
 *   la EDAD ......... de cuando es cada numero
 *
 * La edad es la que suele decidir y es la que nadie mira. El barril del diario
 * viene de Alpha Vantage una vez al dia, porque su plan gratuito son 25
 * peticiones diarias para todo. Para alguien que opera intradia, un numero
 * exacto de hace nueve horas vale menos que uno aproximado de hace cinco
 * minutos, y esta tabla lo ensena de un vistazo.
 */

/**
 * Los mismos grupos y los mismos nombres que News.
 *
 * No un vocabulario nuevo: dos pantallas del mismo diario que llamen "materias
 * primas" y "commodities" a lo mismo obligan a traducir mentalmente cada vez.
 * El orden tambien es el de alla.
 */
const GRUPOS = [
  { id: 'materia', titulo: 'Materias primas' },
  { id: 'bono', titulo: 'Bonos EE.UU.' },
  { id: 'indice', titulo: 'Indices' },
  { id: 'accion', titulo: 'Acciones' },
] as const;

/** Una celda de precio. `null` se escribe, no se deja en blanco. */
function Precio({ v }: { v: number | null }) {
  if (v === null) return <span className="note">—</span>;
  return <>{v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>;
}

/** El cambio del dia. ESTE si lleva color: subir es verde y bajar es rojo. */
function Cambio({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="note">—</span>;
  return <span className={signClass(pct)}>{pct > 0 ? '+' : ''}{pct.toFixed(2)}%</span>;
}

/**
 * La EDAD del dato, y el unico sitio del diario donde mas pequeno es mejor.
 *
 * Se colorea por tramos y NO por signo: aqui no hay signo. Nueve horas en rojo
 * no significa "ha bajado", significa "este numero es de ayer".
 */
function Edad({ min }: { min: number | null }) {
  if (min === null) return <span className="note">—</span>;

  const clase = min <= 15 ? 'pos' : min <= 120 ? '' : 'neg';
  const texto = min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`;

  return <span className={clase} title={`${min} minutos`}>{texto}</span>;
}

/**
 * La diferencia entre las dos fuentes.
 *
 * SIN verde ni rojo, y es deliberado. La convencion del diario es verde arriba
 * y rojo abajo porque el signo dice si algo es bueno o malo; aqui el signo solo
 * dice cual de las dos va por delante, y ninguna de las dos es "lo bueno". Es
 * la misma excepcion que los bonos y las cuentas atras.
 *
 * Lo que si se marca es cuando pasa del 1 %: ahi una de las dos esta
 * equivocada o una va con retraso, y hay que mirarlo con la edad al lado.
 */
function Diferencia({ pct, proxy }: { pct: number | null; proxy: boolean }) {
  if (proxy) {
    return (
      <span
        className="note"
        title="Un ETF y el futuro del mismo subyacente cotizan a niveles distintos por construccion. Compararlos como precision seria mentir."
      >
        no comparable
      </span>
    );
  }

  if (pct === null) return <span className="note">—</span>;

  const gordo = Math.abs(pct) > 1;
  return (
    <b style={gordo ? { color: 'var(--warn)' } : undefined}>
      {pct > 0 ? '+' : ''}{pct.toFixed(2)}%
    </b>
  );
}

/**
 * El peso dentro del QQQ.
 *
 * SIN verde ni rojo: pesar mucho no es bueno ni malo, es cuanto mueve esa
 * empresa el indice. Misma excepcion que los bonos, las cuentas atras y la
 * columna de diferencia.
 *
 * Se pinta en gris claro y no en blanco a proposito. Todo lo demas de esta fila
 * viene de un proveedor y tiene sello horario; esto es una cifra copiada a mano
 * que envejece sola. Que no se lea con el mismo peso visual que un precio.
 */
function Peso({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="note">—</span>;
  return <span className="note" style={{ fontVariantNumeric: 'tabular-nums' }}>{pct.toFixed(1)}%</span>;
}

/**
 * Un grupo, con su tabla ordenable.
 *
 * Componente aparte y no un bucle dentro del panel porque cada grupo necesita
 * su propio `useSort`, y un hook no puede vivir dentro de un bucle. Asi cada
 * tabla recuerda su orden por separado, que ademas es lo que se quiere: ordenar
 * los bonos por edad no tiene por que descolocar las acciones.
 */
function Grupo({ titulo, filas, pesosFecha }: { titulo: string; filas: FilaYahoo[]; pesosFecha: string | null }) {
  const t = useSort<FilaYahoo>(filas, {
    simbolo: (r) => r.symbol,
    peso: (r) => r.peso,
    yahoo: (r) => r.yahoo?.price ?? null,
    dia: (r) => r.yahoo?.cambioPct ?? null,
    edad: (r) => r.yahoo?.edadMin ?? null,
    diario: (r) => r.propio?.symbol ?? null,
    precio: (r) => r.propio?.price ?? null,
    edadDiario: (r) => r.propio?.edadMin ?? null,
    // Por VALOR ABSOLUTO: lo que interesa de una discrepancia es su tamano, no
    // hacia que lado cae. Ordenando por el valor con signo, un -5 % quedaria
    // entre los mas pequenos y es justo el que hay que mirar.
    diferencia: (r) => (r.difPct === null ? null : Math.abs(r.difPct)),
  });

  if (filas.length === 0) return null;

  // La columna de peso sale sola en el grupo que tenga pesos apuntados, en vez
  // de estar atada a "acciones": si manana se apunta el peso de otra cosa,
  // aparece sin tocar esto. Y si no hay ninguno, no se pinta una columna de
  // guiones.
  const conPeso = filas.some((f) => f.peso !== null);

  return (
    <div style={{ marginBottom: 22 }}>
      <div className="tag-grupo-titulo">{titulo}</div>

      {conPeso && (
        <div className="note" style={{ fontSize: 11, marginBottom: 4 }}>
          El <b>peso</b> es cuanto mueve cada una el Nasdaq 100.{' '}
          {pesosFecha
            ? `Foto copiada a mano de ${pesosFecha}, no un dato del proveedor: los pesos se mueven decimas al mes, asi que sirve para ordenar y no para citar.`
            : 'Puesta a mano en el .env sin decir de cuando es, asi que no se sabe si esta al dia.'}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <t.Th k="simbolo" className="izq">simbolo</t.Th>
            {conPeso && (
              <t.Th k="peso" title="Peso en el Nasdaq 100. Cifra copiada a mano, no medida.">peso</t.Th>
            )}
            <t.Th k="yahoo">yahoo</t.Th>
            <t.Th k="dia">dia</t.Th>
            <t.Th k="edad" title="Minutos desde que se formo el dato en el mercado. Mas pequeno es mejor.">edad</t.Th>
            <t.Th k="diario">en el diario</t.Th>
            <t.Th k="precio">precio</t.Th>
            <t.Th k="edadDiario" title="Lo mismo, para la fuente que ya usaba el diario.">edad</t.Th>
            <t.Th k="diferencia" title="Ordena por tamano de la discrepancia, no por su signo.">diferencia</t.Th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((f) => (
            <tr key={f.symbol}>
              <td className="izq">
                <b>{f.symbol}</b>
                <div className="note">{f.que}</div>
              </td>
              {conPeso && <td><Peso pct={f.peso} /></td>}
              <td><Precio v={f.yahoo?.price ?? null} /></td>
              <td><Cambio pct={f.yahoo?.cambioPct ?? null} /></td>
              <td><Edad min={f.yahoo?.edadMin ?? null} /></td>
              <td className="note">{f.propio?.symbol ?? '—'}</td>
              <td><Precio v={f.propio?.price ?? null} /></td>
              <td><Edad min={f.propio?.edadMin ?? null} /></td>
              <td><Diferencia pct={f.difPct} proxy={f.proxy} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function YahooPanel() {
  const [vista, setVista] = useState<VistaYahoo | null>(null);
  const [parte, setParte] = useState<ParteYahoo | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Para que el pedido automatico salga UNA vez por visita y no se repita en
  // bucle si Yahoo esta caido: sin esto, un fallo deja los datos viejos, la
  // condicion sigue cumpliendose y se pide otra vez en cada render.
  const yaPedido = useRef(false);

  async function refrescar() {
    setCargando(true);
    setError(null);
    try {
      const p = await api.refrescarYahoo();
      setParte(p);
      setVista(p.vista);
    } catch {
      setError('fallo al pedir a Yahoo');
    } finally {
      setCargando(false);
    }
  }

  /**
   * Al abrir la pestana, pide a Yahoo si hace falta.
   *
   * ESTO FALTABA. `YAHOO_REFRESH_MIN` existia y la pantalla anunciaba "refresco
   * cada 15 min", pero `traerYahoo()` solo se llamaba desde el boton: nada se
   * refrescaba solo. El cartel decia una cosa y el programa hacia otra, que es
   * peor que no tener refresco, porque se confia en el.
   *
   * Se pide al ABRIR y no con un reloj en el servidor a proposito. Un reloj
   * dispararia veintidos peticiones cada cuarto de hora a un endpoint gratuito
   * y no oficial aunque nadie este mirando la pestana. Asi lo que se ve nunca
   * tiene mas de `refrescoMin` de antiguedad y no se gasta nada cuando no hay
   * nadie delante.
   *
   * La segunda condicion -- que falte alguna -- es la que cubre el caso de
   * anadir simbolos: los nuevos no se han pedido NUNCA, asi que salen con
   * guiones aunque lo guardado sea de hace dos minutos y el reloj diga que
   * todo esta al dia.
   */
  useEffect(() => {
    api.yahoo()
      .then((v) => {
        setVista(v);

        if (yaPedido.current || v.refrescoMin <= 0) return;

        const caducado = v.ultimo === null || Date.now() - v.ultimo > v.refrescoMin * 60_000;
        const faltaAlguna = v.filas.some((f) => f.yahoo === null);

        if (caducado || faltaAlguna) {
          yaPedido.current = true;
          void refrescar();
        }
      })
      .catch(() => setError('no se pudo leer lo guardado'));
    // Solo al montar: abrir la pestana es la visita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!vista) {
    return <div className="panel"><div className="note">{error ?? 'cargando...'}</div></div>;
  }

  const sinDatos = vista.filas.every((f) => f.yahoo === null);

  return (
    <div className="panel">
      <h2>Yahoo Finance</h2>

      <div className="note" style={{ marginBottom: 10, lineHeight: 1.55 }}>
        Segunda fuente, nunca la unica. Lo que llega se guarda <b>aparte</b> y no toca lo que ya
        tiene el diario: las dos se enfrentan aqui, no se mezclan ni se promedian. Es el mismo
        criterio que el PnL del broker guardado junto al calculado desde los precios.
        <br />
        <b>Mira la edad antes que el precio.</b> El barril del diario viene de Alpha Vantage una vez
        al dia, porque su plan gratuito son 25 peticiones diarias para todo. Un numero exacto de
        hace nueve horas vale menos que uno aproximado de hace cinco minutos.
        <br />
        Las cabeceras ordenan: pulsa una vez para mayor a menor, otra para invertir. Cada grupo
        recuerda su orden por separado.
      </div>

      <div className="filters" style={{ marginBottom: 10 }}>
        <button onClick={refrescar} disabled={cargando}>
          {cargando ? 'pidiendo...' : 'Actualizar desde Yahoo'}
        </button>
        <span className="note">
          {vista.ultimo
            ? `ultima vez: ${new Date(vista.ultimo).toLocaleString('es')}`
            : 'todavia no se ha pedido nada'}
          {vista.refrescoMin > 0
            ? ` · al abrir la pestana se pide solo si lo guardado pasa de ${vista.refrescoMin} min, o si falta alguna`
            : ' · refresco automatico apagado'}
        </span>
      </div>

      {sinDatos && (
        <div className="note" style={{ marginBottom: 10 }}>
          No hay nada guardado aun. Pulsa <b>Actualizar desde Yahoo</b>. Si falla, mira los avisos
          de abajo: estos endpoints no son oficiales y se rompen de vez en cuando.
        </div>
      )}

      {vista.discrepan > 0 && (
        <div className="note" style={{ marginBottom: 14, lineHeight: 1.5 }}>
          <b style={{ color: 'var(--warn)' }}>
            {vista.discrepan} serie{vista.discrepan === 1 ? '' : 's'} se separa
            {vista.discrepan === 1 ? '' : 'n'} mas de un 1 %.
          </b>{' '}
          Antes de culpar a nadie, mira la columna de edad: dos numeros de momentos distintos
          tienen que ser distintos.
        </div>
      )}

      {/*
        Una fila SIN lado Yahoo no es lo mismo que una fila con un precio raro,
        y con guiones las dos se ven igual. Si no se dice, se lee como que esa
        serie no existe; lo que pasa es que la peticion fallo. El motivo solo
        esta en el parte del ultimo refresco, asi que la pantalla dice donde
        mirar en vez de callarse.
      */}
      {!sinDatos && vista.filas.some((f) => f.yahoo === null) && (
        <div className="note" style={{ marginBottom: 14, lineHeight: 1.5 }}>
          <b>Sin dato de Yahoo:</b>{' '}
          {vista.filas.filter((f) => f.yahoo === null).map((f) => f.symbol).join(', ')}. No es que no
          existan: o no se han pedido nunca — pasa con las que se acaban de anadir a la lista — o la
          peticion fallo. Si sigue ahi despues de <b>Actualizar desde Yahoo</b>, el parte de abajo dice
          el motivo de cada una.
        </div>
      )}

      {GRUPOS.map((g) => (
        <Grupo
          key={g.id}
          titulo={g.titulo}
          filas={vista.filas.filter((f) => f.grupo === g.id)}
          pesosFecha={vista.pesosFecha}
        />
      ))}

      {parte && (
        <div className="note" style={{ marginTop: 10, lineHeight: 1.6 }}>
          {parte.guardados} de {parte.pedidos} en {(parte.ms / 1000).toFixed(1)} s.
          {parte.fallos.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {parte.fallos.map((f) => (
                <div key={f.symbol}>{f.symbol}: {f.error}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div className="note" style={{ marginTop: 8 }}>{error}</div>}

      <div className="note" style={{ marginTop: 16, lineHeight: 1.55 }}>
        <b>Lo que hay que saber de esta fuente.</b> Yahoo no tiene API publica oficial: esto llama
        a un endpoint que ellos usan para su propia web y que no documentan ni se comprometen a
        mantener. Se rompe cada cierto tiempo — al de cotizaciones v7 le paso en 2023, cuando le
        pusieron cookie y token. No es un riesgo hipotetico, es mantenimiento. Por eso entra como
        fuente anadida y el diario sigue funcionando entero sin ella.
        <br />
        <b>Donde mas aporta:</b> el crudo. El diario mira <b>USO</b> y <b>BNO</b>, que son ETF — un
        proxy — mientras <b>CL=F</b> y <b>BZ=F</b> son el futuro de verdad. Esas dos filas salen
        como «no comparable» a proposito: son instrumentos distintos y tienen que dar numeros
        distintos. Lo que hay que mirar ahi no es la diferencia, es que por fin tienes el barril.
        <br />
        <b>Un 0,00 % con el mercado cerrado no es sospechoso, es lo correcto:</b> las dos fuentes
        estan dando el mismo cierre oficial. Lo que habria que mirar es un 0,00 % con el mercado
        abierto y las dos edades en minutos.
        <br />
        <b>Las acciones son las mismas que mira el resto del diario</b> (<code>MARKET_TICKERS</code>),
        no una lista aparte: cambiar esa en el .env mueve esta pestana y News a la vez, y por eso
        todas tienen con que compararse.
        <br />
        <b>«Mas fuerte» son dos cosas distintas y aqui estan separadas.</b> La columna <b>peso</b>
        ordena por cuanto <i>mueve</i> cada una el indice, que es estructural y cambia despacio;
        la columna <b>dia</b> ordena por como va <i>hoy</i>. Lo util suele ser cruzarlas: un -8 %
        en la que pesa 8 es el indice entero, y un -8 % en la que pesa 0,5 es ruido.
      </div>
    </div>
  );
}
