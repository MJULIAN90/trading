/**
 * Comprobacion del motor de etiquetas automaticas.
 *
 *   npx tsx scripts/prueba-autoetiquetas.ts
 *
 * Lo que de verdad se comprueba aqui no son las reglas, que son faciles: es que
 * recalcular NO destruya lo que Julian marco a mano, y que una regla que cambia
 * retire sus etiquetas viejas. Las dos cosas fallan en silencio, que es la
 * unica forma en la que fallan de verdad en este proyecto:
 *
 *   - Guardar una nota borraba TODAS las etiquetas de la operacion. Si las
 *     derivadas entraran por ahi, escribir una coma en el texto las tiraba.
 *   - `INSERT OR IGNORE` no vuelve a tocar una fila existente. Ya obligo a
 *     escribir `restampReal` y `recomputarPnl`; aqui obliga a que "Calcular"
 *     borre antes de poner.
 *
 * Escribe en una base temporal, nunca en la tuya.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.JOURNAL_DB = join(mkdtempSync(join(tmpdir(), 'tj-auto-')), 'prueba.db');

const { db } = await import('../src/db/index.js');
const { saveNote, getNote } = await import('../src/domain/notes.js');
const {
  calcularEtiquetas,
  calcularEtiquetasDe,
  explicarDerivadas,
  listarReglas,
  guardarRegla,
  borrarRegla,
  medir,
  cumple,
  minutoEnVela15,
  bordesDeSesion,
  cuandoDeRegla,
  limpiarCondiciones,
  CAMPOS,
} = await import('../src/domain/autotags.js');

function check(nombre: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${nombre}${extra ? ' · ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

const d = db();

// ---------------------------------------------------------------------------
// 1. La semilla
// ---------------------------------------------------------------------------
{
  const reglas = listarReglas();
  check('la base arranca con las 5 reglas de siempre', reglas.length === 5, `${reglas.length}`);
  check('todas activas', reglas.every((r) => r.activa));
  check('todas con condiciones validas', reglas.every((r) => r.condiciones.length > 0));

  const porSalida = reglas.filter((r) => r.cuando === 'resultado').map((r) => r.tag).sort();
  check(
    'solo las dos de hora de SALIDA estan marcadas como resultado',
    JSON.stringify(porSalida) === JSON.stringify(['salida a tiempo 12m', 'salida a tiempo 13m']),
    porSalida.join(', '),
  );
}

// ---------------------------------------------------------------------------
// 2. Las piezas sueltas
// ---------------------------------------------------------------------------
{
  const vela = Date.UTC(2026, 10, 10, 14, 30, 0); // apertura de vela de 15m
  check('minuto 0 de la vela', minutoEnVela15(vela) === 0, `${minutoEnVela15(vela)}`);
  check('minuto 12 de la vela', minutoEnVela15(vela + 12 * 60_000) === 12);
  check('minuto 14, el ultimo', minutoEnVela15(vela + 14 * 60_000 + 59_000) === 14);

  // 09:35 NY del 10 nov (EST, UTC-5) = 14:35 UTC. NY AM va de 9.5 a 11.
  const nyam = Date.UTC(2026, 10, 10, 14, 35, 0);
  const b = bordesDeSesion(nyam);
  check('dentro de NY AM: 5 min desde que abrio', b.desdeApertura === 5, `${b.desdeApertura}`);
  check('y 85 hasta que cierra', b.hastaCierre === 85, `${b.hastaCierre}`);

  // Un hueco entre franjas no tiene borde porque no tiene franja. Devolver 0
  // haria que la regla del borde marcara un tercio del mes.
  const fuera = Date.UTC(2026, 10, 10, 16, 30, 0); // 11:30 NY, entre NY AM y el almuerzo
  const f = bordesDeSesion(fuera);
  check('fuera de killzone los bordes son -1, no 0', f.desdeApertura === -1 && f.hastaCierre === -1);
}

{
  const v = { x: 10 } as Record<string, number>;
  check('<  ', cumple({ campo: 'x', operador: '<', valor: 11 }, v));
  check('>= ', cumple({ campo: 'x', operador: '>=', valor: 10 }, v));
  check('=  ', cumple({ campo: 'x', operador: '=', valor: 10 }, v));
  check('!= ', !cumple({ campo: 'x', operador: '!=', valor: 10 }, v));
  check('entre, inclusivo por los dos lados', cumple({ campo: 'x', operador: 'entre', valor: 10, valor2: 20 }, v));
  check('un campo que no existe NO cumple', !cumple({ campo: 'y', operador: '>', valor: 0 }, v));
}

{
  // La validacion es la que protege una base compartida: un campo inventado no
  // dispararia nunca y la regla pareceria rota sin dar un error.
  const limpias = limpiarCondiciones([
    { campo: 'hora_mercado', operador: '>', valor: 9 },
    { campo: 'campo_inventado', operador: '>', valor: 1 },
    { campo: 'contratos', operador: 'xx', valor: 1 },
    { campo: 'contratos', operador: '>', valor: 'hola' },
    { campo: 'contratos', operador: 'entre', valor: 1 },
  ]);
  check('de cinco condiciones solo sobrevive la buena', limpias.length === 1, `${limpias.length}`);
  check('  y "entre" sin segundo valor se descarta', !limpias.some((c) => c.operador === 'entre'));
}

// ---------------------------------------------------------------------------
// 3. Operaciones de prueba
// ---------------------------------------------------------------------------
const VELA = Date.UTC(2026, 10, 10, 14, 30, 0); // 09:30 NY, apertura

function op(id: number, abre: number, cierra: number, dir = 'LONG', pnl = 10, cuenta = 'A'): void {
  d.prepare(
    `INSERT INTO operations
       (id, symbol, opened_at, closed_at, direction, entry_price, exit_price, max_quantity,
        fills_count, gross_pnl, duration_sec, session, market_hour, is_real, account_id,
        first_fill_id, last_fill_id)
     VALUES (?, 'MNQZ26', ?, ?, ?, 100, 110, 1, 2, ?, ?, 'NY_AM', 9.5, 1, ?, ?, ?)`,
  ).run(id, abre, cierra, dir, pnl, Math.round((cierra - abre) / 1000), cuenta, `f${id}`, `g${id}`);
}

// 1: entra en la apertura y sale en el minuto 12 -> dos etiquetas
op(1, VELA + 60_000, VELA + 12 * 60_000);
// 2: misma vela de 15m que la 1 -> reentrada
op(2, VELA + 13 * 60_000, VELA + 14 * 60_000 + 30_000);
// 3: a las 10:56 NY, con NY AM cerrando a las 11:00 -> borde de sesion
op(3, Date.UTC(2026, 10, 10, 15, 56, 0), Date.UTC(2026, 10, 10, 16, 0, 0));
// 4: a las 12:20 NY, sin nada especial
op(4, Date.UTC(2026, 10, 10, 17, 20, 0), Date.UTC(2026, 10, 10, 17, 25, 0));

{
  const r = calcularEtiquetas();
  check('se miden las 4 operaciones', r.operaciones === 4, `${r.operaciones}`);
  check('con las 5 reglas activas', r.reglas === 5, `${r.reglas}`);

  const de = (id: number) => getNote(id).tags.sort();
  check(
    'op 1: apertura de mercado + salida a tiempo 12m',
    JSON.stringify(de(1)) === JSON.stringify(['operacion en apertura de mercado', 'salida a tiempo 12m']),
    de(1).join(', '),
  );
  check(
    'op 2: apertura + reentrada en la misma vela',
    JSON.stringify(de(2)) === JSON.stringify(['operacion en apertura de mercado', 'reentrada en misma vela m15']),
    de(2).join(', '),
  );
  check('op 3: borde limite de sesion', JSON.stringify(de(3)) === JSON.stringify(['operacion al borde limite de sesion']), de(3).join(', '));
  check('op 4: ninguna', de(4).length === 0, de(4).join(', '));

  check('todas marcadas como derivadas', getNote(1).derivadas.length === 2, `${getNote(1).derivadas.length}`);
}

// ---------------------------------------------------------------------------
// 4. Idempotencia: dos pulsaciones seguidas dejan lo mismo
// ---------------------------------------------------------------------------
{
  const a = calcularEtiquetas();
  const b = calcularEtiquetas();
  check('la segunda pasada pone lo mismo', a.puestas === b.puestas, `${a.puestas} / ${b.puestas}`);
  check('  y quita lo mismo que puso', b.quitadas === b.puestas, `${b.quitadas} / ${b.puestas}`);
}

// ---------------------------------------------------------------------------
// 5. LO QUE IMPORTA: las manuales no se tocan
// ---------------------------------------------------------------------------
{
  saveNote(1, 'entre con miedo', ['miedo', 'dentro del plan']);
  check('se guardan las dos manuales', getNote(1).tags.includes('miedo') && getNote(1).tags.includes('dentro del plan'));
  check('  y siguen estando las derivadas', getNote(1).derivadas.length === 2, getNote(1).derivadas.join(', '));

  calcularEtiquetas();
  const t = getNote(1);
  check('tras recalcular, las manuales SIGUEN ahi', t.tags.includes('miedo') && t.tags.includes('dentro del plan'));
  check('  y las derivadas tambien', t.derivadas.length === 2, t.derivadas.join(', '));

  // Guardar la nota otra vez no puede llevarse las derivadas por delante.
  saveNote(1, 'nota cambiada', ['miedo']);
  const u = getNote(1);
  check('quitar una manual no toca las derivadas', u.derivadas.length === 2, u.derivadas.join(', '));
  check('  y la manual quitada se fue', !u.tags.includes('dentro del plan'));
  check('  y la que quedaba sigue', u.tags.includes('miedo'));
}

// ---------------------------------------------------------------------------
// 6. Cambiar una regla retira las etiquetas viejas
// ---------------------------------------------------------------------------
{
  const regla = listarReglas().find((r) => r.tag === 'salida a tiempo 12m');
  check('la regla del 12 existe', !!regla);

  // Se cambia el 12 por el 11: la op 1 ya no deberia llevarla.
  guardarRegla({
    id: regla!.id,
    tag: 'salida a tiempo 12m',
    condiciones: [{ campo: 'minuto_salida_en_vela15', operador: '=', valor: 11 }],
  });
  calcularEtiquetas();

  check(
    'cambiar la regla RETIRA la etiqueta vieja',
    !getNote(1).tags.includes('salida a tiempo 12m'),
    getNote(1).tags.join(', '),
  );
  check('  y no se lleva las manuales', getNote(1).tags.includes('miedo'));

  // Y se deja como estaba para lo que viene.
  guardarRegla({
    id: regla!.id,
    tag: 'salida a tiempo 12m',
    condiciones: [{ campo: 'minuto_salida_en_vela15', operador: '=', valor: 12 }],
  });
  calcularEtiquetas();
  check('al volver a 12 vuelve la etiqueta', getNote(1).tags.includes('salida a tiempo 12m'));
}

// ---------------------------------------------------------------------------
// 7. Borrar una regla se lleva SUS etiquetas, no las de nadie mas
// ---------------------------------------------------------------------------
{
  const regla = listarReglas().find((r) => r.tag === 'operacion en apertura de mercado');
  const out = borrarRegla(regla!.id);
  check('borrar la regla retira sus etiquetas', out.etiquetasQuitadas === 2, `${out.etiquetasQuitadas}`);
  check('  y la regla ya no esta', listarReglas().length === 4, `${listarReglas().length}`);
  check('  y las manuales siguen intactas', getNote(1).tags.includes('miedo'));
  check('  y las otras derivadas tambien', getNote(1).tags.includes('salida a tiempo 12m'));
}

// ---------------------------------------------------------------------------
// 8. "La anterior" es por CUENTA, no la fila de antes
// ---------------------------------------------------------------------------
// Con la demo y la mesa abiertas a la vez las operaciones se entrelazan en el
// tiempo. Si "la anterior" fuera la fila previa de la lista, una operacion de
// la mesa marcaria como reentrada a una de la demo que solo cayo en medio.
{
  d.prepare('DELETE FROM operation_tags').run();
  d.prepare('DELETE FROM operations').run();

  const V = Date.UTC(2026, 10, 11, 20, 0, 0);
  op(10, V + 1_000, V + 2_000, 'LONG', 5, 'CUENTA_A');
  op(11, V + 3_000, V + 4_000, 'LONG', 5, 'CUENTA_B'); // otra cuenta, en medio
  op(12, V + 5_000, V + 6_000, 'LONG', 5, 'CUENTA_A'); // reentrada REAL de A

  calcularEtiquetas();
  check('la 12 es reentrada (misma cuenta, misma vela)', getNote(12).tags.includes('reentrada en misma vela m15'));
  check('la 11 NO lo es: es la primera de su cuenta', !getNote(11).tags.includes('reentrada en misma vela m15'), getNote(11).tags.join(', '));
}

// ---------------------------------------------------------------------------
// 9. El PnL no es un campo, y no puede serlo
// ---------------------------------------------------------------------------
{
  check('`gross_pnl` NO esta entre los campos medibles', !CAMPOS.some((c) => c.campo === 'gross_pnl'));
  check('`pnl` tampoco', !CAMPOS.some((c) => c.campo.includes('pnl')));

  const rechazada = guardarRegla({ tag: 'ganadora', condiciones: [{ campo: 'gross_pnl', operador: '>', valor: 0 }] });
  check('una regla sobre el resultado se rechaza', rechazada === null);

  check(
    'una regla con un campo de resultado queda marcada',
    cuandoDeRegla([{ campo: 'duracion_seg', operador: '<', valor: 600 }]) === 'resultado',
  );
  check(
    'y una de decision, no',
    cuandoDeRegla([{ campo: 'hora_mercado', operador: '>', valor: 9 }]) === 'decision',
  );
}

// ---------------------------------------------------------------------------
// 10. El boton de UNA operacion da lo MISMO que el boton grande
// ---------------------------------------------------------------------------
// Es la propiedad que de verdad importa de la version por operacion: si diera
// algo distinto, la pantalla y la base contarian dos historias y no habria
// forma de saber a cual creerle. Se comprueba sobre un dia entero, no sobre un
// caso: el contexto ("la anterior", "la enesima del dia") es justo lo que una
// version podria calcular bien y la otra mal.
{
  d.prepare('DELETE FROM operation_tags').run();
  d.prepare('DELETE FROM operations').run();

  const V = Date.UTC(2026, 10, 12, 14, 30, 0); // 09:30 NY
  // Nueve operaciones de dos cuentas, entrelazadas en el tiempo a proposito.
  op(20, V, V + 12 * 60_000, 'LONG', 10, 'A');
  op(21, V + 60_000, V + 2 * 60_000, 'SHORT', -5, 'B');
  op(22, V + 5 * 60_000, V + 6 * 60_000, 'LONG', -8, 'A');
  op(23, V + 16 * 60_000, V + 28 * 60_000, 'LONG', 12, 'A');
  op(24, V + 17 * 60_000, V + 19 * 60_000, 'SHORT', 3, 'B');
  op(25, V + 31 * 60_000, V + 44 * 60_000, 'LONG', -2, 'A');
  op(26, V + 46 * 60_000, V + 47 * 60_000, 'LONG', 1, 'A');
  op(27, Date.UTC(2026, 10, 12, 15, 56, 0), Date.UTC(2026, 10, 12, 16, 0, 0), 'SHORT', 4, 'A');
  op(28, Date.UTC(2026, 10, 12, 17, 20, 0), Date.UTC(2026, 10, 12, 17, 25, 0), 'LONG', 6, 'B');

  calcularEtiquetas();
  const porLote = new Map<number, string>();
  for (const id of [20, 21, 22, 23, 24, 25, 26, 27, 28]) {
    porLote.set(id, getNote(id).derivadas.slice().sort().join('|'));
  }

  // Y ahora una por una, en otro orden, para que no se pueda colar un estado
  // compartido entre pasadas.
  let iguales = 0;
  for (const id of [25, 20, 28, 22, 27, 21, 26, 24, 23]) {
    calcularEtiquetasDe(id);
    const ahora = getNote(id).derivadas.slice().sort().join('|');
    if (ahora === porLote.get(id)) iguales++;
    else console.log(`      op ${id}: lote=[${porLote.get(id)}] una=[${ahora}]`);
  }

  check('una a una da lo mismo que el boton grande, en las 9', iguales === 9, `${iguales}/9`);

  // Y no puede inventarse etiquetas donde el lote no puso ninguna.
  const total = d.prepare("SELECT COUNT(*) n FROM operation_tags WHERE origen = 'derivada'").get() as { n: number };
  calcularEtiquetas();
  const despues = d.prepare("SELECT COUNT(*) n FROM operation_tags WHERE origen = 'derivada'").get() as { n: number };
  check('y el total de derivadas no cambia', total.n === despues.n, `${total.n} / ${despues.n}`);
}

// ---------------------------------------------------------------------------
// 11. Recalcular UNA no toca a las vecinas ni a las manuales
// ---------------------------------------------------------------------------
{
  saveNote(23, 'con miedo', ['miedo']);
  const vecinaAntes = getNote(22).tags.slice().sort().join('|');

  const r = calcularEtiquetasDe(23);
  check('devuelve el resultado de esa operacion', r?.operationId === 23);
  check('la manual sigue puesta', getNote(23).tags.includes('miedo'));
  check('la vecina no se movio', getNote(22).tags.slice().sort().join('|') === vecinaAntes);

  // Dos pulsaciones seguidas sobre la misma: nada nuevo y nada perdido.
  const a = calcularEtiquetasDe(23);
  const b = calcularEtiquetasDe(23);
  check('dos pulsaciones seguidas dan lo mismo', JSON.stringify(a?.puestas) === JSON.stringify(b?.puestas), (b?.puestas ?? []).join(', '));
  check('  y no informan de quitadas falsas', (b?.quitadas ?? []).length === 0, (b?.quitadas ?? []).join(', '));

  check('una operacion que no existe devuelve null', calcularEtiquetasDe(99999) === null);
}

// ---------------------------------------------------------------------------
// 12. Por que lleva cada etiqueta
// ---------------------------------------------------------------------------
// Una etiqueta que aparece sin explicacion es ruido. Y la explicacion tiene que
// traer el valor REAL de la operacion, no solo la regla: "= 12" no dice nada si
// no ves que el tuyo tambien es 12.
{
  d.prepare('DELETE FROM operation_tags').run();
  d.prepare('DELETE FROM operations').run();

  // El apartado 7 borro la regla de la apertura: se vuelve a crear aqui para
  // que esta seccion no dependa del orden en que corran las anteriores.
  guardarRegla({
    tag: 'operacion en apertura de mercado',
    condiciones: [{ campo: 'hora_mercado', operador: 'entre', valor: 9.5, valor2: 9.75 }],
  });

  const V = Date.UTC(2026, 10, 13, 14, 30, 0); // 09:30 NY
  op(30, V + 60_000, V + 12 * 60_000);         // apertura + salida en el 12
  calcularEtiquetas();

  const ex = explicarDerivadas(30);
  check('explica las dos etiquetas', ex.length === 2, `${ex.length}`);
  check('todas vigentes', ex.every((e) => e.vigente));

  const doce = ex.find((e) => e.tag === 'salida a tiempo 12m');
  check('nombra el campo en palabras', !!doce && doce.porque.includes('Minuto de la vela de 15m al salir'), doce?.porque);
  check('  y trae el valor real de la operacion', !!doce && doce.porque.includes('el tuyo: 12'), doce?.porque);

  const apertura = ex.find((e) => e.tag === 'operacion en apertura de mercado');
  check('un "entre" se lee como entre', !!apertura && apertura.porque.includes('entre 9.5 y 9.75'), apertura?.porque);
  check('  con el valor sin ceros de relleno', !!apertura && apertura.porque.includes('el tuyo: 9.52'), apertura?.porque);

  // Y lo que importa de verdad: si la regla cambia y no se recalcula, la
  // etiqueta sigue puesta pero YA NO esta justificada. Eso se tiene que ver.
  const regla = listarReglas().find((r) => r.tag === 'salida a tiempo 12m')!;
  guardarRegla({ id: regla.id, tag: regla.tag, condiciones: [{ campo: 'minuto_salida_en_vela15', operador: '=', valor: 7 }] });

  const tras = explicarDerivadas(30).find((e) => e.tag === 'salida a tiempo 12m');
  check('una etiqueta huerfana se marca como no vigente', tras?.vigente === false, `${tras?.vigente}`);
  check('  y lo dice en palabras', !!tras && tras.porque.includes('vuelve a pulsar calcular'), tras?.porque);

  // Al recalcular desaparece, que es lo que la linea ambar estaba anunciando.
  calcularEtiquetasDe(30);
  check('y al calcular se va', !getNote(30).tags.includes('salida a tiempo 12m'), getNote(30).tags.join(', '));

  check('sin derivadas no hay nada que explicar', explicarDerivadas(99999).length === 0);
}

console.log('\nbase temporal:', process.env.JOURNAL_DB);
