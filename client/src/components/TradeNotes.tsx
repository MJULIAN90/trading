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
        {sortByPolarity(tags, prefs.tagPolarity).map((t) => (
          <button
            key={t}
            className={`tag on ${
              tagClass(t, prefs.tagPolarity, prefs.tagKind)
            }`}
            onClick={() => removeTag(t)}
            title="Quitar de ESTA operacion. La categoria no se borra: vuelve abajo para reutilizarla."
          >
            {t} ×
          </button>
        ))}
        {tags.length === 0 && <span className="note">sin etiquetas todavia</span>}
      </div>

      <div className="note" style={{ marginTop: 2, marginBottom: 8 }}>
        La <b>×</b> quita la etiqueta de esta operacion; la categoria sigue en la lista. Las
        categorias solo se borran o se renombran desde Ajustes, y ahi tambien se marca cual es
        buena y cual es mala.
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
                {delEje.map((t) => (
                  <button key={t} className="tag" onClick={() => addTag(t)} title={KIND_HELP[eje]}>
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
    </div>
  );
}
