import { useState } from 'react';
import type { Dashboard, Group } from '../api';
import { dateTime, pct, signClass, signedUsd, usd } from '../format';

interface Tip {
  x: number;
  y: number;
  html: string;
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: tip.x + 14,
        top: tip.y + 14,
        background: '#080a0e',
        border: '1px solid var(--line)',
        borderRadius: 6,
        padding: '7px 9px',
        fontSize: 12,
        pointerEvents: 'none',
        zIndex: 10,
        whiteSpace: 'nowrap',
      }}
      dangerouslySetInnerHTML={{ __html: tip.html }}
    />
  );
}

/** Curva de capital. Una sola serie, asi que no lleva leyenda: el titulo la nombra. */
export function EquityChart({ points }: { points: Dashboard['equity'] }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (!points.length) return <div className="empty">sin datos</div>;

  const W = 900, H = 200, P = { t: 12, r: 52, b: 18, l: 8 };
  const vals = points.map((p) => p.equity);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const span = max - min || 1;
  const x = (i: number) => P.l + (i / Math.max(1, points.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - min) / span) * (H - P.t - P.b);

  const last = points[points.length - 1]!.equity;
  const stroke = last >= 0 ? 'var(--up)' : 'var(--down)';
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');

  return (
    <>
      <svg height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        onMouseLeave={() => { setTip(null); setHover(null); }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let i = Math.round(((px - P.l) / (W - P.l - P.r)) * (points.length - 1));
          i = Math.max(0, Math.min(points.length - 1, i));
          const p = points[i]!;
          setHover(i);
          setTip({
            x: e.clientX, y: e.clientY,
            html:
              `<b>${dateTime(p.ts)}</b>` +
              `<br>Esta operacion: <span class="${signClass(p.pnl)}">${signedUsd(p.pnl)}</span> USD` +
              `<br>Acumulado: <span class="${signClass(p.equity)}">${signedUsd(p.equity)}</span> USD`,
          });
        }}
      >
        <line x1={P.l} y1={y(0)} x2={W - P.r} y2={y(0)} className="axis" strokeDasharray="3 3" />
        <text x={W - P.r + 6} y={y(0) + 3} className="axis-text">$0</text>
        <text x={W - P.r + 6} y={y(max) + 3} className="axis-text">{usd(max, 0)}</text>
        {min < 0 && <text x={W - P.r + 6} y={y(min) + 3} className="axis-text">{usd(min, 0)}</text>}
        <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <>
            <line x1={x(hover)} y1={P.t} x2={x(hover)} y2={H - P.b} stroke="var(--ink-muted)" strokeWidth={1} opacity={0.5} />
            <circle cx={x(hover)} cy={y(points[hover]!.equity)} r={4} fill={stroke} stroke="var(--panel)" strokeWidth={2} />
          </>
        )}
      </svg>
      <Tooltip tip={tip} />
    </>
  );
}

/**
 * Barras divergentes alrededor del cero. El color refuerza el signo, que ademas
 * va escrito al lado de cada barra: la identidad nunca depende solo del color.
 */
/**
 * El mismo grafico de barras, pero quedandose con los N ultimos grupos.
 *
 * Existe para la vista por fecha, que es la unica que crece sin tope: hoy son
 * siete dias y dentro de un ano son doscientos cincuenta, y un grafico de
 * doscientas cincuenta barras no se lee. Se muestran los mas RECIENTES, que
 * son los que importan, y el selector permite abrir la ventana cuando hace
 * falta mirar atras.
 *
 * No lleva paginacion a proposito: pasar paginas hacia atras en un grafico de
 * barras obliga a recordar lo de la pagina anterior para comparar. Alargar la
 * ventana enseña todo junto, que es como se compara de verdad.
 */
export function RecentBarsChart({
  rows,
  label,
  defaultCount = 7,
}: {
  rows: Group[];
  label: (k: string | number) => string;
  defaultCount?: number;
}) {
  const [count, setCount] = useState(defaultCount);

  const total = rows.length;
  const shown = count >= total ? rows : rows.slice(total - count);

  return (
    <>
      <div className="filters" style={{ marginBottom: 8 }}>
        <label>
          Ultimos
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[7, 14, 30, 60, 90].map((n) => (
              <option key={n} value={n}>{n} dias</option>
            ))}
            <option value={100000}>todos</option>
          </select>
        </label>
        <span className="note">
          {total <= count
            ? `${total} con operaciones`
            : `mostrando ${shown.length} de ${total} con operaciones`}
        </span>
      </div>

      <BarsChart rows={shown} label={label} />
    </>
  );
}

export function BarsChart({ rows, label }: { rows: Group[]; label: (k: string | number) => string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  if (!rows.length) return <div className="empty">sin datos</div>;

  const W = 440, rowH = 24, P = { t: 6, l: 74, r: 74 };
  const H = Math.max(rows.length * rowH + P.t, 60);
  const bound = Math.max(1, ...rows.map((r) => Math.abs(r.summary.grossPnl)));
  const plotW = W - P.l - P.r;
  const zero = P.l + plotW / 2;

  return (
    <>
      <svg height={H} viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setTip(null)}>
        <line x1={zero} y1={P.t} x2={zero} y2={H} className="axis" />
        {rows.map((r, i) => {
          const v = r.summary.grossPnl;
          const w = Math.max(Math.abs((v / bound) * (plotW / 2)), 1);
          const top = P.t + i * rowH + 4;
          const h = rowH - 10;
          return (
            <g key={String(r.key)}>
              <text x={P.l - 8} y={top + h - 2} className="axis-text" textAnchor="end">{label(r.key)}</text>
              <rect
                x={v >= 0 ? zero + 1 : zero - w - 1} y={top} width={w} height={h} rx={3}
                fill={v >= 0 ? 'var(--up)' : 'var(--down)'} opacity={0.85}
                onMouseMove={(e) => setTip({
                  x: e.clientX, y: e.clientY,
                  html:
                    `<b>${label(r.key)}</b>` +
                    `<br>Resultado bruto: <span class="${signClass(v)}">${signedUsd(v)}</span> USD` +
                    `<br>${r.summary.operations} operaciones · ${r.summary.wins} ganadoras / ${r.summary.losses} perdedoras` +
                    `<br>${r.summary.longs} en compra · ${r.summary.shorts} en venta` +
                    `<br>Acierto ${pct(r.summary.winRate)}`,
                })}
              />
              <text x={W - P.r + 6} y={top + h - 2} className="axis-text">{usd(v, 0)}</text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </>
  );
}
