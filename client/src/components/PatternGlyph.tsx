/**
 * Dibujito de cada patron de vela, para no tener que imaginarselo.
 *
 * Las medidas no son decorativas: cada vela se describe con los mismos numeros
 * que usa `pattern.ts` para clasificar, de modo que el dibujo CUMPLE la regla
 * que ilustra. Un martillo de adorno con la mecha corta enseñaria algo que el
 * codigo no llamaria martillo, y entonces el dibujo estaria mintiendo.
 *
 * Se dibuja en SVG y no con imagenes por dos razones: pesa cero, y hereda el
 * color del tema en vez de traer un fondo blanco pegado.
 */

interface Candle {
  /** Todo en la misma escala arbitraria 0..100, donde 100 es arriba. */
  high: number;
  low: number;
  open: number;
  close: number;
}

const UP = '#16a47c';
const DOWN = '#d1483a';

/** Cada patron como las dos velas que lo definen: la anterior y la clasificada. */
const SHAPES: Record<string, { prev?: Candle; last: Candle; note?: string }> = {
  // Perfora el minimo anterior y cierra por encima de el.
  barrido_alcista: {
    prev: { high: 78, low: 40, open: 70, close: 48 },
    last: { high: 72, low: 22, open: 46, close: 66 },
    note: 'minimo',
  },
  // Perfora el maximo anterior y cierra por debajo de el.
  barrido_bajista: {
    prev: { high: 60, low: 22, open: 30, close: 52 },
    last: { high: 78, low: 28, open: 54, close: 34 },
    note: 'maximo',
  },
  // El cuerpo se come entero el de la vela anterior, en sentido contrario.
  // Importante: no puede bajar del minimo anterior ni superar su maximo
  // cerrando por debajo. Si lo hiciera, el clasificador la llamaria barrido,
  // que va ANTES en el orden de comprobaciones, y el dibujo estaria enseñando
  // una cosa con el nombre de otra. Comprobado pasando estas medidas por el
  // mismo clasificador.
  envolvente: {
    prev: { high: 62, low: 42, open: 58, close: 46 },
    last: { high: 64, low: 43, open: 44, close: 62 },
  },
  // Mecha inferior >= medio rango, cuerpo <= un tercio, mecha superior minima.
  martillo: {
    last: { high: 76, low: 20, open: 62, close: 70 },
  },
  // El espejo del martillo.
  estrella: {
    last: { high: 80, low: 24, open: 34, close: 26 },
  },
  // Entera dentro del rango de la anterior.
  interior: {
    prev: { high: 82, low: 20, open: 30, close: 72 },
    last: { high: 68, low: 36, open: 44, close: 60 },
  },
  // Cuerpo que ocupa casi todo el rango.
  cuerpo_completo: {
    last: { high: 80, low: 22, open: 26, close: 76 },
  },
  // Abre y cierra casi en el mismo sitio.
  doji: {
    last: { high: 80, low: 22, open: 52, close: 50 },
  },
  normal: {
    last: { high: 74, low: 28, open: 40, close: 60 },
  },
  plana: {
    last: { high: 50, low: 50, open: 50, close: 50 },
  },
};

function Bar({ c, x, width }: { c: Candle; x: number; width: number }) {
  const y = (v: number) => 100 - v;
  const top = Math.max(c.open, c.close);
  const bottom = Math.min(c.open, c.close);
  const color = c.close >= c.open ? UP : DOWN;

  // Cuerpo con altura minima: un doji con cuerpo cero no se veria, y el punto
  // del doji es justamente que el cuerpo es casi nada, no que no exista.
  const bodyHeight = Math.max(1.5, top - bottom);

  return (
    <g>
      <line x1={x + width / 2} x2={x + width / 2} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={1.4} />
      <rect x={x} y={y(top)} width={width} height={bodyHeight} fill={color} rx={0.6} />
    </g>
  );
}

export function PatternGlyph({ code, size = 42 }: { code: string; size?: number }) {
  const shape = SHAPES[code] ?? SHAPES.normal!;
  const two = Boolean(shape.prev);

  // Con dos velas el lienzo es mas ancho, para que no salgan aplastadas.
  const viewWidth = two ? 56 : 32;

  const width = two ? size * 1.35 : size * 0.8;

  return (
    <svg
      width={width}
      height={size}
      viewBox={`0 0 ${viewWidth} 100`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      /* El ancho va tambien en el estilo, no solo en el atributo: la hoja de
         estilos tiene un `svg { width: 100% }` global para los graficos del
         panel, y sin esto el dibujo se estiraba hasta ocupar toda la celda y
         empujaba el nombre encima de la columna siguiente. */
      style={{ display: 'block', flexShrink: 0, width, height: size }}
    >
      {/* La referencia que el patron rompe o respeta: el nivel de la vela
          anterior del que habla la definicion. Sin esta linea, "perforo el
          minimo anterior" hay que deducirlo comparando alturas a ojo. */}
      {shape.prev && shape.note === 'minimo' && (
        <line x1={0} x2={viewWidth} y1={100 - shape.prev.low} y2={100 - shape.prev.low}
              stroke="#8891a6" strokeWidth={0.8} strokeDasharray="3 2" />
      )}
      {shape.prev && shape.note === 'maximo' && (
        <line x1={0} x2={viewWidth} y1={100 - shape.prev.high} y2={100 - shape.prev.high}
              stroke="#8891a6" strokeWidth={0.8} strokeDasharray="3 2" />
      )}

      {shape.prev && <Bar c={shape.prev} x={6} width={14} />}
      <Bar c={shape.last} x={two ? 32 : 9} width={14} />
    </svg>
  );
}
