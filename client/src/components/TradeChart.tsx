import { createChart, ColorType, CrosshairMode, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import type { Replay } from '../api';
import { marketOffsetAt } from '../format';

/**
 * Grafico de una operacion: velas, donde entraste, donde saliste, y el delta de
 * cada vela debajo.
 *
 * Las velas no se guardan por operacion, se recortan al vuelo de la tabla de
 * velas que ya alimenta el indicador. Lo que ves aqui es lo mismo que tenias
 * delante, no una reconstruccion aproximada.
 */

const MINUTE = 60;

/**
 * Colores de cada killzone, los mismos que usa KillZones en el grafico de
 * Quantower. Si alli cambian, aqui tambien: la gracia de pintarlas es reconocer
 * de un vistazo la misma franja que veias al operar.
 */
const SESSION_COLOR: Record<string, string> = {
  ASIA: '45, 125, 210',
  LONDON: '214, 88, 74',
  NY_AM: '64, 170, 160',
  NY_LUNCH: '196, 132, 48',
  NY_PM: '150, 96, 196',
};

const SESSION_NAME: Record<string, string> = {
  ASIA: 'Asia',
  LONDON: 'Londres',
  NY_AM: 'NY AM',
  NY_LUNCH: 'NY Lunch',
  NY_PM: 'NY PM',
};

/**
 * lightweight-charts dibuja los tiempos en UTC y no deja cambiar la zona. El
 * truco estandar es desplazar el propio timestamp: asi la hora que aparece en el
 * eje es la de mercado, igual que en el resto de la aplicacion y que en
 * Quantower mientras operabas.
 */
function toChartTime(ms: number): UTCTimestamp {
  // Por marca de tiempo y no con un desfase unico: una ventana que cruce el
  // cambio de hora quedaria con media mitad corrida respecto a la otra.
  return Math.floor((ms + marketOffsetAt(ms) * 3600_000) / 1000) as UTCTimestamp;
}

export function TradeChart({ data, offsetHours }: { data: Replay; offsetHours: number }) {
  const [showSessions, setShowSessions] = useState(true);
  const box = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#11141b' },
        textColor: '#9aa3b2',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.1)',
        // Aire arriba y abajo. Sin margenes las velas tocan los bordes y el
        // grafico se lee apretado aunque el numero de velas sea el correcto.
        scaleMargins: { top: 0.12, bottom: 0.34 },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.1)',
        timeVisible: true,
        secondsVisible: false,
        // Hueco despues de la ultima vela, para que no quede pegada al eje.
        rightOffset: 6,
      },
      // Sin alto fijo: autoSize observa el contenedor, asi que el alto lo manda
      // el CSS y ademas se reajusta solo al cambiar el tamano de la ventana.
      autoSize: true,
    });

    chartRef.current = chart;

    const candles = chart.addCandlestickSeries({
      upColor: '#2ecc71',
      downColor: '#e74c3c',
      borderUpColor: '#2ecc71',
      borderDownColor: '#e74c3c',
      wickUpColor: '#2ecc71',
      wickDownColor: '#e74c3c',
    });

    // El delta va como serie superpuesta en el 25% inferior, no en un panel
    // aparte: asi cada barra de delta queda alineada en vertical con su vela y
    // se puede leer la relacion de un vistazo.
    const delta = chart.addHistogramSeries({
      priceScaleId: 'delta',
      priceFormat: { type: 'volume' },
    });

    chart.priceScale('delta').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    candles.setData(
      data.bars.map((b) => ({
        time: toChartTime(b.ts),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
      })),
    );

    delta.setData(
      data.bars.map((b) => ({
        time: toChartTime(b.ts),
        value: b.delta ?? 0,
        color: (b.delta ?? 0) >= 0 ? 'rgba(46,204,113,0.55)' : 'rgba(231,76,60,0.55)',
      })),
    );

    // Cada ejecucion en su vela. Si hubo entradas parciales se ven todas, que es
    // justo donde se suele ver si promediaste a la baja sin querer.
    const markers = data.fills.map((f) => {
      const buy = f.side === 0;
      return {
        time: toChartTime(f.ts),
        position: (buy ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
        color: buy ? '#2ecc71' : '#e74c3c',
        shape: (buy ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
        text: `${buy ? 'C' : 'V'} ${f.quantity}`,
      };
    });

    candles.setMarkers(markers);

    const op = data.operation;

    candles.createPriceLine({
      price: op.entry_price,
      color: '#5aaaff',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: 'entrada',
    });

    candles.createPriceLine({
      price: op.exit_price,
      color: op.netPnl >= 0 ? '#2ecc71' : '#e74c3c',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: 'salida',
    });

    // Las killzones van como una capa de fondo dibujada a mano sobre el canvas
    // del grafico. lightweight-charts no tiene rectangulos por tiempo, y la
    // alternativa (una serie de area por sesion) obligaria a inventar valores de
    // precio que luego ensucian la escala.
    const overlay = document.createElement('div');
    overlay.className = 'kz-overlay';
    el.appendChild(overlay);

    /**
     * Los bordes se anclan a velas REALES, no al instante exacto en que empieza
     * o acaba la killzone.
     *
     * timeToCoordinate solo sabe convertir tiempos que existen en la serie:
     * para cualquier otro devuelve null. El final de la caja se recorta al
     * final de la ventana, que es la hora de cierre de la operacion mas unos
     * minutos, y eso cae en un segundo cualquiera (14:33:42) donde no hay vela.
     * Resultado: x2 era null y NO SE DIBUJABA NINGUNA CAJA. Buscando la primera
     * y la ultima vela dentro del tramo siempre se pregunta por un tiempo que
     * el grafico conoce.
     */
    const times = data.bars.map((b) => b.ts);

    const firstAtOrAfter = (ms: number) => {
      let lo = 0;
      let hi = times.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid]! >= ms) { found = mid; hi = mid - 1; } else lo = mid + 1;
      }
      return found;
    };

    const lastAtOrBefore = (ms: number) => {
      let lo = 0;
      let hi = times.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid]! <= ms) { found = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return found;
    };

    const hhmm = (ms: number) =>
      new Date(ms + marketOffsetAt(ms) * 3600_000).toISOString().slice(11, 16);

    const drawSessions = () => {
      overlay.innerHTML = '';
      if (!showSessions) return;

      const ts = chart.timeScale();
      // Media vela a cada lado, para que la caja empiece en el BORDE de la
      // vela y no en su centro: si no, la primera vela de la sesion queda
      // partida por la mitad.
      const half = ts.options().barSpacing / 2;

      for (const s of data.sessions) {
        const color = SESSION_COLOR[s.name];
        if (!color) continue;

        const i1 = firstAtOrAfter(s.from);
        const i2 = lastAtOrBefore(s.to);
        if (i1 < 0 || i2 < 0 || i2 < i1) continue;

        const x1 = ts.timeToCoordinate(toChartTime(times[i1]!));
        const x2 = ts.timeToCoordinate(toChartTime(times[i2]!));
        if (x1 === null || x2 === null) continue;

        const left = Math.min(x1, x2) - half;
        const width = Math.max(2, Math.abs(x2 - x1) + half * 2);

        // Si la killzone sigue mas alla del borde del grafico, ese lado se
        // dibuja sin raya: asi se distingue de un vistazo "aqui acaba la
        // sesion" de "aqui se acaba lo que estas viendo".
        const openLeft = s.fullFrom < times[0]!;
        const openRight = s.fullTo > times[times.length - 1]!;

        const box = document.createElement('div');
        box.className = 'kz-box';
        box.style.left = `${left}px`;
        box.style.width = `${width}px`;
        box.style.background = `rgba(${color}, 0.09)`;
        if (!openLeft) box.style.borderLeft = `1px solid rgba(${color}, 0.5)`;
        if (!openRight) box.style.borderRight = `1px solid rgba(${color}, 0.5)`;
        box.title = `${SESSION_NAME[s.name] ?? s.name} · ${hhmm(s.fullFrom)} a ${hhmm(s.fullTo)} hora de mercado`;

        const label = document.createElement('span');
        label.textContent =
          (SESSION_NAME[s.name] ?? s.name) + (openLeft || openRight ? ' ›' : '');
        label.style.color = `rgba(${color}, 0.95)`;
        box.appendChild(label);

        overlay.appendChild(box);
      }
    };

    const scale = chart.timeScale();
    scale.fitContent();

    // fitContent estira las velas hasta llenar el ancho: con 69 velas en una
    // pantalla ancha salen de 24 px y el grafico se ve abarrotado, que es
    // justo la sensacion de "muy lleno". Limitando la separacion, la vela
    // mantiene un grosor normal y lo que sobra queda como espacio libre.
    //
    // Si las velas ya salian mas finas que el limite no se toca nada: eso pasa
    // al pedir ventanas largas, y ahi estirarlas seria ir en contra.
    const MAX_BAR_SPACING = 9;

    if (scale.options().barSpacing > MAX_BAR_SPACING) {
      scale.applyOptions({ barSpacing: MAX_BAR_SPACING });

      // Al estrechar las velas el grafico se queda anclado al final. Se
      // recentra en la entrada, que es lo que se viene a mirar.
      const entryIndex = data.bars.findIndex((b) => b.ts >= Number(op.opened_at));
      if (entryIndex >= 0) {
        const visible = Math.floor((el.clientWidth || 900) / MAX_BAR_SPACING);
        const from = Math.max(0, entryIndex - Math.floor(visible * 0.55));
        scale.setVisibleLogicalRange({ from, to: from + visible });
      }
    }

    drawSessions();

    // Al desplazar o hacer zoom, las cajas tienen que seguir a las velas.
    const onRange = () => drawSessions();
    scale.subscribeVisibleLogicalRangeChange(onRange);

    return () => {
      scale.unsubscribeVisibleLogicalRangeChange(onRange);
      overlay.remove();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, offsetHours, showSessions]);

  if (data.bars.length === 0) {
    return (
      <div className="empty">
        No hay velas capturadas para esta operacion. Pasa cuando operaste con
        &quot;Guardar contexto para el diario&quot; apagado en j_Flujo, o en un simbolo que no estabas
        graficando.
      </div>
    );
  }

  return (
    <>
      <div ref={box} className="chart-box" />
      <div className="op-meta">
        <label className="kz-toggle">
          <input type="checkbox" checked={showSessions} onChange={(e) => setShowSessions(e.target.checked)} />
          killzones
        </label>
        {' · '}
        {data.bars.length} velas de {data.symbol} · ventana {data.coverage.before} min antes y{' '}
        {data.coverage.after} despues
        {data.coverage.found < data.coverage.expected * 0.7 && (
          <> · <span style={{ color: '#f1c40f' }}>faltan velas en la captura de ese tramo</span></>
        )}
      </div>
    </>
  );
}

/** Serie tipada solo para que TypeScript no se queje del ref sin usar. */
export type _Unused = ISeriesApi<'Candlestick'>;
