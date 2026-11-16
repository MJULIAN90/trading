import { useEffect, useRef, useState } from 'react';
import { api, type ChartPrefs, type OperationNote } from '../api';
import {
  KINDS,
  KIND_HELP,
  KIND_LABEL,
  POLARITY_LABEL,
  kindOf,
  polarityClass,
  polarityOf,
  sortByPolarity,
  tagsOfKind,
  tagsOfPolarity,
  tagClass,
} from '../tags';

/**
 * Notas y etiquetas de una operacion.
 *
 * Las etiquetas son el motivo de que esto exista. Una nota libre te sirve para
 * recordar, pero no se puede medir. Una etiqueta que aparece en quince
 * operaciones y suma -300 deja de ser una sensacion y pasa a ser una conducta
 * con precio.
 */

export function TradeNotes({
  operationId,
  prefs,
  onSaved,
}: {
  operationId: number;
  prefs: ChartPrefs;
  /**
   * Avisa de que la nota o las etiquetas ya estan guardadas en el servidor.
   *
   * Existe porque este panel no es el unico sitio donde se ven: el listado de
   * la izquierda pinta un punto por cada etiqueta y un circulo si hay nota, y
   * el globo del raton las lee. Esos datos vienen de la llamada que trajo el
   * listado, que no se entera de nada de lo que pasa aqui dentro.
   *
   * Sin este aviso, escribias una nota, se guardaba bien, y la fila seguia sin
   * su punto hasta que te ibas a otra pestaña y volvias — o sea que parecia
   * que no se habia guardado.
   */
  onSaved?: () => void;
}) {
  // Las sugerencias salen de los ajustes, no de una lista clavada en el codigo.
  //
  // El `?? []` no sobra: si el servidor esta corriendo una version anterior a
  // este campo, responde sin el, y `prefs.noteTags.filter` reventaria el panel
  // entero. Sin sugerencias se puede anotar; con el panel roto, no.
  const configuradas = prefs.noteTags ?? [];

  const [data, setData] = useState<OperationNote | null>(null);
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  // Las que puso una regla. Se pintan distinto y no se pueden quitar desde aqui.
  const [derivadas, setDerivadas] = useState<string[]>([]);
  const [calculando, setCalculando] = useState(false);
  const [avisoAuto, setAvisoAuto] = useState<string | null>(null);
  // Por que lleva cada derivada, para poder ensenarlo al pasar por encima.
  const [porQue, setPorQue] = useState<Record<string, { porque: string; vigente: boolean }>>({});
  const [explicando, setExplicando] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);
  // Etiquetas que existen en alguna operacion aunque no esten en ajustes.
  const [usadas, setUsadas] = useState<string[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.notes(operationId).then((d) => {
      if (cancelled) return;
      setData(d);
      setNote(d.note);
      setTags(d.tags);
      setDerivadas(d.derivadas ?? []);
      setPorQue(Object.fromEntries((d.porQue ?? []).map((x) => [x.tag, x])));
    });
    return () => { cancelled = true; };
  }, [operationId]);

  // Las que ya se usaron alguna vez se piden una sola vez por montaje. Sirven
  // para que el catalogo de esta pantalla sea TODO lo que existe, no solo lo
  // que esta en ajustes: asi una categoria nunca desaparece de la vista por
  // haberla quitado de una operacion.
  useEffect(() => {
    let cancelled = false;
    api.tags()
      .then((r) => { if (!cancelled) setUsadas(r.all ?? []); })
      .catch(() => { /* sin esto se anota igual, solo con menos sugerencias */ });
    return () => { cancelled = true; };
  }, []);

  // Orden estable: primero las configuradas, en el orden de ajustes; detras
  // las que solo viven en operaciones. Un catalogo que se reordena solo es
  // imposible de usar de memoria.
  const catalogo = [...configuradas, ...usadas.filter((t) => !configuradas.includes(t))];

  /** Las que todavia no estan puestas en esta operacion. */
  const disponibles = catalogo.filter((s) => !tags.includes(s));

  /**
   * Guardado automatico con retardo. Sin esto habria que acordarse de pulsar un
   * boton, y una nota que no se guarda es peor que no tenerla: crees que esta.
   */
  function scheduleSave(nextNote: string, nextTags: string[]) {
    if (timer.current) window.clearTimeout(timer.current);
    setSaved(false);

    timer.current = window.setTimeout(() => {
      api.saveNotes(operationId, nextNote, nextTags).then((d) => {
        setData(d);
        setSaved(true);
        // Despues de guardar, no antes: si se avisara al teclear, el listado
        // se recargaria con cada letra.
        onSaved?.();
      });
    }, 600);
  }

  function addTag(tag: string) {
    const clean = tag.trim().toLowerCase().slice(0, 40);
    if (!clean || tags.includes(clean)) return;

    // Una sola estrategia por operacion: al poner una, la anterior se cae.
    // Asi cada operacion pertenece a un grupo y solo a uno, que es lo unico
    // que hace comparables las metricas por estrategia. El servidor aplica la
    // misma regla; aqui se hace ademas para que se vea al instante.
    const base =
      kindOf(clean, prefs.tagKind) === 'estrategia'
        ? tags.filter((t) => kindOf(t, prefs.tagKind) !== 'estrategia')
        : tags;

    const next = [...base, clean];
    setTags(next);
    scheduleSave(note, next);

    // Una etiqueta escrita a mano pasa a ser una categoria del catalogo.
    //
    // Antes no: se quedaba pegada a esa operacion y a ninguna otra. Al
    // quitarla de ahi desaparecia de la pantalla, y esa era la UNICA forma
    // real de perder una categoria desde aqui. Guardarla en ajustes cierra
    // ese agujero; si luego sobra, se quita desde ajustes, que es su sitio.
    if (!configuradas.includes(clean)) {
      setUsadas((prev) => (prev.includes(clean) ? prev : [...prev, clean]));
      api.saveChartPrefs({ noteTags: [...configuradas, clean] }).catch(() => {
        // Que no se guarde en ajustes no impide etiquetar la operacion.
      });
    }
  }

  /**
   * Quita la etiqueta DE ESTA OPERACION. No borra la categoria: sigue en el
   * catalogo de abajo para volver a ponerla aqui o en cualquier otra.
   *
   * Es una distincion que importa de verdad: las estadisticas por etiqueta se
   * sostienen sobre que la misma conducta se llame siempre igual. Si quitarla
   * de una operacion la borrara del catalogo, la proxima vez se escribiria
   * parecido pero distinto y las dos tendrian la mitad de los casos.
   */
  /**
   * Recalcula las etiquetas automaticas de ESTA operacion.
   *
   * Hace lo mismo que el boton de Ajustes pero sobre una fila, y eso es lo que
   * lo hace util: al revisar una operacion se ve en el momento lo que las
   * reglas le ponen, que es la unica forma de saber si una regla dice lo que
   * crees que dice. El de Ajustes hay que ir a buscarlo y devuelve un total.
   */
  async function calcularEstaOperacion() {
    setCalculando(true);
    setAvisoAuto(null);

    try {
      const r = await api.calcularAutotagsDe(operationId);

      // Las etiquetas se toman de la nota que devuelve el servidor, no de un
      // apano local: asi lo que se pinta es lo que quedo guardado.
      setTags(r.nota.tags);
      setDerivadas(r.nota.derivadas ?? []);
      setPorQue(Object.fromEntries((r.nota.porQue ?? []).map((x) => [x.tag, x])));
      setData(r.nota);

      const partes: string[] = [];
      if (r.puestas.length > 0) partes.push(`puestas: ${r.puestas.join(', ')}`);
      if (r.quitadas.length > 0) partes.push(`retiradas: ${r.quitadas.join(', ')}`);

      setAvisoAuto(
        partes.length > 0
          ? partes.join(' · ')
          : `ninguna de las ${r.reglas} reglas encaja con esta operacion`,
      );
    } catch {
      setAvisoAuto('no se pudo calcular');
    } finally {
      setCalculando(false);
    }
  }

  function removeTag(tag: string) {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    scheduleSave(note, next);
  }

  if (!data) return <div className="empty">cargando notas...</div>;

  return (
    <div className="notes">
      {/* Las puestas, juntas arriba y en el mismo orden de siempre. */}
      <div className="notes-tags">
        {sortByPolarity(tags, prefs.tagPolarity).map((t) => {
          // Una derivada no se quita desde aqui: la puso una regla y el
          // siguiente "Calcular" la volveria a poner. Se pinta sin ✕ y sin
          // onClick en vez de con una ✕ que no hace nada, que seria peor.
          const derivada = derivadas.includes(t);

          return (
            <button
              key={t}
              className={`tag on ${tagClass(t, prefs.tagPolarity, prefs.tagKind)}${
                derivada ? ' derivada' : ''
              }`}
              onClick={derivada ? undefined : () => removeTag(t)}
              // El globo nativo del navegador tarda casi un segundo en salir y
              // no se puede estilar; en una derivada, ademas, el raton pasa por
              // encima y sigue, porque no hay nada que pulsar. La explicacion
              // se ensena abajo, en el sitio fijo que ya usa el aviso del
              // calculo, y aparece al instante.
              onMouseEnter={derivada ? () => setExplicando(t) : undefined}
              onMouseLeave={derivada ? () => setExplicando(null) : undefined}
              title={
                derivada
                  ? undefined
                  : 'Quitar de ESTA operacion. La categoria no se borra: vuelve abajo para reutilizarla.'
              }
            >
              {derivada ? `⚙ ${t}` : `${t} ×`}
            </button>
          );
        })}
        {tags.length === 0 && <span className="note">sin etiquetas todavia</span>}

        {/* Va con los chips y no abajo del todo: lo que hace es ANADIR chips a
            esa misma fila, y un boton lejos de lo que cambia obliga a buscar
            con la vista que se movio. */}
        <button
          className="calcular-una"
          onClick={calcularEstaOperacion}
          disabled={calculando}
          title="Aplica a ESTA operacion las reglas de Ajustes. Las que pusiste tu no se tocan."
        >
          {calculando ? '...' : '⚙ calcular'}
        </button>
      </div>

      {/* Un solo sitio para las dos cosas: al pasar por encima de una derivada,
          por que la lleva; despues de calcular, que cambio. Si cada una tuviera
          su hueco, la fila de etiquetas saltaria de sitio al mover el raton. */}
      {(explicando || avisoAuto) && (
        <div
          className={`note auto-por-que${
            explicando && porQue[explicando]?.vigente === false ? ' caduca' : ''
          }`}
        >
          {explicando
            ? `${explicando} — ${porQue[explicando]?.porque ?? 'la puso una regla'}`
            : avisoAuto}
        </div>
      )}

      {/* EL CUADRO DE TEXTO VA AQUI ARRIBA, NO AL FINAL.
          Es lo que se escribe mirando la vela, asi que tiene que caber en la
          misma pantalla que el grafico. Debajo de treinta botones de etiqueta
          quedaba a un scroll de distancia, y para cuando llegabas ya no te
          acordabas de en que vela estaba la mecha. El catalogo, en cambio, se
          busca con la vista: da igual que haya que bajar a por el. */}
      <textarea
        value={note}
        rows={4}
        placeholder="Que viste, por que entraste, que harias distinto."
        onChange={(e) => {
          setNote(e.target.value);
          scheduleSave(e.target.value, tags);
        }}
      />

      <div className="op-meta">
        {saved ? 'guardado' : 'se guarda solo'}
        {data.updatedAt ? ` · ultima vez ${new Date(data.updatedAt).toLocaleString('es')}` : ''}
      </div>

      <div className="note" style={{ marginTop: 14, marginBottom: 8 }}>
        La <b>×</b> de arriba quita la etiqueta de esta operacion; la categoria sigue en la
        lista de abajo. Las categorias solo se borran o se renombran desde Ajustes, y ahi
        tambien se marca cual es buena y cual es mala.
        {' '}Las que llevan <b>⚙</b> las puso una regla sola y no se quitan a mano: se
        cambia la regla en Ajustes y se vuelve a pulsar «Calcular».
      </div>

      {/* El catalogo, en tres bloques. Buenas arriba y malas abajo porque al
          anotar en caliente la mano va antes que la vista: si la posicion de
          cada etiqueta cambia, se acaba pulsando la de al lado. */}
      {/* El catalogo por EJES, y dentro de conducta por polaridad.
          Estrategia primero porque es lo que se decide antes de entrar, y
          contexto despues porque describe lo que te encontraste. La conducta
          va al final: es lo ultimo que sabes, cuando la operacion acabo. */}
      {KINDS.map((eje) => {
        const delEje = tagsOfKind(disponibles, prefs.tagKind, eje, prefs.tagPolarity);
        if (delEje.length === 0) return null;

        const yaHayEstrategia =
          eje === 'estrategia' && tags.some((t) => kindOf(t, prefs.tagKind) === 'estrategia');

        return (
          <div key={eje} className="tag-group">
            <div className="tag-group-title" title={KIND_HELP[eje]}>
              {KIND_LABEL[eje]}
              {yaHayEstrategia && <span className="note"> · elegir otra sustituye a la puesta</span>}
            </div>

            {eje === 'conducta' ? (
              // Dentro de conducta, los tres bloques de siempre: buenas
              // arriba, malas abajo. Anotando en caliente la mano va antes
              // que la vista, y si la posicion cambia se pulsa la de al lado.
              (['buena', 'neutra', 'mala'] as const).map((pol) => {
                const delBloque = tagsOfPolarity(delEje, prefs.tagPolarity, pol);
                if (delBloque.length === 0) return null;

                return (
                  <div key={pol}>
                    <div className={`tag-group-sub ${polarityClass(pol)}`}>
                      {POLARITY_LABEL[pol]}
                    </div>
                    <div className="notes-tags">
                      {delBloque.map((t) => (
                        <button
                          key={t}
                          className={`tag ${polarityClass(pol)}`}
                          onClick={() => addTag(t)}
                          title="poner en esta operacion"
                        >
                          + {t}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="notes-tags">
                {/* Con `tagClass` y no con "tag" a secas: eso devuelve el eje
                    -estrategia o contexto-, que es lo que les da color. Los
                    estilos ya existian; estos botones eran los unicos que no
                    pedian la clase, asi que salian grises y no habia forma de
                    distinguir "scalper" de una etiqueta sin calificar. */}
                {delEje.map((t) => (
                  <button
                    key={t}
                    className={`tag ${tagClass(t, prefs.tagPolarity, prefs.tagKind)}`}
                    onClick={() => addTag(t)}
                    title={KIND_HELP[eje]}
                  >
                    + {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="notes-new">
        <input
          value={draft}
          maxLength={40}
          placeholder="etiqueta propia y Enter (se guarda como categoria)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              addTag(draft);
              setDraft('');
            }
          }}
        />
      </div>

    </div>
  );
}
