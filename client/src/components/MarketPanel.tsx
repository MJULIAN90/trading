import { useEffect, useState } from 'react';
import { UNIT_LABEL, inUnit, num, sessionLabel, signClass, signedInUnit, type Unit } from '../format';
import { GridPanel } from './GridPanel';

/**
 * Como se mueve el mercado en cada killzone, y que estudio sale de cruzar los
 * patrones con la tendencia de 4h.
 *
 * Las dos tablas tienen algo en comun que las separa del resto del diario: NO
 * miran tus operaciones. Miran las velas. Por eso aguantan conclusiones que
 * tus 160 entradas no aguantan: aqui hay miles de casos, incluidos todos los
 * momentos en que no entraste.
 */

interface SessionStat {
  session: string;
  samples: number;
  days: number;
  barRange: number;
  favP50: number;
  favP75: number;
  advP50: number;
  advP75: number;
  advP90: number;
  suggestedStop: number;
  suggestedTarget: number;
  ratio: number;
  trades: number;
  wins: number;
  losses: number;
  timeouts: number;
  ambiguous: number;
  hitRate: number;
  timeoutRate: number;
  breakEven: number;
  expectancy: number;
  longExpectancy: number;
  shortExpectancy: number;
  expectancyError: number;
}

interface StatsReport {
  symbol: string;
  horizonMin: number;
  stepMin: number;
  stopPct: number;
  targetR: number;
  tickSize: number;
  pointValue: number;
  tickValue: number;
  rows: SessionStat[];
}

interface StudyRow {
  code: string;
  label: string;
  samples: number;
  wins: number;
  hitRate: number;
  edge: number;
  pValue: number;
}

interface StudyReport {
  symbol: string;
  timeframe: number;
  trendMinutes: number;
  trendLookback: number;
  targetTicks: number;
  horizonMin: number;
  skippedRange: number;
  unresolved: number;
  trendMode: string;
  retest: string;
  requireStack: boolean;
  stopMode: string;
  targetR: number;
  medianRisk: number;
  randomBaseline: number;
  randomSamples: number;
  baseline: StudyRow;
  rows: StudyRow[];
}

/**
 * Color solo cuando la cifra esta fuera del margen de error.
 *
 * Dentro del margen devuelve "note" (gris): no es que sea cero, es que no se
 * puede distinguir de cero con los datos que hay, y el gris lo dice sin tener
 * que leer la letra pequena.
 */
function sure(value: number, error: number): string {
  if (!(Math.abs(value) > 2 * error)) return 'note';
  return value > 0 ? 'pos' : 'neg';
}

export function MarketPanel() {
  const [stats, setStats] = useState<StatsReport | null>(null);
  const [study, setStudy] = useState<StudyReport | null>(null);
  const [timeframe, setTimeframe] = useState(15);
  const [target, setTarget] = useState(40);
  const [trendMin, setTrendMin] = useState(240);

  // El modo que pidio: tendencia por pila de medias y entrada en el retest.
  const [trendMode, setTrendMode] = useState('rango');
  const [retest, setRetest] = useState('ninguno');
  const [requireStack, setRequireStack] = useState(false);
  const [stopMode, setStopMode] = useState('fijo');

  // Se llama studyR y no targetR porque la PRIMERA tabla ya tiene un targetR
  // suyo con otro significado. Dos "R" distintas en el mismo componente es
  // justo el tipo de colision que compila mal hoy y confunde dentro de un mes.
  const [studyR, setStudyR] = useState(2);

  // Los tres mandos de la primera tabla. El horizonte es el importante: el stop
  // escala con el tiempo que piensas aguantar dentro, asi que "cuanto stop pide
  // NY AM" no tiene respuesta hasta que dices cuanto tiempo vas a estar.
  const [horizon, setHorizon] = useState(30);
  const [stopPct, setStopPct] = useState(0.75);
  const [targetR, setTargetR] = useState(1);
  const [unit, setUnit] = useState<Unit>('ticks');

  useEffect(() => {
    setStats(null);
    fetch(`/api/sessions/stats?horizonMin=${horizon}&stopPct=${stopPct}&targetR=${targetR}`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, [horizon, stopPct, targetR]);

  useEffect(() => {
    setStudy(null);
    const q = new URLSearchParams({
      timeframe: String(timeframe),
      targetTicks: String(target),
      trendMinutes: String(trendMin),
      trendMode,
      retest,
      requireStack: String(requireStack),
      stopMode,
      targetR: String(studyR),
      // Con velas de un minuto y stop estructural, una hora se queda corta:
      // el riesgo tipico son 28 ticks y hace falta sitio para resolverse.
      horizonMin: timeframe <= 1 ? '120' : '60',
    });

    fetch(`/api/study/patterns?${q.toString()}`)
      .then((r) => r.json())
      .then(setStudy)
      .catch(() => {});
  }, [timeframe, target, trendMin, trendMode, retest, requireStack, stopMode, studyR]);

  return (
    <>
      <div className="panel">
        <h2>Cuanto stop y cuanto objetivo pide cada killzone</h2>

        <div className="filters" style={{ marginBottom: 10 }}>
          <label title="Cuanto tiempo piensas aguantar dentro. El stop crece con el tiempo.">
            Aguanto dentro
            <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
              {[5, 10, 15, 30, 60, 120].map((n) => (
                <option key={n} value={n}>
                  {n >= 60 ? `${n / 60} h` : `${n} min`}
                </option>
              ))}
            </select>
          </label>
          <label title="Cuantas entradas tienen que sobrevivir al ruido de la franja">
            Stop
            <select value={stopPct} onChange={(e) => setStopPct(Number(e.target.value))}>
              <option value={0.5}>ajustado (aguanta 1 de cada 2)</option>
              <option value={0.75}>normal (aguanta 3 de cada 4)</option>
              <option value={0.9}>holgado (aguanta 9 de cada 10)</option>
            </select>
          </label>
          <label title="El objetivo, en multiplos del stop">
            Objetivo
            <select value={targetR} onChange={(e) => setTargetR(Number(e.target.value))}>
              {[0.5, 1, 1.5, 2, 3].map((n) => (
                <option key={n} value={n}>{num(n, n % 1 === 0 ? 0 : 1)} x el stop</option>
              ))}
            </select>
          </label>
          <label>
            Medido en
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              {(['ticks', 'puntos', 'dolares'] as Unit[]).map((u) => (
                <option key={u} value={u}>{UNIT_LABEL[u]}</option>
              ))}
            </select>
          </label>
        </div>

        {!stats ? (
          <div className="empty">calculando...</div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Killzone</th>
                  <th title="Rango mediano de una vela de un minuto: el ruido de la franja">
                    Ruido 1m <span className="note">({UNIT_LABEL[unit]})</span>
                  </th>
                  <th title="La distancia a la que hay que poner el stop para que la franja no te saque">
                    SL <span className="note">({UNIT_LABEL[unit]})</span>
                  </th>
                  <th title="El objetivo, a R veces la distancia del stop">
                    TP <span className="note">({UNIT_LABEL[unit]})</span>
                  </th>
                  <th title="De las entradas que llegaron a tocar uno de los dos, cuantas tocaron el TP primero">
                    Acierto
                  </th>
                  <th title="El acierto que haria falta solo para no perder ni ganar">Necesario</th>
                  <th title="Acabaron sin tocar ni SL ni TP: se cierran a mercado al acabar el tiempo">
                    Sin decidir
                  </th>
                  <th title="Resultado medio por entrada, antes de comisiones y deslizamiento. Separado por sentido para que la deriva del periodo no se lea como ventaja.">
                    Deja de media <span className="note">({UNIT_LABEL[unit]}, compra / venta)</span>
                  </th>
                  <th title="Entradas simuladas en las dos direcciones">Casos</th>
                </tr>
              </thead>
              <tbody>
                {stats.rows.map((r) => (
                  <tr key={r.session} className={r.session === 'NY_AM' ? 'hi' : ''}>
                    <td>{sessionLabel(r.session)}</td>
                    <td>{inUnit(r.barRange, unit, stats.tickSize, stats.tickValue)}</td>
                    <td className="neg">{inUnit(r.suggestedStop, unit, stats.tickSize, stats.tickValue)}</td>
                    <td className="pos">{inUnit(r.suggestedTarget, unit, stats.tickSize, stats.tickValue)}</td>
                    <td className={r.hitRate > r.breakEven ? 'pos' : ''}>
                      {(r.hitRate * 100).toFixed(1)}%
                    </td>
                    <td className="note">{(r.breakEven * 100).toFixed(1)}%</td>
                    <td className="note">{(r.timeoutRate * 100).toFixed(0)}%</td>
                    <td>
                      {/*
                        Solo se colorea lo que pasa de dos veces el margen de error.
                        Pintar de verde un +0,10 $ que tiene un margen de +-1,50 $
                        es ensenar ruido con aspecto de ventaja, y esa es
                        exactamente la forma de enganarse con una tabla.
                      */}
                      <span className={sure(r.longExpectancy, r.expectancyError)}>
                        {signedInUnit(r.longExpectancy, unit, stats.tickSize, stats.tickValue)}
                      </span>
                      <span className="note"> / </span>
                      <span className={sure(r.shortExpectancy, r.expectancyError)}>
                        {signedInUnit(r.shortExpectancy, unit, stats.tickSize, stats.tickValue)}
                      </span>
                      <span className="note">
                        {' '}± {inUnit(r.expectancyError * 2, unit, stats.tickSize, stats.tickValue)}
                      </span>
                    </td>
                    <td>{r.trades.toLocaleString('es')}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="note">
              <p>
                <b>Como se lee una fila.</b> &quot;En {sessionLabel(stats.rows[0]?.session ?? '')},
                si entro y pienso aguantar {stats.horizonMin} minutos, el stop tiene que estar a{' '}
                {inUnit(stats.rows[0]?.suggestedStop ?? 0, unit, stats.tickSize, stats.tickValue)}{' '}
                {unit === 'dolares' ? '$ por contrato' : unit} para que no me saque el vaiven normal
                de la franja, y entonces el objetivo logico esta a{' '}
                {inUnit(stats.rows[0]?.suggestedTarget ?? 0, unit, stats.tickSize, stats.tickValue)}
                &quot;. Las columnas de SL, TP, ruido y esperanza estan todas en la misma unidad, la
                que elijas arriba; los dolares son <b>por un contrato</b>.
              </p>
              <p>
                <b>De donde sale el SL.</b> Sobre {stats.rows[0]?.days ?? 0} dias de velas de{' '}
                {stats.symbol} se toma un punto de entrada cada {stats.stepMin} minutos y se mide
                cuanto se aleja el precio en contra antes de que pasen {stats.horizonMin} minutos.
                El SL es la distancia que{' '}
                {stats.stopPct >= 0.9
                  ? 'solo supera 1 de cada 10 entradas'
                  : stats.stopPct >= 0.75
                    ? 'solo supera 1 de cada 4 entradas'
                    : 'supera la mitad de las entradas'}
                . Sube el mando de arriba y el SL se ensancha; baja el horizonte y se estrecha.
              </p>
              <p>
                <b>El acierto esta medido, no estimado.</b> Con ese SL y ese TP puestos se simulan
                las {stats.rows.reduce((a, r) => a + r.trades, 0).toLocaleString('es')} entradas,
                compra y venta, vela a vela, apuntando cual de los dos se tocó ANTES. Si los dos
                caen dentro de la misma vela de un minuto el caso se descarta, porque sin los ticks
                no se sabe el orden.
              </p>
              <p>
                <b>Ojo con la columna &quot;Sin decidir&quot;.</b> La mayoria de las entradas acaban
                el tiempo sin tocar ni el SL ni el TP, y se cierran a mercado. Por eso el
                &quot;Acierto&quot; esta calculado solo sobre las que SI se decidieron: es el unico
                reparto comparable con la columna &quot;Necesario&quot;. Si lo calculara sobre el
                total saldria un 20% y pareceria un desastre cuando no lo es.
              </p>
              <p>
                Y por eso mismo, &quot;Necesario&quot; es orientativo y no una sentencia:{' '}
                {(() => {
                  const t = stats.rows.reduce((a, r) => a + r.timeoutRate, 0) / (stats.rows.length || 1);
                  return `con un ${(t * 100).toFixed(0)}% de entradas sin decidir`;
                })()}
                , el resultado real no lo marcan solo el SL y el TP, sino tambien a que precio se
                cierran todas esas. Un acierto por debajo del necesario no significa que pierdas
                esa cantidad; significa que el objetivo esta pidiendo mas de lo que esta franja
                suele dar en ese tiempo. <b>Subir el objetivo siempre baja el acierto</b>: lo que
                hay que mirar es si baja mas o menos de lo que sube el premio.
              </p>
              <p>
                <b>Y aqui esta el aviso que importa.</b> Estas entradas son <i>al azar</i>: una cada{' '}
                {stats.stepMin} minutos, sin mirar nada. Con el objetivo a 1 vez el stop, compra y
                venta son espejo exacto y el resultado sale cero clavado — eso no es un hallazgo,
                es la prueba de que la simulacion esta bien hecha. Con otros multiplos deja de ser
                espejo, y entonces aparecen cifras distintas de cero. <b>Casi ninguna significa
                nada</b>, y por eso van en gris: el ± de al lado es el margen de error, y una cifra
                que no lo supera es indistinguible de cero. Ese margen esta calculado contando el{' '}
                <i>solape</i> de las muestras — con una entrada cada {stats.stepMin} minutos y{' '}
                {stats.horizonMin} de horizonte, {Math.round(stats.horizonMin / stats.stepMin)}{' '}
                muestras seguidas miran casi el mismo tramo de mercado, asi que no son{' '}
                {Math.round(stats.horizonMin / stats.stepMin)} casos independientes sino uno.
              </p>
              <p>
                Si alguna llega a salir en color, antes de celebrarlo mira su pareja del otro
                sentido: si esta en el color contrario, lo que ves es que el mercado subio o bajo en
                estos {stats.rows[0]?.days ?? 0} dias, y en el periodo contrario se da la vuelta. Y
                a cualquier numero de esa columna réstale al menos 1 tick de ida y vuelta por
                deslizamiento y comision.
              </p>
              <p>
                <b>Entonces, ¿para que sirve la tabla?</b> No te dice cuando entrar. Te dice{' '}
                <b>de que tamano tiene que ser el stop cuando entres</b>, y cuanto puedes pedirle al
                objetivo sin que sea un deseo. Lo que aporte tu criterio tiene que verse como una
                diferencia contra la columna &quot;Acierto&quot; de aqui: esa es la linea base.
              </p>
              <p>
                <b>Lo que de verdad hay que mirar.</b> La vela de un minuto de NY AM es unas tres
                veces mas grande que la de cualquier otra franja, y el SL que pide va en proporcion.
                Un stop que en Asia te aguanta, en NY AM lo barre el ruido de una sola vela. Si ese
                SL en dolares no te cabe en la cuenta, la salida no es apretarlo: es bajar el
                horizonte, porque lo que no cabe es el <i>tiempo</i> que pensabas estar dentro.
              </p>
              <p className="note">
                Conversion de {stats.symbol}: 1 tick = {num(stats.tickSize, 2)} puntos ={' '}
                {num(stats.tickValue, 2)} $ por contrato · 1 punto = {num(stats.pointValue, 2)} $.
                {' '}Descartadas{' '}
                {stats.rows.reduce((a, r) => a + r.ambiguous, 0).toLocaleString('es')} simulaciones
                por tocar SL y TP en la misma vela.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Patrones a favor de la tendencia</h2>

        <div className="filters" style={{ marginBottom: 10 }}>
          <label title="Como se decide que hay tendencia">
            Tendencia por
            <select value={trendMode} onChange={(e) => setTrendMode(e.target.value)}>
              <option value="rango">avance neto del marco</option>
              <option value="emas">pila de medias (EMA 55/200)</option>
            </select>
          </label>
          {trendMode === 'emas' ? (
            <>
              <label title="Solo cuentan las velas que vuelven a tocar la media y cierran del lado bueno">
                Retest de
                <select value={retest} onChange={(e) => setRetest(e.target.value)}>
                  <option value="ninguno">no exigir retest</option>
                  <option value="ema8">EMA 8</option>
                  <option value="ema21">EMA 21</option>
                  <option value="cualquiera">EMA 8 o EMA 21</option>
                </select>
              </label>
              <label title="Exigir ademas que las cuatro medias esten ordenadas 8 > 21 > 55 > 200">
                <input
                  type="checkbox"
                  checked={requireStack}
                  onChange={(e) => setRequireStack(e.target.checked)}
                />
                {' '}Pila completa
              </label>
            </>
          ) : null}
          <label title="Fijo: la misma distancia siempre. Estructural: al otro lado de la vela de entrada, que es como se opera un retest.">
            Stop
            <select value={stopMode} onChange={(e) => setStopMode(e.target.value)}>
              <option value="fijo">fijo</option>
              <option value="estructural">bajo la vela (estructural)</option>
            </select>
          </label>
          {stopMode === 'estructural' && (
            <label>
              Objetivo
              <select value={studyR} onChange={(e) => setStudyR(Number(e.target.value))}>
                {[1, 1.5, 2, 3].map((n) => (
                  <option key={n} value={n}>{n} R</option>
                ))}
              </select>
            </label>
          )}
          <label
            title="Que vela define la tendencia que se sigue"
            style={{ display: trendMode === 'emas' ? 'none' : undefined }}
          >
            Tendencia de
            <select value={trendMin} onChange={(e) => setTrendMin(Number(e.target.value))}>
              {[15, 60, 240, 1440].map((n) => (
                <option key={n} value={n}>
                  {n >= 1440 ? '1 dia' : n >= 60 ? `${n / 60}h` : `${n}m`}
                </option>
              ))}
            </select>
          </label>
          <label title="La vela cuyo patron se clasifica">
            Vela
            <select value={timeframe} onChange={(e) => setTimeframe(Number(e.target.value))}>
              {[1, 5, 15, 60].map((n) => (
                <option key={n} value={n}>{n >= 60 ? `${n / 60}h` : `${n}m`}</option>
              ))}
            </select>
          </label>
          {stopMode === 'fijo' && (
            <label>
              Objetivo y stop
              <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                {[20, 40, 60, 100].map((n) => <option key={n} value={n}>{n} ticks</option>)}
              </select>
            </label>
          )}
        </div>

        {!study ? (
          <div className="empty">calculando...</div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Patron de la vela</th>
                  <th>Casos</th>
                  <th>Acierto</th>
                  <th title="Puntos porcentuales frente a entrar en cualquier vela">Ventaja</th>
                  <th title="Probabilidad de ver esa diferencia por azar">p</th>
                  <th>¿Aguanta?</th>
                </tr>
              </thead>
              <tbody>
                {/*
                  La fila del azar va ARRIBA del todo y es la que manda. El
                  punto de equilibrio teorico no sirve como vara: ignora el
                  horizonte, los casos sin resolver y la deriva del periodo, y
                  suele quedar un par de puntos por debajo de lo que de verdad
                  da entrar a ciegas.
                */}
                <tr style={{ fontWeight: 600 }}>
                  <td>Entrar AL AZAR, mismo riesgo</td>
                  <td className="note">{study.randomSamples.toLocaleString('es')}</td>
                  <td>{(study.randomBaseline * 100).toFixed(1)}%</td>
                  <td colSpan={3} className="note">
                    la vara de medir · riesgo {study.medianRisk} ticks
                  </td>
                </tr>
                <tr style={{ fontWeight: 600 }}>
                  <td>{study.baseline.label}</td>
                  <td>{study.baseline.samples.toLocaleString('es')}</td>
                  <td>{(study.baseline.hitRate * 100).toFixed(1)}%</td>
                  <td
                    className={
                      study.baseline.hitRate - study.randomBaseline > 0 ? 'pos' : 'neg'
                    }
                  >
                    {((study.baseline.hitRate - study.randomBaseline) * 100).toFixed(1)} pp
                  </td>
                  <td colSpan={2} className="note">
                    el filtro entero, contra el azar
                  </td>
                </tr>
                {study.rows
                  .filter((r) => r.samples >= 50)
                  .map((r) => (
                    <tr key={r.code}>
                      <td>{r.label}</td>
                      <td>{r.samples.toLocaleString('es')}</td>
                      <td>{(r.hitRate * 100).toFixed(1)}%</td>
                      <td className={r.edge > 0 ? 'pos' : r.edge < 0 ? 'neg' : ''}>
                        {r.edge > 0 ? '+' : ''}{r.edge.toFixed(1)} pp
                      </td>
                      <td>{r.pValue.toFixed(3)}</td>
                      <td className={r.pValue < 0.05 ? '' : 'note'}>
                        {r.pValue < 0.05 ? 'quiza' : 'no'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>

            <div className="note">
              <p>
                <b>Lo primero: la fila del azar.</b> Son{' '}
                {study.randomSamples.toLocaleString('es')} entradas en instantes al azar, con el
                mismo riesgo ({study.medianRisk} ticks) y resueltas con el mismo codigo. Es la
                unica vara valida. El &quot;punto de equilibrio&quot; teorico de 1/(1+R) no sirve:
                ignora el horizonte y los casos sin resolver, y suele quedar un par de puntos por
                debajo de lo que de verdad da entrar a ciegas. La segunda fila dice si tu filtro
                bate a esa vara; las de abajo, si el dibujo de la vela anade algo <i>dentro</i> del
                filtro.
              </p>
              {study.trendMode === 'emas' ? (
                <p>
                  <b>Que es aqui &quot;a favor de la tendencia&quot;.</b> La EMA 55 por encima de
                  la 200 y el precio por encima de la 55 (o al reves para cortos), calculadas sobre
                  las velas de {study.timeframe >= 60 ? `${study.timeframe / 60}h` : `${study.timeframe}m`}{' '}
                  del propio estudio.
                  {study.requireStack && ' Ademas se exige la pila completa 8 > 21 > 55 > 200.'}
                  {study.retest !== 'ninguno' && (
                    <>
                      {' '}Y la vela tiene que <b>retestear</b>{' '}
                      {study.retest === 'cualquiera' ? 'la EMA 8 o la EMA 21' : `la ${study.retest.toUpperCase().replace('EMA', 'EMA ')}`}
                      : tocarla por dentro y <i>cerrar del lado bueno</i>. Cerrar al otro lado no es
                      un retest, es perder el nivel, y mezclarlos emborrona lo que se mide.
                    </>
                  )}
                </p>
              ) : (
              <p>
                <b>Que es exactamente &quot;a favor de la tendencia&quot;.</b> Se miran las{' '}
                {study.trendLookback} ultimas velas <b>ya cerradas</b> del marco de referencia (
                {study.trendMinutes >= 1440 ? '1 dia' : study.trendMinutes >= 60 ? `${study.trendMinutes / 60} horas` : `${study.trendMinutes} minutos`}
                ) y se calcula el avance neto dividido entre el rango recorrido. Por debajo de 0,30
                es rango y el caso se descarta. No es un rompimiento, ni un gatillo, ni la vela
                anterior: es la direccion acumulada de esas velas.
              </p>
              )}
              <p>
                <b>El patron NO dispara la entrada.</b> Esto es lo que mas confunde de esta tabla y
                conviene leerlo despacio: se simula entrar <i>en cada vela cerrada</i>, siempre en
                la direccion de la tendencia, mire lo que mire la vela. El patron solo sirve para
                AGRUPAR los resultados despues. La pregunta que responde no es &quot;¿funciona
                entrar con un martillo?&quot;, es &quot;de todas las entradas a favor de la
                tendencia, ¿las que venian detras de un martillo salieron mejor?&quot;.
              </p>
              <p>
                {study.stopMode === 'estructural' ? (
                  <>
                    El stop va <b>al otro lado de la vela de entrada</b>, mas dos ticks de colchon —
                    que es donde lo pone quien opera un retest: si el precio vuelve a pasar por ahi,
                    la lectura era falsa. El objetivo esta a <b>{study.targetR} R</b> de esa
                    distancia. El riesgo tipico sale en <b>{study.medianRisk} ticks</b>, y es el
                    mismo que usa la fila del azar para que la comparacion sea limpia.
                  </>
                ) : (
                  <>
                    Objetivo y stop son <b>{study.targetTicks} ticks</b> a cada lado.
                  </>
                )}
                {' '}Se apunta cual se tocó antes dentro de {study.horizonMin} minutos. Si los dos
                caen en la misma vela no se cuenta, porque sin los ticks no se sabe cual fue
                primero.
              </p>
              <p>
                <b>Las columnas no son ticks.</b> <i>Casos</i> es cuantas veces paso,{' '}
                <i>Acierto</i> el porcentaje que toco objetivo antes que stop, <i>Ventaja</i> la
                diferencia en puntos porcentuales contra la linea base, y <i>p</i> la probabilidad
                de ver esa diferencia por azar. Los unicos ticks aqui son los del riesgo
                ({study.medianRisk}) y su objetivo.
              </p>
              <p>
                <b>Como se lee el resultado del filtro.</b> Con estos ajustes, tu filtro acierta el{' '}
                {(study.baseline.hitRate * 100).toFixed(1)}% y entrar al azar con el mismo riesgo
                acierta el {(study.randomBaseline * 100).toFixed(1)}%. La diferencia es{' '}
                <b>{((study.baseline.hitRate - study.randomBaseline) * 100).toFixed(1)} puntos</b>.
                Si sale negativa, el filtro esta eligiendo PEOR que no elegir — y conviene saberlo
                antes de operarlo, no despues.
              </p>
              <p>
                Las columnas <i>Ventaja</i> y <b>p</b> de las filas de patrones se miden contra la
                linea base del propio filtro, no contra el azar: responden a &quot;dentro de mis
                entradas, ¿las que traian este dibujo salieron mejor?&quot;. Por encima de 0,05 no
                hay nada, y se comprueban varios patrones a la vez, asi que un solo{' '}
                &quot;quiza&quot; suelto no es un hallazgo.
              </p>
              <p>
                {study.rows.filter((r) => r.samples >= 50 && r.pValue < 0.05).length === 0 ? (
                  <>
                    Con estos ajustes <b>ningun patron aguanta la prueba</b>. La tendencia da por
                    si sola lo que diga la linea base, y el dibujo de la vela no anade nada medible
                    encima.
                  </>
                ) : (
                  <>
                    Ojo con el &quot;quiza&quot;: se comprueban diez patrones a la vez, y a ese
                    ritmo sale un p por debajo de 0,05 por pura casualidad cada dos tablas. Un solo
                    patron marcado no es un hallazgo; lo seria si repitiera al cambiar el objetivo
                    o la temporalidad.
                  </>
                )}
              </p>
              <p className="note">
                {study.skippedRange.toLocaleString('es')} velas quedaron fuera{' '}
                {study.trendMode === 'emas'
                  ? 'por no cumplir los filtros (sin regimen, sin retest o riesgo absurdo)'
                  : 'por tener el marco de referencia en rango'}
                , y {study.unresolved.toLocaleString('es')} sin resolver dentro del horizonte.
              </p>
            </div>
          </>
        )}
      </div>

      <GridPanel />
    </>
  );
}
