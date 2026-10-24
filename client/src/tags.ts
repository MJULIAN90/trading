/**
 * Como se califica y se ordena una etiqueta. En un solo sitio a proposito.
 *
 * Esto lo usan tres pantallas: el panel de notas, el listado de operaciones y
 * los ajustes. Si cada una decidiera por su cuenta que es "buena", la misma
 * etiqueta podria salir verde en una y roja en otra, y el color dejaria de
 * significar nada.
 *
 * LO IMPORTANTE, Y ES UNA DISTINCION QUE NO SE PUEDE PERDER:
 *
 *   La polaridad es lo que JULIAN CREE. Es una hipotesis.
 *   El impacto medido es lo que SUS OPERACIONES DICEN. Es el dato.
 *
 * Se guardan separados y se ensenan juntos. Asi, el dia que una etiqueta
 * marcada como "mala" resulte no costar dinero, se ve. Este proyecto ya ha
 * cerrado tres hipotesis que parecian obvias y no estaban: los order blocks,
 * los toques de EMA y la manipulacion en la apertura de Nueva York.
 */

export type Polarity = 'buena' | 'mala' | 'neutra';

export type PolarityMap = Record<string, 'buena' | 'mala'>;

/** Lo que no esta en el mapa es neutro. La mayoria de las etiquetas lo son. */
export function polarityOf(tag: string, map: PolarityMap | undefined): Polarity {
  return map?.[tag] ?? 'neutra';
}

/** Clase CSS del color. Vacia para las neutras: se quedan con el estilo base. */
export function polarityClass(p: Polarity): string {
  return p === 'neutra' ? '' : p;
}

/** Orden dentro de un bloque: buenas, neutras, malas. */
const RANK: Record<Polarity, number> = { buena: 0, neutra: 1, mala: 2 };

/**
 * Buenas arriba, malas abajo, y dentro de cada grupo por orden alfabetico.
 *
 * El alfabetico importa mas de lo que parece: una lista que se reordena sola
 * segun cuantas veces usaste cada etiqueta obliga a leerla entera cada vez.
 * Con un orden fijo, la mano acaba sabiendo donde esta cada una.
 */
export function sortByPolarity(tags: string[], map: PolarityMap | undefined): string[] {
  return [...tags].sort((a, b) => {
    const ra = RANK[polarityOf(a, map)];
    const rb = RANK[polarityOf(b, map)];
    return ra - rb || a.localeCompare(b, 'es');
  });
}

/** Las etiquetas de un bloque concreto, ya ordenadas. */
export function tagsOfPolarity(
  tags: string[],
  map: PolarityMap | undefined,
  want: Polarity,
): string[] {
  return tags.filter((t) => polarityOf(t, map) === want).sort((a, b) => a.localeCompare(b, 'es'));
}

export const POLARITY_LABEL: Record<Polarity, string> = {
  buena: 'Conductas buenas',
  neutra: 'Sin calificar',
  mala: 'Conductas malas',
};

// ---------------------------------------------------------------- ejes

export type Kind = 'estrategia' | 'contexto' | 'conducta';

export type KindMap = Record<string, 'estrategia' | 'contexto'>;

/** Lo que no esta en el mapa es conducta. Es el caso mayoritario. */
export function kindOf(tag: string, map: KindMap | undefined): Kind {
  return map?.[tag] ?? 'conducta';
}

export const KIND_LABEL: Record<Kind, string> = {
  estrategia: 'Estrategia',
  contexto: 'Contexto del mercado',
  conducta: 'Conducta',
};

export const KIND_HELP: Record<Kind, string> = {
  estrategia: 'Que clase de operacion era. La eliges tu antes de entrar. Solo una por operacion.',
  contexto: 'Que habia en el mercado. Te lo encuentras, no lo decides.',
  conducta: 'Que hiciste tu dentro de eso. Es la unica que puede ser buena o mala.',
};

export const KINDS: Kind[] = ['estrategia', 'contexto', 'conducta'];

/**
 * La polaridad SOLO significa algo en conducta.
 *
 * Una estrategia no es buena ni mala: es una forma de operar, y dentro de ella
 * se puede ejecutar bien o fatal. Pintar "scalper" de rojo diria que hacer
 * scalping esta mal, que no es lo que se quiere decir nunca.
 */
export function polarityApplies(tag: string, kinds: KindMap | undefined): boolean {
  return kindOf(tag, kinds) === 'conducta';
}

/**
 * La clase de color de una etiqueta, decidida en UN solo sitio.
 *
 * Tres resultados posibles y cada uno dice algo distinto:
 *
 *   'buena' / 'mala'  solo en conducta, y solo si Julian la ha calificado.
 *   'estrategia'      azul. Lo que decidiste tu antes de entrar.
 *   'contexto'        naranja. Lo que te encontraste y no elegiste.
 *   ''                conducta sin calificar. Gris de fabrica.
 *
 * Ni el azul ni el naranja comparten paleta con el verde y el rojo, y eso es
 * deliberado: el verde y el rojo JUZGAN -esto lo hiciste bien, esto mal-, y ni
 * una estrategia ni un contexto se juzgan. Dicen que clase de operacion era y
 * que habia en el mercado.
 *
 * Antes cada pantalla escribia a mano el mismo ternario de dos ramas, y las
 * de estrategia acababan grises e indistinguibles de las neutras.
 */
export function tagClass(
  tag: string,
  polarity: PolarityMap | undefined,
  kinds: KindMap | undefined,
): string {
  const eje = kindOf(tag, kinds);
  if (eje !== 'conducta') return eje;
  return polarityClass(polarityOf(tag, polarity));
}

/** Las etiquetas de un eje, ya ordenadas por polaridad y alfabeto. */
export function tagsOfKind(
  tags: string[],
  kinds: KindMap | undefined,
  want: Kind,
  polarity: PolarityMap | undefined,
): string[] {
  const dentro = tags.filter((t) => kindOf(t, kinds) === want);
  return want === 'conducta'
    ? sortByPolarity(dentro, polarity)
    : dentro.slice().sort((a, b) => a.localeCompare(b, 'es'));
}
