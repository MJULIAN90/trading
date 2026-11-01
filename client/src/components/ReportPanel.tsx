import { useEffect, useState } from 'react';
import { num, pct, sessionLabel, signClass, signedUsd, ticks, usd } from '../format';
import { DayCalendar } from './DayCalendar';

/**
 * El informe periodico: las preguntas que se contestan solas.
 *
 * La lista esta en `claude/preguntas-del-informe.md` y el calculo en
 * `src/domain/report.ts`. Aqui solo se pinta, pero el orden de los bloques si
 * es una decision: va de lo que se puede usar manana a lo que solo se puede
 * mirar.
 *
 * LO QUE ESTE PANEL NO HACE, Y ES A PROPOSITO: no dice si algo "esta
 * funcionando". Con una jornada o una semana no se puede contestar eso, y
 * contestarlo igual es como se construye una supersticion. Las hipotesis se
 * miden una vez al mes, a mano, con su control y su correccion por
 * comparaciones multiples.
 */

type Periodo = 'diario' | 'semanal';

interface Bloque {
  key: string;
  label: string;
  operations: number;
  contracts: number;
  gross: number;
  net: number;
  perTrade: number;
  ticksPerTrade: number;
  wins: number;
  winRate: number;
  median: number;
}

interface Destacada {
  id: number;
  date: string;
  session: string;
  lots: number;
  ticks: number;
  net: number;
  netPerContract: number;
}

interface DiaCalendario {
  date: string;
  count: number;
  pnl: number;
}

interface Informe {
  periodo: Periodo;
  days: string[];
  from: string;
  to: string;
  expectedDays: number;
  prev: string | null;
  next: string | null;
  isLatest: boolean;
  calendar: DiaCalendario[];
  operations: number;
  contracts: number;
  gross: number;
  commission: number;
  net: number;
  winRate: number;
  dailyLossLimit: number;
  remaining: number | null;
  maxLot: number;
  medianLot: number;
  byLot: Bloque[];
  bigLots: Bloque;
  smallLots: Bloque;
  ticksPerTrade: number;
  ticksMedian: number;
  previous: { from: string; to: string; days: number; net: number; ticksPerTrade: number } | null;
  bySession: Bloque[];
  byGap: Bloque[];
  worst: Destacada[];
  best: Destacada[];
  drawdown: {
    rows: Array<{
      session: string;
      days: number;
      trades: number;
      drawdownMedian: number;
      drawdownWorst: number;
      worstStreak: number;
      greenDays: number;
    }>;
  };
  breakeven: number | null;
  payoff: number | null;
  sinAlineacion: { operations: number; net: number; perTrade: number } | null;
  revenge: { operations: number; net: number; perTrade: number };
}

const dm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;

/** Las columnas que comparten todas las tablas de bloques. */
function FilasBloque({
  rows,
  etiqueta,
  nombre = (b) => b.label,
}: {
  rows: Bloque[];
  etiqueta: string;
  /** Como se pinta la primera columna. Las franjas llegan con su clave
   *  interna -NY_AM, OUTSIDE- y hay que traducirla; los huecos y los lotajes
   *  ya vienen con nombre hecho desde el dominio. */
  nombre?: (b: Bloque) => string;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th className="izq">{etiqueta}</th>
          <th>Ops</th>
          <th>Contratos</th>
          <th>Neto</th>
          <th title="Neto por operacion.">$/op</th>
          <th title="Mediana del neto por operacion. Cuando no acompania a la media, manda ella.">
            Mediana
          </th>
          <th title="Ticks por contrato y operacion: la cifra limpia de tamanio.">tk/op</th>
          <th>Acierto</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.key} className={b.operations < 10 ? 'apagada' : ''}>
            <td className="izq">
              <b>{nombre(b)}</b>
            </td>
            <td>{b.operations}</td>
            <td>{b.contracts}</td>
            <td className={signClass(b.net)}>{signedUsd(b.net, 0)}</td>
            <td className={signClass(b.perTrade)}>{signedUsd(b.perTrade)}</td>
            <td className={signClass(b.median)}>{signedUsd(b.median)}</td>
            <td className={signClass(b.ticksPerTrade)}>{ticks(b.ticksPerTrade)}</td>
            <td>{pct(b.winRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Destacadas({ rows, titulo }: { rows: Destacada[]; titulo: string }) {
  return (
    <>
      <h3 style={{ marginTop: 14 }}>{titulo}</h3>
      <table>
        <thead>
          <tr>
            <th className="izq">Jornada</th>
            <th className="izq">Franja</th>
            <th>Lotes</th>
            <th title="Ticks por contrato. Dice si respetaste el stop, aparte del tamanio.">
              tk/contrato
            </th>
            <th>Neto</th>
            <th title="Lo que habria costado o dado con UN contrato.">Con 1 contrato</th>
            <th title="Cuantas veces multiplico el tamanio esa operacion.">Factor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td className="izq">{dm(o.date)}</td>
              <td className="izq">{sessionLabel(o.session)}</td>
              <td className={o.lots > 4 ? 'neg' : ''}>
                <b>{o.lots}</b>
              </td>
              <td className={signClass(o.ticks)}>{ticks(o.ticks)}</td>
              <td className={signClass(o.net)}>{signedUsd(o.net, 0)}</td>
              <td className={signClass(o.netPerContract)}>{signedUsd(o.netPerContract)}</td>
              <td className={o.lots > 4 ? 'neg' : 'note'}>×{o.lots}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * El fin de semana se abre en SEMANAL.
 *
 * El sabado y el domingo no hay jornada que mirar, y lo que uno quiere ver
 * entonces es la semana que acaba de cerrar. El resto de dias abre en diario,
 * que es lo que se mira al terminar de operar. Es solo el valor inicial: el
 * selector manda en cuanto se toca.
 */
function periodoInicial(): Periodo {
  const d = new Date().getDay();
  return d === 0 || d === 6 ? 'semanal' : 'diario';
}

export function ReportPanel({ query }: { query: string }) {
  const [periodo, setPeriodo] = useState<Periodo>(periodoInicial);
  /** La jornada que se esta mirando. null = la mas reciente que haya. */
  const [ancla, setAncla] = useState<string | null>(null);
  const [verCalendario, setVerCalendario] = useState(false);
  const [data, setData] = useState<Informe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setData(null);
    setError(null);

    // El interrogante va aqui, como en el resto de paneles: `qs()` devuelve la
    // cadena sin el, y sin filtros queda vacia.
    fetch(`/api/report?periodo=${periodo}${ancla ? `&ancla=${ancla}` : ''}&${query}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`el servidor contesto ${r.status}`);
        const d = (await r.json()) as Informe;
        if (!Array.isArray(d.bySession) || !Array.isArray(d.byLot))
          throw new Error('la respuesta no tiene la forma esperada');
        return d;
      })
      .then((d) => { if (vivo) setData(d); })
      .catch((e: Error) => { if (vivo) setError(e.message); });

    return () => { vivo = false; };
  }, [periodo, ancla, query]);

  /**
   * La barra de navegacion.
   *
   * Se arma fuera del `if (!data)` porque tiene que seguir en pantalla
   * mientras se recalcula: si desapareciera al pulsar la flecha, cada salto
   * movería el resto de la pagina hacia arriba y hacia abajo.
   */
  const barra = (
    <div className="informe-barra">
      <div className="tf-switch">
        {(['diario', 'semanal'] as const).map((p) => (
          <button key={p} className={periodo === p ? 'on' : ''} onClick={() => setPeriodo(p)}>
            {p === 'diario' ? 'Diario' : 'Semanal'}
          </button>
        ))}
      </div>

      <button
        disabled={!data?.prev}
        onClick={() => data?.prev && setAncla(data.prev)}
        title={periodo === 'diario' ? 'La jornada anterior' : 'La semana anterior'}
      >
        ←
      </button>

      <span className="informe-rango">
        {data ? (
          <>
            {dm(data.from)}
            {data.from !== data.to && ` – ${dm(data.to)}`}
          </>
        ) : (
          '…'
        )}
      </span>

      <button
        disabled={!data?.next}
        onClick={() => data?.next && setAncla(data.next)}
        title={periodo === 'diario' ? 'La jornada siguiente' : 'La semana siguiente'}
      >
        →
      </button>

      {/* "Hoy" no es hoy: es la jornada MAS RECIENTE con operaciones. Si hoy
          no has operado todavia, llevar a un dia vacio seria peor que
          llevarte al ultimo que tiene algo que ensenar. */}
      <button disabled={data?.isLatest ?? true} onClick={() => setAncla(null)}>
        Lo ultimo
      </button>

      <button className={verCalendario ? 'on' : ''} onClick={() => setVerCalendario((v) => !v)}>
        Calendario
      </button>
    </div>
  );

  const calendario = verCalendario && data && (
    <div className="panel informe-calendario">
      <div className="note" style={{ marginBottom: 10 }}>
        Las jornadas con operaciones, con su <b>neto</b>. Pulsa una para ver{' '}
        {periodo === 'diario' ? 'ese dia' : 'su semana'}. De lunes a viernes: con el corte de
        las 18:00 de Nueva York no existe el fin de semana.
      </div>
      <DayCalendar
        days={data.calendar}
        selected={data.days}
        onToggle={(d) => { setAncla(d); setVerCalendario(false); }}
        onClear={() => setAncla(null)}
      />
    </div>
  );

  if (error) return <>{barra}<div className="error">{error}</div></>;
  if (!data) return <>{barra}<div className="note">Calculando…</div></>;
  if (data.operations === 0)
    return (
      <>
        {barra}
        {calendario}
        <div className="empty">
          Sin operaciones {periodo === 'diario' ? 'esa jornada' : 'esa semana'}. Usa las flechas o
          el calendario para ir a una con datos.
        </div>
      </>
    );

  const corto = data.days.length < data.expectedDays;
  const esDia = data.periodo === 'diario';

  return (
    <>
      {barra}
      {calendario}

      {/* ------------------------------------------------- 1. cuanto llevo */}
      <div className="panel">
        <h2>
          {esDia ? 'La jornada' : 'La semana'} · {dm(data.from)}
          {!esDia && data.from !== data.to && ` – ${dm(data.to)}`}
        </h2>

        <div className="note" style={{ marginBottom: 12 }}>
          {data.days.length} jornada{data.days.length === 1 ? '' : 's'}
          {corto && (
            <>
              {' '}de {data.expectedDays}. <b>La semana no ha terminado</b>, o no operaste todos
              los dias.
            </>
          )}
          {' · '}Jornada de mercado, que cierra a las 18:00 de Nueva York.
        </div>

        <div className="tiles compact">
          <div className="tile">
            <div className="k">Neto</div>
            <div className={`v ${signClass(data.net)}`}>{signedUsd(data.net, 0)}</div>
            <div className="n">
              bruto {signedUsd(data.gross, 0)} · comision {usd(data.commission, 0)}
            </div>
          </div>

          {/* LA CIFRA QUE MANDA. Va la segunda y no escondida abajo: es la
              unica que mide COMO opera sin mezclarlo con CUANTO arriesga. En
              octubre el dinero dijo +157,50 y esta dijo -4: la diferencia
              entera era el lotaje de una operacion. */}
          <div className="tile">
            <div className="k">Ticks por contrato</div>
            <div className={`v ${signClass(data.ticksPerTrade)}`}>{ticks(data.ticksPerTrade)}</div>
            <div className="n">
              mediana {ticks(data.ticksMedian)} · sin el efecto del tamanio
            </div>
          </div>

          <div className="tile">
            <div className="k">Operaciones</div>
            <div className="v">{data.operations}</div>
            <div className="n">
              {data.contracts} contratos · acierto {pct(data.winRate)}
            </div>
          </div>

          <div className="tile">
            <div className="k">Lote maximo</div>
            <div className={data.maxLot > 4 ? 'v neg' : 'v'}>{data.maxLot}</div>
            <div className="n">mediano {num(data.medianLot, 1)}</div>
          </div>

          {data.dailyLossLimit > 0 ? (
            <div className="tile">
              <div className="k">Queda del limite</div>
              <div className={`v ${(data.remaining ?? 0) < data.dailyLossLimit * 0.3 ? 'neg' : ''}`}>
                {usd(data.remaining ?? 0, 0)}
              </div>
              <div className="n">de {usd(data.dailyLossLimit, 0)} en la ultima jornada</div>
            </div>
          ) : (
            <div className="tile">
              <div className="k">Limite diario</div>
              <div className="v note">sin poner</div>
              <div className="n">Ajustes → Costes</div>
            </div>
          )}

          {data.previous && (
            <div className="tile">
              <div className="k">{esDia ? 'Jornada anterior' : 'Semana anterior'}</div>
              <div className={`v ${signClass(data.previous.net)}`}>
                {signedUsd(data.previous.net, 0)}
              </div>
              <div className="n">
                {ticks(data.previous.ticksPerTrade)} tk/contrato · {dm(data.previous.from)}
                {data.previous.from !== data.previous.to && `–${dm(data.previous.to)}`}
              </div>
            </div>
          )}
        </div>

        {data.previous && (
          <div className="note">
            Contra {esDia ? 'la jornada anterior' : 'la semana anterior'}, los ticks por contrato
            van de <b className={signClass(data.previous.ticksPerTrade)}>
              {ticks(data.previous.ticksPerTrade)}
            </b>{' '}
            a <b className={signClass(data.ticksPerTrade)}>{ticks(data.ticksPerTrade)}</b>. Dos
            periodos no son una tendencia — esta cifra solo dice algo mirada mes a mes.
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ 2. el tamanio */}
      <div className="panel">
        <h2>El tamanio</h2>
        <div className="note" style={{ marginBottom: 10 }}>
          <b>La pregunta mas importante del informe.</b> Lo medido en octubre: sus cinco peores
          perdidas salieron entre −54 y −60 ticks por contrato, o sea que el stop estaba donde
          tenia que estar. Lo que las convirtio en −$2.548 fue el numero de contratos. Un stop no
          protege de una posicion grande: multiplica por ella.
        </div>

        <div className="tiles compact">
          <div className="tile">
            <div className="k">Mas de {num(data.medianLot, data.medianLot % 1 ? 1 : 0)} lotes</div>
            <div className={`v ${signClass(data.bigLots.net)}`}>{signedUsd(data.bigLots.net, 0)}</div>
            <div className="n">
              {data.bigLots.operations} ops · {ticks(data.bigLots.ticksPerTrade)} tk/contrato
            </div>
          </div>
          <div className="tile">
            <div className="k">{num(data.medianLot, data.medianLot % 1 ? 1 : 0)} lotes o menos</div>
            <div className={`v ${signClass(data.smallLots.net)}`}>
              {signedUsd(data.smallLots.net, 0)}
            </div>
            <div className="n">
              {data.smallLots.operations} ops · {ticks(data.smallLots.ticksPerTrade)} tk/contrato
            </div>
          </div>
        </div>

        <FilasBloque rows={data.byLot} etiqueta="Lotaje" />
        <div className="note" style={{ marginTop: 8 }}>
          Las filas con menos de 10 operaciones salen en gris: el numero existe, pero una sola
          operacion lo mueve entero. Mira <b>tk/op</b> antes que el neto — es lo unico comparable
          entre lotajes distintos.
        </div>
      </div>

      {/* --------------------------------------------------- 4 y 5. donde */}
      <div className="panel">
        <h2>Donde operaste</h2>
        <FilasBloque rows={data.bySession} etiqueta="Franja" nombre={(b) => sessionLabel(b.key)} />

        {data.byGap.length > 0 && (
          <>
            <h3 style={{ marginTop: 16 }}>Los huecos entre killzones</h3>
            <div className="note" style={{ marginBottom: 8 }}>
              Es lo que esconde «Fuera», que no es un sitio sino cinco tramos distintos. El de{' '}
              <b>11:00–12:00</b>, justo despues de cerrar NY AM, fue la peor hora de octubre:
              −$501 en 50 operaciones.
            </div>
            <FilasBloque rows={data.byGap} etiqueta="Hueco" />
          </>
        )}
      </div>

      {/* ------------------------------------------- 6. las que importan */}
      <div className="panel">
        <h2>Las que movieron el periodo</h2>
        <div className="note" style={{ marginBottom: 4 }}>
          <b>tk/contrato</b> dice si respetaste el stop. <b>Factor</b> dice cuanto multiplico el
          tamanio. Una perdida de −60 ticks con 1 contrato son −$30; con 40, son −$1.200.
        </div>
        <Destacadas rows={data.worst} titulo="Las cinco peores" />
        <Destacadas rows={data.best} titulo="Las cinco mejores" />
      </div>

      {/* ------------------------------- 7. lo que hubo que aguantar */}
      <div className="panel">
        <h2>Lo que hubo que aguantar</h2>
        <div className="note" style={{ marginBottom: 10 }}>
          El <b>drawdown</b> es cuanto bajaste desde tu mejor momento dentro de esa franja y esa
          jornada, con la cuenta empezando plana. Es lo que tuviste que soportar para llegar al
          final, y no se deduce del resultado.
        </div>
        <table>
          <thead>
            <tr>
              <th className="izq">Franja</th>
              <th>Jornadas</th>
              <th>Ops</th>
              <th>Drawdown tipico</th>
              <th>Peor</th>
              <th>Verdes</th>
              <th title="Operaciones perdedoras seguidas dentro de una misma franja.">Racha</th>
            </tr>
          </thead>
          <tbody>
            {data.drawdown.rows.map((r) => (
              <tr key={r.session} className={r.days < 3 ? 'apagada' : ''}>
                <td className="izq">
                  <b>{sessionLabel(r.session)}</b>
                </td>
                <td>{r.days}</td>
                <td>{r.trades}</td>
                <td>{usd(r.drawdownMedian, 0)}</td>
                <td className="neg">{usd(r.drawdownWorst, 0)}</td>
                <td>
                  {r.greenDays}/{r.days}
                </td>
                <td>{r.worstStreak}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------------------------------------------- solo semanal */}
      {!esDia && (
        <div className="panel">
          <h2>Lo que solo se puede mirar con una semana</h2>
          <div className="note" style={{ marginBottom: 12 }}>
            Con una jornada estos cajones tienen cuatro operaciones cada uno y no describen nada.
            Con una semana ya se pueden leer — pero <b>siguen sin poder concluir</b>: cinco
            jornadas son doscientas operaciones en el mejor caso.
          </div>

          <div className="tiles compact">
            <div className="tile">
              <div className="k">Payoff</div>
              <div className={`v ${data.payoff !== null && data.breakeven !== null && data.winRate >= data.breakeven ? 'pos' : 'neg'}`}>
                {data.payoff === null ? '—' : num(data.payoff)}
              </div>
              <div className="n">
                {data.breakeven === null
                  ? 'sin perdedoras'
                  : `necesita ${pct(data.breakeven)} de acierto · tienes ${pct(data.winRate)}`}
              </div>
            </div>

            <div className="tile">
              <div className="k">Sin ninguna media a favor</div>
              <div className={`v ${signClass(data.sinAlineacion?.net ?? 0)}`}>
                {data.sinAlineacion === null ? '—' : signedUsd(data.sinAlineacion.net, 0)}
              </div>
              <div className="n">
                {data.sinAlineacion === null
                  ? 'faltan velas para evaluarlo'
                  : `${data.sinAlineacion.operations} ops · ${signedUsd(data.sinAlineacion.perTrade)}/op`}
              </div>
            </div>

            <div className="tile">
              <div className="k">Reentradas en caliente</div>
              <div className={`v ${signClass(data.revenge.net)}`}>{signedUsd(data.revenge.net, 0)}</div>
              <div className="n">
                {data.revenge.operations} ops · {signedUsd(data.revenge.perTrade)}/op
              </div>
            </div>
          </div>

          <div className="note">
            <b>Sin ninguna media a favor</b> es el veto medido: en el periodo de aprendizaje fueron
            127 operaciones a −$17,79 cada una, con permutacion p = 0,0098. Es la unica de las
            tres que ha sobrevivido a una prueba de verdad, y aun asi solo vale como veto — mas
            marcos a favor no es mejor de forma ordenada.
            <br />
            <b>El picado no sale aqui</b> porque no esta en la base: lo calcula el indicador en
            Quantower y el diario no lo guarda con cada operacion. Si alguna vez se guarda, esta
            es su casilla.
          </div>
        </div>
      )}

      <div className="note">
        Lo que este panel <b>no</b> contesta, a proposito: si una regla «esta funcionando», o si
        vas mejorando. Con una jornada o una semana no se puede, y contestarlo igual es como se
        construye una supersticion. Eso es el bloque mensual, se hace a mano y lleva su control y
        su correccion por comparaciones multiples.
      </div>
    </>
  );
}
