import { useEffect, useState } from 'react';
import { api, type ReaccionReport } from '../api';
import { date, hora, num, signClass, usd, zonaCorta } from '../format';

/**
 * Reaccion del precio a las noticias del calendario.
 *
 * SE LLAMA "REACCION" Y NO "INTERPRETACIONES" A PROPOSITO.
 *
 * La pestania que se pidio era de interpretaciones: que dijera si un dato es
 * bueno o malo para el Nasdaq. No se puede construir con esta base y conviene
 * que quede escrito donde se mira, no solo en el codigo: de los eventos del
 * calendario, NINGUNO trae prevision ni dato real. Sin prevision no hay
 * sorpresa, y sin sorpresa no hay direccion — lo que mueve el precio no es que
 * el paro sea del 4,2 %, es que se esperaba 4,0 %.
 *
 * Una pantalla que dijera "esto es positivo para el Nasdaq" sin muestra
 * detras seria la unica del diario que no sale de la base, y ademas la unica
 * que no se puede equivocar: se lee como analisis, se recuerda cuando acierta
 * y se olvida cuando falla. De once hipotesis medidas aqui, nueve murieron
 * porque cada una se enfrento a un numero.
 *
 * Asi que esto ensenia tres cosas y ninguna es una opinion:
 *
 *   1. Si la direccion se puede anticipar. (Hoy: no. Es una moneda.)
 *   2. Cuanto se mueve, contra la linea base del mismo reloj sin noticia.
 *   3. Que le falta al calendario para poder contestar lo primero.
 */

/** Un p tan pequenio que 20.000 remuestreos no pueden afinarlo mas. */
const P_MINIMO = 1 / 20_001;

function formatoP(p: number): string {
  if (p <= P_MINIMO * 1.5) return '< 0,0001';
  return num(p, 4).replace('.', ',');
}

/** Un porcentaje con un decimal: 0,607 -> "60,7 %". */
const pct1 = (p: number) => `${num(p * 100, 1).replace('.', ',')} %`;

/** Puntos con signo. El color por signo lo pone quien llama, con signClass. */
const pts = (n: number) => `${n > 0 ? '+' : ''}${num(n, 1)}`;

export function ReactionPanel() {
  const [data, setData] = useState<ReaccionReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.reaccion().then(setData).catch((e: unknown) => setError(String(e)));
  }, []);

  if (error !== null) return <div className="empty">no se pudo medir: {error}</div>;
  if (data === null) return <div className="empty">midiendo...</div>;

  const { calendario, direccion, franjas } = data;
  const medibles = data.eventos.filter((e) => e.problema === null);
  const rotos = data.eventos.filter((e) => e.problema !== null);

  return (
    <div className="reaccion">
      {/* Lo primero que se lee, porque condiciona todo lo que viene detras. */}
      <div className="reaccion-aviso">
        <b>Esto mide, no interpreta.</b> De los {calendario.total} eventos del calendario,{' '}
        <b className={calendario.conPrevision === 0 ? 'neg' : 'pos'}>{calendario.conPrevision}</b>{' '}
        traen prevision y{' '}
        <b className={calendario.conDatoReal === 0 ? 'neg' : 'pos'}>{calendario.conDatoReal}</b>{' '}
        traen el dato real. Sin prevision no hay sorpresa, y sin sorpresa no se puede
        decir si un dato es bueno o malo para el Nasdaq: solo cuanto movio el precio.
      </div>

      {/* ------------------------------------------------------- la direccion */}

      <h3>¿Se puede anticipar hacia donde va?</h3>

      {direccion === null ? (
        <div className="empty">todavia no hay ningun evento con velas alrededor</div>
      ) : (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="k">A favor / en contra</div>
              <div className="v">
                <span className="pos">{direccion.aFavor}</span>
                {' / '}
                <span className="neg">{direccion.enContra}</span>
              </div>
              <div className="n">a los 60 minutos · {direccion.momentos} momentos distintos</div>
            </div>
            <div className="tile">
              <div className="k">Movimiento neto (mediana)</div>
              <div className={`v ${signClass(direccion.medianaNeta)}`}>{pts(direccion.medianaNeta)}</div>
              <div className="n">puntos · cerca de cero es una moneda</div>
            </div>
            <div className="tile">
              <div className="k">Recorrido (mediana)</div>
              <div className="v">{num(direccion.medianaAbs, 1)}</div>
              <div className="n">puntos sin signo · {usd(direccion.medianaAbsUsd, 0)} por contrato</div>
            </div>
          </div>

          <p className="note">
            {/* La lectura escrita Y CON UN NUMERO DETRAS. "8 y 7" se lee solo,
                pero "9 y 6" ya no: a ojo parece una tendencia. Dejar que el
                lector decida cuanto es mucho es por donde vuelven a colarse
                las interpretaciones. */}
            Con {direccion.momentos} momentos medidos hay <b>{direccion.aFavor}</b> subidas y{' '}
            <b>{direccion.enContra}</b> bajadas.{' '}
            {direccion.pMoneda >= 0.05 ? (
              <>
                Si cada noticia fuera una moneda, un reparto asi o mas desigual saldria{' '}
                <b>{pct1(direccion.pMoneda)} de las veces</b>: <b>es indistinguible del azar</b>.
                Lo que si es grande es el recorrido — {num(direccion.medianaAbs, 1)} puntos de
                mediana, {usd(direccion.medianaAbsUsd, 0)} por contrato.{' '}
                <b>Se mueve mucho y no se sabe hacia donde.</b>
              </>
            ) : (
              <>
                Por azar, un reparto asi saldria solo {pct1(direccion.pMoneda)} de las veces.
                Es la primera senial de direccion que aparece: <b>hay que volver a mirarla</b>{' '}
                con mas eventos antes de darla por buena.
              </>
            )}
          </p>
        </>
      )}

      {/* ----------------------------------------------------- cuanto se mueve */}

      <h3>¿Se mueve mas que un dia normal a esa hora?</h3>

      <p className="note">
        Rango de los 60 minutos siguientes. Se compara con <b>el mismo minuto del reloj</b> en los
        demas dias laborables, no con la media del dia: a las 12:30 el mercado ya se mueve mas
        que de madrugada opere quien opere, y comparar contra la media regalaria el resultado.
        El contraste es una permutacion de 20.000 remuestreos sobre la diferencia de medianas.
      </p>

      <table>
        <thead>
          <tr>
            <th>Hora UTC</th>
            <th>Con noticia</th>
            <th>Sin noticia</th>
            <th>Veces</th>
            <th>p</th>
            <th className="izq">Muestra</th>
          </tr>
        </thead>
        <tbody>
          {franjas.map((f) => {
            const claro = f.p < 0.05 && f.nCon >= 5;
            return (
              <tr key={f.hhmm} className={claro ? 'destaca' : ''}>
                <td>{f.hhmm}</td>
                <td>{num(f.medianaCon, 1)}</td>
                <td>{num(f.medianaSin, 1)}</td>
                {/* Sin color por signo: un ratio alto no es "bueno" ni "malo",
                    solo grande. Pintarlo de verde diria que conviene. */}
                <td><b>×{num(f.ratio, 2)}</b></td>
                <td>{formatoP(f.p)}</td>
                <td className="izq note">
                  {f.nCon} con · {f.nSin} sin
                  {f.nCon < 5 && <span className="aviso"> · muy poca muestra</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="note">
        Se resalta la fila cuando el contraste baja de 0,05 <b>y</b> hay al menos cinco eventos.
        Las dos condiciones: un p pequenio con tres casos es ruido con suerte.
      </p>

      {/* -------------------------------------------------- evento por evento */}

      <h3>Evento por evento <span className="note">({medibles.length} medidos)</span></h3>

      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th className="izq">Hora {zonaCorta()}</th>
            <th className="izq">Evento</th>
            <th>Previo</th>
            <th>+5m</th>
            <th>+15m</th>
            <th>+30m</th>
            <th>+60m</th>
            <th>Rango 60m</th>
          </tr>
        </thead>
        <tbody>
          {medibles.map((e) => (
            <tr key={e.id}>
              <td>{date(e.ts)}</td>
              <td className="izq">{hora(e.ts)}</td>
              <td className="izq">
                {e.impact === 'high' && <span className="chip alert">alto</span>}{' '}
                {e.title}
              </td>
              <td>{num(e.previo ?? 0, 1)}</td>
              {e.movimientos.map((m) => (
                <td key={m.min} className={signClass(m.puntos)}>{pts(m.puntos)}</td>
              ))}
              <td>{num(e.rango60 ?? 0, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Los eventos rotos NO se esconden: un evento del calendario que cae
          donde no hay mercado casi siempre significa que la fila esta mal, y
          eso es un dato inventado dentro de la base. */}
      {rotos.length > 0 && (
        <div className="reaccion-rotos">
          <b>{rotos.length} evento{rotos.length === 1 ? '' : 's'} del calendario sin velas alrededor.</b>{' '}
          Un dato economico que cae donde el mercado esta cerrado casi siempre significa que la
          fila esta mal fechada, no que falten velas.
          <ul>
            {rotos.map((e) => (
              <li key={e.id}>
                {date(e.ts)} {hora(e.ts)} · {e.title}
                {e.source && <span className="note"> · {e.source}</span>}
                <div className="note">{e.problema}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ------------------------------------------- el estado del calendario */}

      <h3>Que le falta al calendario</h3>

      <table>
        <tbody>
          <tr>
            <td>Eventos</td>
            <td>{calendario.total}</td>
            <td className="izq note">de los que {medibles.length} caen dentro de las velas que hay</td>
          </tr>
          <tr>
            <td>Con prevision</td>
            <td className={calendario.conPrevision === 0 ? 'neg' : 'pos'}>{calendario.conPrevision}</td>
            <td className="izq note">sin esto no hay sorpresa, y sin sorpresa no hay direccion</td>
          </tr>
          <tr>
            <td>Con dato real</td>
            <td className={calendario.conDatoReal === 0 ? 'neg' : 'pos'}>{calendario.conDatoReal}</td>
            <td className="izq note">lo que salio de verdad</td>
          </tr>
          {calendario.fuentes.map((f) => (
            <tr key={f.source}>
              <td>de {f.source}</td>
              <td>{f.n}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>

      <p className="note">
        <b>No hace falta codigo nuevo para arreglarlo.</b> <code>src/ingest/investing.ts</code> ya
        lee <code>forecast</code>, <code>previous</code> y <code>actual</code>, y conserva el dato
        real al reimportar. Cuando los haya, la sorpresa se mide encima de esta misma tabla: el
        mismo movimiento, partido por el signo de la sorpresa.
      </p>

      {/* La trampa concreta en la que ya se cayo una vez, escrita aqui porque
          es donde se mira al preguntarse "pero si yo deje el json...". */}
      {calendario.conPrevision === 0 && (
        <p className="note">
          <b>Si ya dejaste un <code>.json</code> y esto sigue en cero</b>, lo mas probable es que
          tengas solo media descarga. El export de Investing viene en <b>dos partes</b>: el{' '}
          <i>catalogo</i>, que son los nombres de cada evento con su importancia, y las{' '}
          <i>ocurrencias</i>, que son las que llevan la fecha, la prevision y el dato real. El
          catalogo por si solo no aporta ni una cifra. Al pulsar <b>Importar calendario</b> en
          Calendario se dice cual de las dos trae cada fichero.
        </p>
      )}

      <p className="note">
        Velas disponibles: {date(data.desde)} a {date(data.hasta)} · {data.symbol}.
        {data.fueraDeRango > 0 && ` ${data.fueraDeRango} eventos del calendario quedan fuera de ese rango.`}
      </p>
    </div>
  );
}
