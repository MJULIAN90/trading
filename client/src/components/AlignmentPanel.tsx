import { useEffect, useState } from 'react';
import { signClass, signedUsd, ticks } from '../format';
import { useSort } from '../sortable';

/**
 * Como te fue segun con cuantos marcos estabas alineado con la pila de medias.
 *
 * Es el cruce que faltaba. Hasta ahora habia dos mundos sin contacto: los
 * estudios de mercado, que miran miles de velas y no saben nada de ti, y tus
 * operaciones, que lo saben todo de ti y nada del mercado en el instante de
 * entrar. Aqui se juntan.
 *
 * "A favor" es la pila entera -8 > 21 > 55 > 200 con el precio por encima-
 * en el sentido de la operacion, evaluada sobre la ultima vela CERRADA de
 * cada marco. Ni el cruce suelto de dos medias ni la vela en curso.
 */

type FrameName = 'm1' | 'm15' | 'h1' | 'h4';

interface Bucket {
  favor: number;
  operations: number;
  wins: number;
  hitRate: number;
  netPnl: number;
  avgNet: number;
  ticks: number;
}

interface Report {
  symbol: string;
  analyzed: number;
  skipped: number;
  buckets: Bucket[];
  byFrame: Array<{ frame: FrameName; favor: Bucket; contra: Bucket }>;
}

const FRAME_LABEL: Record<FrameName, string> = { m1: '1 minuto', m15: '15 minutos', h1: '1 hora', h4: '4 horas' };

const pc = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Con menos de esto, el porcentaje es ruido y conviene que se note. */
const MINIMO = 15;

export function AlignmentPanel({ query }: { query: string }) {
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setData(null);
    setError(null);

    // EL INTERROGANTE NO SOBRA. `qs()` devuelve "account=17011740", sin el `?`
    // delante, y todos los demas sitios lo ponen ellos. Aqui faltaba: sin
    // filtros la cadena va vacia y la URL sale bien de casualidad, pero al
    // elegir una cuenta se pedia "/api/alignmentaccount=17011740", que no
    // existe. Por eso el panel solo reventaba al tocar el desplegable.
    fetch(`/api/alignment?${query}`)
      .then(async (r) => {
        // Comprobar `ok` ANTES de leer el cuerpo. Un 404 de Fastify tambien es
        // JSON valido -{statusCode, error, message}-, asi que `.json()` no
        // falla: devuelve un objeto sin `buckets`, y el fallo aparecia mucho
        // mas tarde como "undefined.map" dentro del render, que no dice nada
        // de la URL equivocada.
        if (!r.ok) throw new Error(`el servidor contesto ${r.status}`);

        const d = (await r.json()) as Report;
        if (!Array.isArray(d.buckets) || !Array.isArray(d.byFrame))
          throw new Error('la respuesta no tiene la forma esperada');
        return d;
      })
      .then((d) => { if (vivo) setData(d); })
      .catch((e: Error) => { if (vivo) setError(e.message); });

    return () => { vivo = false; };
  }, [query]);

  const marcos = useSort(
    data?.byFrame ?? [],
    {
      marco: (m) => m.frame,
      afavor: (m) => m.favor.operations,
      afavorMedia: (m) => m.favor.avgNet,
      encontra: (m) => m.contra.operations,
      encontraMedia: (m) => m.contra.avgNet,
      diferencia: (m) => m.favor.avgNet - m.contra.avgNet,
    },
    null,
  );

  // Un panel que falla se queda en su sitio y lo dice. Antes se tragaba el
  // error y se quedaba en "calculando..." para siempre, o se llevaba por
  // delante la pestana entera al pintar.
  if (error !== null) {
    return <div className="error">No se pudo calcular la alineacion: {error}</div>;
  }

  if (data === null) return <div className="empty">calculando la alineacion...</div>;
  if (data.analyzed === 0) {
    return <div className="empty">no hay velas guardadas en las fechas de estas operaciones</div>;
  }

  return (
    <>
      <div className="note" style={{ marginBottom: 10 }}>
        De tus <b>{data.analyzed}</b> operaciones, con cuantos marcos estabas a favor de la pila de
        medias (8 &gt; 21 &gt; 55 &gt; 200, precio por encima) en el momento de entrar. Se calcula
        sobre la ultima vela <b>cerrada</b> de cada marco, asi que es informacion que tenias
        delante. {data.skipped > 0 && <>No se pudieron evaluar {data.skipped} por falta de velas guardadas.</>}
      </div>

      <table>
        <thead>
          <tr>
            <th>Marcos a favor</th>
            <th>Operaciones</th>
            <th>Acierto</th>
            <th>Neto</th>
            <th title="Lo unico comparable entre filas con distinto numero de operaciones">Media por operacion</th>
            <th>Ticks</th>
          </tr>
        </thead>
        <tbody>
          {data.buckets.map((b) => (
            <tr key={b.favor} className={b.favor === 4 ? 'hi' : ''}>
              <td>
                <b>{b.favor}</b> de 4
                {b.favor === 4 && <span className="note"> · tu operativa</span>}
                {b.favor === 0 && <span className="note"> · ninguno</span>}
              </td>
              <td className={b.operations < MINIMO ? 'note' : ''}>{b.operations}</td>
              <td className={b.operations < MINIMO ? 'note' : ''}>
                {b.operations === 0 ? '—' : pc(b.hitRate)}
              </td>
              <td className={signClass(b.netPnl)}>{signedUsd(b.netPnl)}</td>
              <td className={signClass(b.avgNet)}>{b.operations === 0 ? '—' : signedUsd(b.avgNet)}</td>
              <td className={signClass(b.ticks)}>{ticks(b.ticks)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="note" style={{ margin: '10px 0' }}>
        Las filas con menos de {MINIMO} operaciones salen apagadas: con esa muestra el porcentaje no
        dice nada, y el numero de operaciones manda siempre sobre el acierto.
      </div>

      <h2 style={{ marginTop: 18 }}>Marco a marco</h2>
      <div className="note" style={{ marginBottom: 8 }}>
        Cual de los cuatro pesa de verdad. La diferencia es lo que cambia la media por operacion
        entre entrar con ese marco a favor y entrar con el en contra.
      </div>

      <table>
        <thead>
          <tr>
            <marcos.Th k="marco">Marco</marcos.Th>
            <marcos.Th k="afavor">A favor</marcos.Th>
            <marcos.Th k="afavorMedia">Media</marcos.Th>
            <marcos.Th k="encontra">En contra</marcos.Th>
            <marcos.Th k="encontraMedia">Media</marcos.Th>
            <marcos.Th k="diferencia">Diferencia</marcos.Th>
          </tr>
        </thead>
        <tbody>
          {marcos.rows.map((m) => {
            const dif = m.favor.avgNet - m.contra.avgNet;
            const pocos = m.favor.operations < MINIMO || m.contra.operations < MINIMO;
            return (
              <tr key={m.frame}>
                <td>{FRAME_LABEL[m.frame]}</td>
                <td className={m.favor.operations < MINIMO ? 'note' : ''}>{m.favor.operations}</td>
                <td className={signClass(m.favor.avgNet)}>
                  {m.favor.operations === 0 ? '—' : signedUsd(m.favor.avgNet)}
                </td>
                <td className={m.contra.operations < MINIMO ? 'note' : ''}>{m.contra.operations}</td>
                <td className={signClass(m.contra.avgNet)}>
                  {m.contra.operations === 0 ? '—' : signedUsd(m.contra.avgNet)}
                </td>
                <td className={pocos ? 'note' : signClass(dif)}>
                  {m.favor.operations === 0 || m.contra.operations === 0 ? '—' : signedUsd(dif)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="note" style={{ marginTop: 10 }}>
        <b>Ojo con leer esto como una regla.</b> Son {data.analyzed} operaciones repartidas en cinco
        cajones, y en el historico los cuatro marcos solo coinciden el 8% del tiempo: el cajon de
        &quot;4 de 4&quot; va a tener pocos casos durante bastante tiempo. Sirve para orientar, no
        todavia para decidir.
      </div>
    </>
  );
}
