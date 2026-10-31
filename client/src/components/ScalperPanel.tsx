import { useCallback, useEffect, useState } from 'react';
import { api, type Filters, type ScalperReport } from '../api';
import { num, sessionLabel, signClass, signedUsd } from '../format';

/**
 * "¿Y si saliera SIEMPRE en el mismo numero de ticks?"
 *
 * Coge tus entradas tal cual y les quita tu gestion: objetivo fijo, stop fijo,
 * y mira cual tocaba primero. El resultado es el acierto que tendria esa regla
 * sobre TUS operaciones, por killzone.
 *
 * La pantalla esta construida alrededor de una idea: **el acierto solo no dice
 * nada**. Un objetivo de 5 ticks con stop de 60 acierta el 71,6 % y pierde
 * 13,5 ticks por operacion. Por eso el porcentaje nunca sale solo; siempre va
 * con la expectativa al lado y con el mismo tamaño.
 */

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
const ticks = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`);

/** Debajo de esto, la fila es una anecdota y se dice. */
const MINIMO = 30;

/** Por encima de esto, la vela de 1m decide demasiadas y el numero deja de medir. */
const AMBIGUAS_MAX = 0.15;

export function ScalperPanel({ filters }: { filters: Filters }) {
  const [target, setTarget] = useState('20');
  const [stop, setStop] = useState('60');
  const [horizon, setHorizon] = useState('180');
  const [data, setData] = useState<ScalperReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(() => {
    setCargando(true);
    api
      .scalper(filters, Number(target), Number(stop), Number(horizon))
      .then((d) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }, [filters, target, stop, horizon]);

  // Solo al montar y al cambiar los filtros de arriba. Los tres numeros de
  // aqui NO disparan la consulta solos: escribir "2" camino de "25" lanzaria
  // una simulacion de 573 operaciones por cada tecla.
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters]);

  const t = data?.total;
  const mejor = data
    ? data.barrido.reduce<null | (typeof data.barrido)[number]>(
        (a, b) => (b.ticksPorOp !== null && (a === null || a.ticksPorOp === null || b.ticksPorOp > a.ticksPorOp) ? b : a),
        null,
      )
    : null;
  const todoNegativo = data ? data.barrido.every((b) => (b.ticksPorOp ?? 0) <= 0) : false;

  return (
    <div className="panel">
      <h2>Scalper: salir siempre en el mismo sitio</h2>

      <div className="filters">
        <label title="A cuantos ticks por contrato pones el objetivo.">
          Objetivo
          <input type="number" min="1" max="500" step="5" style={{ width: 80 }}
            value={target} onChange={(e) => setTarget(e.target.value)} />
          ticks
        </label>
        <label title="A cuantos ticks por contrato pones el stop. El tuyo de verdad son 60.">
          Stop
          <input type="number" min="1" max="500" step="5" style={{ width: 80 }}
            value={stop} onChange={(e) => setStop(e.target.value)} />
          ticks
        </label>
        <label title="Cuanto se deja correr antes de darla por no resuelta.">
          Horizonte
          <input type="number" min="5" max="1440" step="15" style={{ width: 90 }}
            value={horizon} onChange={(e) => setHorizon(e.target.value)} />
          min
        </label>
        <button className="primary" onClick={cargar} disabled={cargando}>
          {cargando ? 'Simulando...' : 'Simular'}
        </button>
      </div>

      {error && <div className="error">No se pudo simular: {error}</div>}
      {!data && !error && <div className="empty">simulando sobre tus operaciones...</div>}

      {data && t && (
        <>
          {/* La cabecera lleva las DOS cifras del mismo tamaño a proposito. El
              acierto es la que se mira; la expectativa es la que decide. */}
          <div className="tiles">
            <div className="tile">
              <div className="k">Acierto</div>
              <div className="v">{pct(t.hitPct)}</div>
              <div className="n">{t.aciertos} de {t.n}</div>
            </div>
            <div className="tile">
              <div className="k">Expectativa</div>
              <div className={`v ${signClass(t.ticksPorOp ?? 0)}`}>{ticks(t.ticksPorOp)}</div>
              <div className="n">ticks por operacion</div>
            </div>
            <div className="tile">
              <div className="k">En dolares</div>
              <div className={`v ${signClass(t.usdPorOp ?? 0)}`}>{t.usdPorOp === null ? '—' : signedUsd(t.usdPorOp)}</div>
              <div className="n">por operacion y contrato</div>
            </div>
            <div className="tile">
              <div className="k">Lo que sacaste tu</div>
              <div className={`v ${signClass(t.realTicksPorOp ?? 0)}`}>{ticks(t.realTicksPorOp)}</div>
              <div className="n">mediana {ticks(t.realMediana)}</div>
            </div>
          </div>

          <div className="note">
            <b>El acierto solo no dice nada.</b> Con objetivo de 5 ticks y stop de 60 se acierta
            el 71,6 % y se pierden 13,5 ticks por operacion: ganas casi tres de cada cuatro y
            cada fallo se come doce aciertos. La cifra que decide es la{' '}
            <b>expectativa</b> — objetivo x aciertos menos stop x fallos —, y la unica
            comparacion que importa es contra la cuarta baldosa: lo que sacaste tu gestionando
            la salida a mano.
          </div>

          {t.ambiguasPct !== null && t.ambiguasPct > AMBIGUAS_MAX && (
            <div className="news-alert">
              <b>Medicion poco fiable</b>
              <span>
                En el {pct(t.ambiguasPct)} de los casos el precio toca el objetivo y el stop
                dentro del MISMO minuto, y con velas de un minuto no hay forma de saber cual
                fue primero. Esas se cuentan como perdida, que es la hipotesis conservadora,
                pero a este nivel el resultado lo decide esa regla de desempate y no el
                mercado. <b>Separa mas el objetivo y el stop</b> si quieres un numero que
                signifique algo.
              </span>
            </div>
          )}

          <h3>Por killzone</h3>
          <div className="note" style={{ marginTop: 0 }}>
            Cada franja se mueve distinto, asi que el mismo objetivo no vale lo mismo en Asia
            que en la apertura de Nueva York. Es la pregunta util: <b>donde puedo poner un
            objetivo seguro</b> para las entradas que no me fio, y donde me conviene seguir
            gestionando a mano.
          </div>

          <table>
            <thead>
              <tr>
                <th className="izq">Killzone</th>
                <th>Operaciones</th>
                <th>Acierto</th>
                <th>Ticks / op</th>
                <th>USD / op</th>
                <th>Ambiguas</th>
                <th>Tu, a mano</th>
              </tr>
            </thead>
            <tbody>
              {data.porSesion.map((f) => {
                const flojo = f.n < MINIMO;
                const turbio = (f.ambiguasPct ?? 0) > AMBIGUAS_MAX;
                return (
                  <tr key={f.session} className={flojo ? 'apagada' : ''}>
                    <td className="izq">
                      <b>{sessionLabel(f.session)}</b>
                      {flojo && <span className="note"> · pocas operaciones</span>}
                    </td>
                    <td>{f.n}</td>
                    <td>{pct(f.hitPct)}</td>
                    <td className={signClass(f.ticksPorOp ?? 0)}>{ticks(f.ticksPorOp)}</td>
                    <td className={signClass(f.usdPorOp ?? 0)}>
                      {f.usdPorOp === null ? '—' : signedUsd(f.usdPorOp)}
                    </td>
                    <td className={turbio ? 'neg' : 'note'}>{pct(f.ambiguasPct)}</td>
                    <td className={signClass(f.realTicksPorOp ?? 0)}>{ticks(f.realTicksPorOp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="note">
            Las filas con menos de {MINIMO} operaciones salen apagadas. Con cuatro operaciones
            un 100 % de acierto no es una medicion, es una anecdota, y la columna de ambiguas
            en rojo avisa de que la vela de un minuto esta decidiendo demasiadas.
          </div>

          <h3>Barrido de objetivos, con el stop en {data.config.stop} ticks</h3>
          <div className="note" style={{ marginTop: 0 }}>
            La misma cuenta con el objetivo de 5 en 5. Una cifra suelta no vale; lo que vale es
            la forma de la curva. Si varios objetivos vecinos dan lo mismo hay <b>meseta</b> y
            el efecto puede ser real; si solo funciona un valor exacto y los de al lado no, es
            suerte.
          </div>

          <table>
            <thead>
              <tr>
                <th>Objetivo</th>
                <th>Acierto</th>
                <th>Ticks / op</th>
                <th>Ambiguas</th>
              </tr>
            </thead>
            <tbody>
              {data.barrido.map((b) => (
                <tr key={b.target} className={!todoNegativo && b === mejor ? 'hi' : ''}>
                  <td><b>{b.target}</b> ticks</td>
                  <td>{pct(b.hitPct)}</td>
                  <td className={signClass(b.ticksPorOp ?? 0)}>{ticks(b.ticksPorOp)}</td>
                  <td className={(b.ambiguasPct ?? 0) > AMBIGUAS_MAX ? 'neg' : 'note'}>
                    {pct(b.ambiguasPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {todoNegativo && (
            <div className="news-alert">
              <b>Ningun objetivo sale a cuenta</b>
              <span>
                Con el stop en {data.config.stop} ticks, los {data.barrido.length} objetivos
                probados pierden dinero. No se resalta ninguno como &quot;el mejor&quot;
                porque el menos malo sigue siendo malo, y marcarlo invitaria a usarlo.
                Prueba a mover el stop: es el otro lado de la ecuacion y aqui manda mas que
                el objetivo.
              </span>
            </div>
          )}

          <div className="note">
            <b>Que contesta esto y que no.</b> Contesta que habria pasado con la SALIDA, dadas
            tus entradas y en tu horario. No contesta si deberias haber entrado: las entradas
            son las tuyas, con su hora real, y solo se usan velas posteriores a cada una —
            aqui no hay ninguna mirada al futuro.
            <br />
            Tampoco mide tu stop real. La simulacion castiga cada fallo con el stop entero, y
            tu cortas antes a mano: por eso la columna <b>Tu, a mano</b> puede ganarle a la
            regla fija sin que eso signifique que tus entradas sean buenas. Significa que tu
            gestion de la salida lo es.
            <br />
            {data.total.sinResolver > 0 && (
              <>
                {data.total.sinResolver} operaciones no llegaron ni al objetivo ni al stop en{' '}
                {data.config.horizonMin} minutos y se quedan fuera del porcentaje: no se
                inventa un resultado para ellas.
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
