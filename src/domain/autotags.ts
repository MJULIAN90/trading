import { db } from '../db/index.js';
import { marketDate, marketHour, sessionOf, SESSIONS } from './sessions.js';

/**
 * Etiquetas que se ponen solas, a partir de reglas que estan EN LA BASE.
 *
 * Por que existe esto. La mitad de las etiquetas de la lista no son un juicio
 * suyo, son una medida: "salida a tiempo 12m" es mirar el reloj, "reentrada en
 * misma vela m15" es restar dos marcas de tiempo. Ponerlas a mano, una por una,
 * significa que la mayoria de las operaciones se quedan sin ellas, y una
 * etiqueta que solo esta en las que te acordaste de marcar no se puede medir:
 * lo que mide es tu memoria.
 *
 * La regla del proyecto, que ya estaba escrita en CLAUDE.md: **no etiquetar lo
 * que la maquina puede deducir**. Las etiquetas a mano son para lo que SOLO el
 * sabe -- si vio el gatillo, si habia patron, si entro con miedo.
 *
 * ---------------------------------------------------------------------------
 * LAS REGLAS VIVEN EN LA BASE, NO AQUI
 * ---------------------------------------------------------------------------
 *
 * Este fichero trae cinco reglas de arranque y ni una mas, y las trae como
 * SEMILLA: se escriben en `tag_rules` la primera vez y a partir de ahi mandan
 * las de la base. El diario se comparte entre ordenadores y una regla es un
 * ajuste, no una decision de quien programa. Si manana decide que la apertura
 * son veinte minutos y no quince, eso se cambia en Ajustes, no recompilando.
 *
 * ---------------------------------------------------------------------------
 * EL CAMPO `cuando` ES LO MAS IMPORTANTE DE TODO ESTE FICHERO
 * ---------------------------------------------------------------------------
 *
 * Cada campo medible dice si se conocia ANTES de entrar (`decision`) o solo
 * DESPUES de cerrar (`resultado`).
 *
 * No es decoracion. Una etiqueta derivada de un campo `resultado` no se puede
 * usar luego para explicar el resultado: seria la misma frase dos veces. Es
 * exactamente lo que mato el apartado 11 de `hipotesis-medidas-octubre.md`
 * ("acabo mal POR estar 200 abajo") y es la trampa que tiene el ejemplo mas
 * natural de todos: "si dura menos de 10 minutos es scalping".
 *
 * Eso no deduce la estrategia, deduce el desenlace. Una operacion que ibas a
 * aguantar media hora y te barrieron en 40 segundos duro poco y NO era un
 * scalp. Y ya esta medido que todo lo de menos de 3 minutos pierde en las dos
 * cuentas: una etiqueta puesta por duracion corta saldria catastrofica por
 * construccion, no por informacion.
 *
 * Por eso `gross_pnl` NO es un campo y no lo sera: una etiqueta que se pone
 * segun si ganaste convierte cualquier estadistica posterior en un espejo.
 *
 * Las reglas con campos `resultado` SI se permiten -- "salida a tiempo 12m"
 * describe un habito de salida y es util -- pero el motor las marca, y al
 * cruzarlas con el PnL hay que saber lo que se esta haciendo.
 */

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

export type Cuando = 'decision' | 'resultado';

export interface CampoSpec {
  /** Nombre que se guarda en la regla. */
  campo: string;
  /** Como se lee en la pantalla. */
  etiqueta: string;
  cuando: Cuando;
  /** Unidad, para que la casilla del valor no se lea a ciegas. */
  unidad: string;
}

export const CAMPOS: CampoSpec[] = [
  { campo: 'hora_mercado', etiqueta: 'Hora de mercado al entrar', cuando: 'decision', unidad: 'horas (9.5 = 09:30)' },
  { campo: 'minuto_entrada_en_vela15', etiqueta: 'Minuto de la vela de 15m al entrar', cuando: 'decision', unidad: '0 a 14' },
  { campo: 'contratos', etiqueta: 'Contratos', cuando: 'decision', unidad: 'contratos' },
  { campo: 'direccion', etiqueta: 'Direccion', cuando: 'decision', unidad: '1 largo, -1 corto' },
  { campo: 'num_operacion_dia', etiqueta: 'Numero de operacion de la jornada', cuando: 'decision', unidad: '1 = la primera' },
  { campo: 'hueco_anterior_seg', etiqueta: 'Hueco desde que cerro la anterior', cuando: 'decision', unidad: 'segundos (-1 si es la primera)' },
  { campo: 'tras_perdida', etiqueta: 'La anterior fue perdida', cuando: 'decision', unidad: '1 si, 0 no' },
  { campo: 'mismo_lado_que_anterior', etiqueta: 'Mismo lado que la anterior', cuando: 'decision', unidad: '1 si, 0 no' },
  { campo: 'reentrada_misma_vela15', etiqueta: 'La anterior abrio en la misma vela de 15m', cuando: 'decision', unidad: '1 si, 0 no' },
  { campo: 'minutos_desde_apertura_sesion', etiqueta: 'Minutos desde que abrio la killzone', cuando: 'decision', unidad: 'minutos (-1 fuera de killzone)' },
  { campo: 'minutos_hasta_cierre_sesion', etiqueta: 'Minutos hasta que cierra la killzone', cuando: 'decision', unidad: 'minutos (-1 fuera de killzone)' },
  { campo: 'duracion_seg', etiqueta: 'Duracion', cuando: 'resultado', unidad: 'segundos' },
  { campo: 'minuto_salida_en_vela15', etiqueta: 'Minuto de la vela de 15m al salir', cuando: 'resultado', unidad: '0 a 14' },
];

const POR_CAMPO = new Map(CAMPOS.map((c) => [c.campo, c]));

export const OPERADORES = ['<', '<=', '>', '>=', '=', '!=', 'entre'] as const;
export type Operador = (typeof OPERADORES)[number];

export interface Condicion {
  campo: string;
  operador: Operador;
  valor: number;
  /** Solo para `entre`, y es inclusivo por los dos lados. */
  valor2?: number;
}

export interface Regla {
  id: number;
  tag: string;
  /** Todas tienen que cumplirse. Un Y, no un O: un O se escribe como dos reglas. */
  condiciones: Condicion[];
  activa: boolean;
  /** `resultado` si alguna condicion mira un campo que solo se sabe al cerrar. */
  cuando: Cuando;
}

// ---------------------------------------------------------------------------
// Las cinco de arranque
// ---------------------------------------------------------------------------

/**
 * Reexportadas desde `autotagsSeed.ts`, que no importa nada y por eso lo puede
 * leer tambien la migracion sin crear un ciclo. Ver el porque alli.
 */
export { REGLAS_DE_ARRANQUE } from './autotagsSeed.js';

// ---------------------------------------------------------------------------
// Medir una operacion
// ---------------------------------------------------------------------------

const VELA15_MS = 15 * 60_000;

export interface OperacionMedible {
  id: number;
  opened_at: number;
  closed_at: number;
  direction: string;
  max_quantity: number;
  account_id: string | null;
}

/** Minuto dentro de su vela de 15m, de 0 a 14. */
export function minutoEnVela15(ts: number): number {
  return Math.floor((ts % VELA15_MS) / 60_000);
}

/**
 * Minutos que lleva abierta y que le quedan a la killzone de ese instante.
 *
 * Devuelve -1 en las dos si el instante cae FUERA de killzone, que no es lo
 * mismo que cero: cero seria "justo en el borde" y provocaria que la regla del
 * borde marcara un tercio de las operaciones del mes. Un hueco entre franjas no
 * tiene borde porque no tiene franja.
 */
export function bordesDeSesion(ts: number): { desdeApertura: number; hastaCierre: number } {
  const nombre = sessionOf(ts);
  if (nombre === 'OUTSIDE') return { desdeApertura: -1, hastaCierre: -1 };

  const spec = SESSIONS.find((s) => s.name === nombre);
  if (!spec) return { desdeApertura: -1, hastaCierre: -1 };

  const h = marketHour(ts);
  return {
    desdeApertura: Math.round((h - spec.from) * 60),
    hastaCierre: Math.round((spec.to - h) * 60),
  };
}

/**
 * Todos los campos de una operacion, ya en numeros.
 *
 * `previa` es la operacion anterior DE LA MISMA CUENTA y de la misma jornada.
 * De la misma cuenta porque con la demo y la mesa abiertas a la vez las
 * operaciones se entrelazan en el tiempo, y "la anterior" de otra cuenta no es
 * la anterior de nada: es el mismo fallo que corrompia los ciclos de posicion
 * en `quantower.ts`.
 */
export function medir(
  op: OperacionMedible,
  previa: (OperacionMedible & { gross_pnl: number }) | null,
  numeroDelDia: number,
): Record<string, number> {
  const bordes = bordesDeSesion(op.opened_at);

  return {
    hora_mercado: marketHour(op.opened_at),
    minuto_entrada_en_vela15: minutoEnVela15(op.opened_at),
    minuto_salida_en_vela15: minutoEnVela15(op.closed_at),
    duracion_seg: Math.round((op.closed_at - op.opened_at) / 1000),
    contratos: op.max_quantity,
    direccion: op.direction === 'LONG' ? 1 : -1,
    num_operacion_dia: numeroDelDia,
    hueco_anterior_seg: previa ? Math.round((op.opened_at - previa.closed_at) / 1000) : -1,
    tras_perdida: previa && previa.gross_pnl < 0 ? 1 : 0,
    mismo_lado_que_anterior: previa && previa.direction === op.direction ? 1 : 0,
    reentrada_misma_vela15:
      previa && Math.floor(previa.opened_at / VELA15_MS) === Math.floor(op.opened_at / VELA15_MS)
        ? 1
        : 0,
    minutos_desde_apertura_sesion: bordes.desdeApertura,
    minutos_hasta_cierre_sesion: bordes.hastaCierre,
  };
}

/** Una condicion contra los valores medidos. Un campo que no existe NO cumple. */
export function cumple(c: Condicion, valores: Record<string, number>): boolean {
  const v = valores[c.campo];
  if (v === undefined || !Number.isFinite(v)) return false;

  switch (c.operador) {
    case '<':
      return v < c.valor;
    case '<=':
      return v <= c.valor;
    case '>':
      return v > c.valor;
    case '>=':
      return v >= c.valor;
    case '=':
      return v === c.valor;
    case '!=':
      return v !== c.valor;
    case 'entre':
      return c.valor2 !== undefined && v >= c.valor && v <= c.valor2;
    default:
      return false;
  }
}

/** Todas las condiciones, en Y. Una regla sin condiciones no marca nada. */
export function reglaCumple(r: Regla, valores: Record<string, number>): boolean {
  if (r.condiciones.length === 0) return false;
  return r.condiciones.every((c) => cumple(c, valores));
}

// ---------------------------------------------------------------------------
// Validacion de lo que llega de fuera
// ---------------------------------------------------------------------------

/**
 * Convierte lo que venga del formulario en condiciones validas, o nada.
 *
 * Se valida aqui y no en la pantalla porque las reglas se guardan en la base y
 * la base se comparte: una condicion con un campo inventado no dispararia nunca
 * y la regla parecería no funcionar, sin un solo error donde mirar.
 */
export function limpiarCondiciones(raw: unknown): Condicion[] {
  if (!Array.isArray(raw)) return [];

  const out: Condicion[] = [];

  for (const item of raw.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;

    const campo = typeof o.campo === 'string' ? o.campo.trim() : '';
    if (!POR_CAMPO.has(campo)) continue;

    const operador = o.operador as Operador;
    if (!OPERADORES.includes(operador)) continue;

    const valor = Number(o.valor);
    if (!Number.isFinite(valor)) continue;

    const valor2 = Number(o.valor2);
    if (operador === 'entre' && !Number.isFinite(valor2)) continue;

    out.push(
      operador === 'entre' ? { campo, operador, valor, valor2 } : { campo, operador, valor },
    );
  }

  return out;
}

/** `resultado` si alguna condicion mira un campo que solo se sabe al cerrar. */
export function cuandoDeRegla(condiciones: Condicion[]): Cuando {
  return condiciones.some((c) => POR_CAMPO.get(c.campo)?.cuando === 'resultado')
    ? 'resultado'
    : 'decision';
}

// ---------------------------------------------------------------------------
// Las reglas, en la base
// ---------------------------------------------------------------------------

function filaARegla(row: { id: number; tag: string; condiciones: string; activa: number }): Regla {
  let condiciones: Condicion[] = [];
  try {
    condiciones = limpiarCondiciones(JSON.parse(row.condiciones));
  } catch (err) {
    // Una fila corrupta no puede tumbar el calculo entero: queda sin
    // condiciones, y una regla sin condiciones no marca nada.
    condiciones = [];
  }

  return {
    id: row.id,
    tag: row.tag,
    condiciones,
    activa: row.activa === 1,
    cuando: cuandoDeRegla(condiciones),
  };
}

export function listarReglas(): Regla[] {
  const rows = db()
    .prepare('SELECT id, tag, condiciones, activa FROM tag_rules ORDER BY tag, id')
    .all() as Array<{ id: number; tag: string; condiciones: string; activa: number }>;

  return rows.map(filaARegla);
}

export function guardarRegla(entrada: {
  id?: number;
  tag: string;
  condiciones: unknown;
  activa?: boolean;
}): Regla | null {
  const tag = entrada.tag.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
  const condiciones = limpiarCondiciones(entrada.condiciones);

  // Una regla sin etiqueta o sin condiciones validas no se guarda. Guardarla
  // dejaria una fila que no hace nada y que parece que si.
  if (!tag || condiciones.length === 0) return null;

  const json = JSON.stringify(condiciones);
  const activa = entrada.activa === false ? 0 : 1;
  const target = db();

  if (entrada.id) {
    target
      .prepare('UPDATE tag_rules SET tag = ?, condiciones = ?, activa = ? WHERE id = ?')
      .run(tag, json, activa, entrada.id);
    const row = target
      .prepare('SELECT id, tag, condiciones, activa FROM tag_rules WHERE id = ?')
      .get(entrada.id) as { id: number; tag: string; condiciones: string; activa: number } | undefined;
    return row ? filaARegla(row) : null;
  }

  const info = target
    .prepare('INSERT INTO tag_rules (tag, condiciones, activa, creada_en) VALUES (?, ?, ?, ?)')
    .run(tag, json, activa, Date.now());

  return {
    id: Number(info.lastInsertRowid),
    tag,
    condiciones,
    activa: activa === 1,
    cuando: cuandoDeRegla(condiciones),
  };
}

/**
 * Borra una regla Y las etiquetas que habia puesto.
 *
 * Las dos cosas juntas a proposito. Dejar las etiquetas de una regla que ya no
 * existe es la forma mas silenciosa de que la base deje de corresponderse con
 * las reglas: nadie volveria a poner esa etiqueta y nadie podria explicar por
 * que estaba. Solo se tocan las derivadas; si el habia puesto la misma a mano,
 * esa se queda.
 */
export function borrarRegla(id: number): { tag: string | null; etiquetasQuitadas: number } {
  const target = db();
  const row = target.prepare('SELECT tag FROM tag_rules WHERE id = ?').get(id) as
    | { tag: string }
    | undefined;

  if (!row) return { tag: null, etiquetasQuitadas: 0 };

  let quitadas = 0;

  target.transaction(() => {
    // Solo si NINGUNA otra regla activa pone esa misma etiqueta.
    const otras = target
      .prepare('SELECT COUNT(*) n FROM tag_rules WHERE tag = ? AND id != ? AND activa = 1')
      .get(row.tag, id) as { n: number };

    if (otras.n === 0) {
      const info = target
        .prepare("DELETE FROM operation_tags WHERE tag = ? AND origen = 'derivada'")
        .run(row.tag);
      quitadas = info.changes;
    }

    target.prepare('DELETE FROM tag_rules WHERE id = ?').run(id);
  })();

  return { tag: row.tag, etiquetasQuitadas: quitadas };
}

// ---------------------------------------------------------------------------
// El boton "Calcular"
// ---------------------------------------------------------------------------

export interface ResultadoCalculo {
  reglas: number;
  operaciones: number;
  puestas: number;
  quitadas: number;
  porEtiqueta: Array<{ tag: string; n: number; cuando: Cuando }>;
}

/**
 * Recalcula TODAS las etiquetas derivadas y REEMPLAZA las anteriores.
 *
 * Reemplazar, no anadir, y esto no es un detalle de implementacion: es la
 * diferencia entre que las reglas signifiquen algo o no. Si solo anadiera,
 * cambiar el 12 por el 11 en una regla dejaria para siempre las operaciones
 * marcadas con el 12, nadie sabria por que estan, y la etiqueta mediria una
 * mezcla de dos reglas distintas.
 *
 * Es el mismo problema que ya obligo a escribir `restampReal` y
 * `recomputarPnl`: con `INSERT OR IGNORE`, una fila guardada no se vuelve a
 * tocar nunca y los ajustes dejan de tener efecto sobre lo viejo sin avisar.
 *
 * Las etiquetas MANUALES no se tocan. Ni una.
 */
export function calcularEtiquetas(): ResultadoCalculo {
  const target = db();
  const reglas = listarReglas().filter((r) => r.activa && r.condiciones.length > 0);

  const ops = target
    .prepare(
      `SELECT id, opened_at, closed_at, direction, max_quantity, account_id, gross_pnl
         FROM operations
        ORDER BY opened_at ASC, id ASC`,
    )
    .all() as Array<OperacionMedible & { gross_pnl: number }>;

  const porEtiqueta = new Map<string, { n: number; cuando: Cuando }>();
  let puestas = 0;
  let quitadas = 0;

  target.transaction(() => {
    const antes = target
      .prepare("SELECT COUNT(*) n FROM operation_tags WHERE origen = 'derivada'")
      .get() as { n: number };

    target.prepare("DELETE FROM operation_tags WHERE origen = 'derivada'").run();
    quitadas = antes.n;

    // `INSERT OR IGNORE` porque la clave es (operation_id, tag): si el ya habia
    // puesto a mano la misma etiqueta que calcula una regla, manda la suya y la
    // derivada no se escribe. Lo que marco una persona no lo pisa un automatismo.
    const insert = target.prepare(
      "INSERT OR IGNORE INTO operation_tags (operation_id, tag, origen) VALUES (?, ?, 'derivada')",
    );

    // "La anterior" es por cuenta y por jornada, no la fila de antes en la
    // lista: con dos conexiones abiertas las operaciones se entrelazan.
    const ultima = new Map<string, OperacionMedible & { gross_pnl: number }>();
    const cuenta = new Map<string, number>();

    for (const op of ops) {
      const clave = `${op.account_id ?? ''}\u0000${jornadaDe(op.opened_at)}`;
      const previa = ultima.get(clave) ?? null;
      const numero = (cuenta.get(clave) ?? 0) + 1;
      cuenta.set(clave, numero);

      const valores = medir(op, previa, numero);

      for (const r of reglas) {
        if (!reglaCumple(r, valores)) continue;
        const info = insert.run(op.id, r.tag);
        if (info.changes > 0) {
          puestas++;
          const acc = porEtiqueta.get(r.tag) ?? { n: 0, cuando: r.cuando };
          acc.n++;
          porEtiqueta.set(r.tag, acc);
        }
      }

      ultima.set(clave, op);
    }
  })();

  return {
    reglas: reglas.length,
    operaciones: ops.length,
    puestas,
    quitadas,
    porEtiqueta: [...porEtiqueta.entries()]
      .map(([tag, v]) => ({ tag, n: v.n, cuando: v.cuando }))
      .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, 'es')),
  };
}

/**
 * La jornada de mercado, para agrupar "la anterior del dia".
 *
 * Sale de `sessions.ts` y no de aqui para que no haya dos definiciones del
 * corte de las 18:00 que puedan separarse con el tiempo.
 */
function jornadaDe(ts: number): string {
  return marketDate(ts);
}

// ---------------------------------------------------------------------------
// El mismo boton, pero de UNA operacion
// ---------------------------------------------------------------------------

export interface ResultadoUna {
  operationId: number;
  reglas: number;
  puestas: string[];
  quitadas: string[];
}

/**
 * Recalcula las derivadas de UNA sola operacion.
 *
 * Existe para poder pulsar "Calcular" desde la propia operacion, mientras se
 * revisa, en vez de ir a Ajustes y recorrer las ochocientas. Revisar una
 * operacion y ver ahi mismo lo que la regla le pone es la unica forma de
 * saber si la regla dice lo que crees que dice.
 *
 * Hace EXACTAMENTE lo mismo que el boton grande sobre esa fila: mismas reglas,
 * mismo borrado previo, mismas manuales intactas. Si diera algo distinto, la
 * pantalla y la base contarian dos historias y no habria forma de saber a cual
 * creerle.
 *
 * La unica parte delicada es el contexto: `hueco_anterior_seg`,
 * `tras_perdida`, `reentrada_misma_vela15` y `num_operacion_dia` dependen de
 * las operaciones ANTERIORES de la misma cuenta y jornada. Aqui se buscan con
 * dos consultas en vez de recorrer el historico entero, pero la definicion de
 * "la anterior" es la misma: misma cuenta, misma jornada, la mas reciente de
 * las que abrieron antes.
 */
export function calcularEtiquetasDe(operationId: number): ResultadoUna | null {
  const target = db();

  const op = target
    .prepare(
      `SELECT id, opened_at, closed_at, direction, max_quantity, account_id, gross_pnl
         FROM operations WHERE id = ?`,
    )
    .get(operationId) as (OperacionMedible & { gross_pnl: number }) | undefined;

  if (!op) return null;

  const reglas = listarReglas().filter((r) => r.activa && r.condiciones.length > 0);
  const jornada = jornadaDe(op.opened_at);

  // La cuenta se compara con IS para que NULL case con NULL: una operacion sin
  // cuenta no puede quedarse sin "anterior" solo porque `= NULL` nunca es
  // cierto en SQL.
  const previa = target
    .prepare(
      `SELECT id, opened_at, closed_at, direction, max_quantity, account_id, gross_pnl
         FROM operations
        WHERE account_id IS ?
          AND opened_at < ?
        ORDER BY opened_at DESC, id DESC
        LIMIT 1`,
    )
    .get(op.account_id, op.opened_at) as (OperacionMedible & { gross_pnl: number }) | undefined;

  // Solo cuenta si es de la MISMA jornada. La ultima de ayer no es "la
  // anterior" de la primera de hoy: entre medias hubo una noche.
  const anterior = previa && jornadaDe(previa.opened_at) === jornada ? previa : null;

  const cuantasAntes = target
    .prepare(
      `SELECT COUNT(*) n FROM operations
        WHERE account_id IS ? AND opened_at < ?`,
    )
    .get(op.account_id, op.opened_at) as { n: number };

  // El numero del dia cuenta solo las de esta jornada, asi que se descuenta lo
  // que haya antes del corte de las 18:00.
  const antesDeHoy = target
    .prepare(
      `SELECT COUNT(*) n FROM operations
        WHERE account_id IS ? AND opened_at < ?`,
    )
    .get(op.account_id, inicioDeJornada(op.opened_at)) as { n: number };

  const numero = cuantasAntes.n - antesDeHoy.n + 1;
  const valores = medir(op, anterior, numero);

  const puestas: string[] = [];
  let quitadas: string[] = [];

  target.transaction(() => {
    const antes = target
      .prepare("SELECT tag FROM operation_tags WHERE operation_id = ? AND origen = 'derivada'")
      .all(operationId) as Array<{ tag: string }>;
    quitadas = antes.map((t) => t.tag);

    target
      .prepare("DELETE FROM operation_tags WHERE operation_id = ? AND origen = 'derivada'")
      .run(operationId);

    const insert = target.prepare(
      "INSERT OR IGNORE INTO operation_tags (operation_id, tag, origen) VALUES (?, ?, 'derivada')",
    );

    for (const r of reglas) {
      if (!reglaCumple(r, valores)) continue;
      if (insert.run(operationId, r.tag).changes > 0) puestas.push(r.tag);
    }
  })();

  return {
    operationId,
    reglas: reglas.length,
    puestas: puestas.sort((a, b) => a.localeCompare(b, 'es')),
    // Lo que ya estaba y vuelve a estar no es "quitado": solo se informa de lo
    // que de verdad desaparecio, que es lo unico que sorprende al verlo.
    quitadas: quitadas.filter((t) => !puestas.includes(t)).sort((a, b) => a.localeCompare(b, 'es')),
  };
}

/**
 * Instante en que empezo la jornada de mercado de ese momento.
 *
 * Se calcula retrocediendo dia a dia en vez de con aritmetica de husos: el
 * corte son las 18:00 de Nueva York y Nueva York cambia de hora dos veces al
 * ano. `marketDate` ya sabe resolverlo, asi que se le pregunta a el.
 */
function inicioDeJornada(ts: number): number {
  const jornada = marketDate(ts);
  let t = ts;

  // Hacia atras en saltos de 15 minutos hasta que la jornada cambia. Una
  // jornada dura 23 horas, asi que son 92 pasos en el peor caso.
  while (t > ts - 26 * 3600_000) {
    const anterior = t - 15 * 60_000;
    if (marketDate(anterior) !== jornada) return t;
    t = anterior;
  }

  return t;
}

// ---------------------------------------------------------------------------
// Por que lleva esa etiqueta
// ---------------------------------------------------------------------------

export interface Explicacion {
  tag: string;
  /** La condicion en palabras, con el valor REAL de esta operacion al lado. */
  porque: string;
  cuando: Cuando;
  /**
   * `false` cuando la etiqueta esta puesta pero NINGUNA regla activa la
   * justifica ya. Pasa cuando se edito la regla y todavia no se ha vuelto a
   * pulsar Calcular. No es un error: es exactamente lo que hay que ver.
   */
  vigente: boolean;
}

/**
 * Por que esta operacion lleva cada una de sus etiquetas automaticas.
 *
 * Una etiqueta que aparece sin explicacion es ruido. Una que al pasar por
 * encima dice "Minuto de la vela de 15m al salir = 12 · el tuyo: 12" es
 * informacion, y ademas es la unica forma de pillar una regla que dice algo
 * distinto de lo que crees que dice.
 *
 * Se calcula al leer y no se guarda: asi la explicacion es la de la regla de
 * AHORA. Si la regla cambio y la etiqueta se quedo vieja, sale `vigente:false`
 * en vez de una explicacion que ya no es cierta.
 */
export function explicarDerivadas(operationId: number): Explicacion[] {
  const target = db();

  const puestas = target
    .prepare(
      "SELECT tag FROM operation_tags WHERE operation_id = ? AND origen = 'derivada' ORDER BY tag",
    )
    .all(operationId) as Array<{ tag: string }>;

  if (puestas.length === 0) return [];

  const op = target
    .prepare(
      `SELECT id, opened_at, closed_at, direction, max_quantity, account_id, gross_pnl
         FROM operations WHERE id = ?`,
    )
    .get(operationId) as (OperacionMedible & { gross_pnl: number }) | undefined;

  if (!op) return [];

  const previa = target
    .prepare(
      `SELECT id, opened_at, closed_at, direction, max_quantity, account_id, gross_pnl
         FROM operations
        WHERE account_id IS ? AND opened_at < ?
        ORDER BY opened_at DESC, id DESC LIMIT 1`,
    )
    .get(op.account_id, op.opened_at) as (OperacionMedible & { gross_pnl: number }) | undefined;

  const anterior =
    previa && marketDate(previa.opened_at) === marketDate(op.opened_at) ? previa : null;

  // El numero del dia no sale en ninguna explicacion de las reglas de arranque,
  // asi que no se paga la consulta de contarlo: solo importa si alguna regla
  // mira ese campo, y entonces se ve con el valor que toque.
  const valores = medir(op, anterior, 0);
  const reglas = listarReglas().filter((r) => r.activa);

  return puestas.map(({ tag }) => {
    const suyas = reglas.filter((r) => r.tag === tag && reglaCumple(r, valores));

    if (suyas.length === 0) {
      return {
        tag,
        porque: 'ninguna regla activa la justifica ya · vuelve a pulsar calcular',
        cuando: 'decision' as Cuando,
        vigente: false,
      };
    }

    const r = suyas[0]!;
    return { tag, porque: enPalabras(r, valores), cuando: r.cuando, vigente: true };
  });
}

/** La condicion escrita para una persona, con el valor real al lado. */
function enPalabras(r: Regla, valores: Record<string, number>): string {
  return r.condiciones
    .map((c) => {
      const spec = CAMPOS.find((x) => x.campo === c.campo);
      const nombre = spec?.etiqueta ?? c.campo;
      const real = valores[c.campo];
      const suyo = real === undefined ? '' : ` · el tuyo: ${redondo(real)}`;

      return c.operador === 'entre'
        ? `${nombre} entre ${c.valor} y ${c.valor2}${suyo}`
        : `${nombre} ${c.operador} ${c.valor}${suyo}`;
    })
    .join('  Y  ');
}

/** Dos decimales como mucho, y sin ceros de relleno: 9.5, no 9.50. */
function redondo(n: number): string {
  return String(Math.round(n * 100) / 100);
}
