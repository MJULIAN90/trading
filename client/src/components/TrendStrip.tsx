import type { TrendRead, TrendSnapshot } from '../api';

/**
 * Como estaban los marcos grandes cuando abriste: semanal, diaria y 4h.
 *
 * Se ensena el cociente junto a la etiqueta a proposito. "Alcista" sin numero
 * no se puede comprobar; "alcista +0,68" si: significa que el avance neto fue
 * el 68% de todo el rango recorrido en esas velas, y eso se ve en el grafico.
 */

const COLOR: Record<TrendRead['label'], string> = {
  ALCISTA: '#16a47c',
  BAJISTA: '#d1483a',
  RANGO: '#8a93a6',
};

function Cell({ title, lookback, read, direction }: {
  title: string;
  lookback: string;
  read: TrendRead | null;
  direction: string;
}) {
  if (!read) {
    return (
      <div className="trend-cell">
        <div className="trend-k">{title}</div>
        <div className="trend-v" style={{ color: 'var(--ink-muted)' }}>sin historico</div>
        <div className="trend-n">hacen falta {lookback}</div>
      </div>
    );
  }

  const expected = direction === 'LONG' ? 'ALCISTA' : 'BAJISTA';
  const align =
    read.label === 'RANGO' ? 'en rango' : read.label === expected ? 'a favor' : 'en contra';

  return (
    <div className="trend-cell" title={`${read.candles} velas, de ${read.low} a ${read.high}`}>
      <div className="trend-k">{title}</div>
      <div className="trend-v" style={{ color: COLOR[read.label] }}>
        {read.label === 'RANGO' ? 'Rango' : read.label === 'ALCISTA' ? 'Alcista' : 'Bajista'}
        {read.strength === 'debil' && <span className="trend-weak"> débil</span>}
      </div>
      <div className="trend-n">
        {read.ratio >= 0 ? '+' : ''}{read.ratio.toFixed(2)} · entraste <b>{align}</b>
        <br />
        precio en el {Math.round(read.position * 100)}% del rango
      </div>
    </div>
  );
}

export function TrendStrip({ trend, direction }: { trend: TrendSnapshot; direction: string }) {
  return (
    <div className="trend-strip">
      <div className="trend-row">
        <Cell title="Semanal" lookback="4 semanas" read={trend.weekly} direction={direction} />
        <Cell title="Diaria" lookback="20 días" read={trend.daily} direction={direction} />
        <Cell title="4 horas" lookback="30 velas de 4h" read={trend.h4} direction={direction} />
      </div>
      <div className="note">
        El número es el <b>avance neto dividido entre el rango recorrido</b> en esas velas. Por
        debajo de 0,30 se llama rango: el precio se movió mucho y acabó donde empezó. Por encima de
        0,60, tendencia clara. El día de futuros empieza a las 18:00 hora de mercado, como en
        Quantower, y solo entran velas ya cerradas antes de tu entrada.
        <br />
        <b>Ojo con sacar conclusiones todavía</b>: tus 94 operaciones reales cayeron todas en 4h
        bajista, así que hoy «a favor de la 4h» y «corto» son la misma cosa. Esta columna empezará a
        decir algo cuando operes en otro régimen.
      </div>
    </div>
  );
}
