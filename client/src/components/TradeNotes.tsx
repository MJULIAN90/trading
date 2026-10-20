import { useEffect, useRef, useState } from 'react';
import { api, type ChartPrefs, type OperationNote } from '../api';

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
}: {
  operationId: number;
  prefs: ChartPrefs;
}) {
  // Las sugerencias salen de los ajustes, no de una lista clavada en el codigo.
  const SUGERIDAS = prefs.noteTags;

  const [data, setData] = useState<OperationNote | null>(null);
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);
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
      });
    }, 600);
  }

  function addTag(tag: string) {
    const clean = tag.trim().toLowerCase();
    if (!clean || tags.includes(clean)) return;
    const next = [...tags, clean];
    setTags(next);
    scheduleSave(note, next);
  }

  function removeTag(tag: string) {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    scheduleSave(note, next);
  }

  if (!data) return <div className="empty">cargando notas...</div>;

  return (
    <div className="notes">
      <div className="notes-tags">
        {tags.map((t) => (
          <button key={t} className="tag on" onClick={() => removeTag(t)} title="quitar">
            {t} ×
          </button>
        ))}
        {SUGERIDAS.filter((s) => !tags.includes(s)).map((s) => (
          <button key={s} className="tag" onClick={() => addTag(s)}>
            + {s}
          </button>
        ))}
      </div>

      <div className="notes-new">
        <input
          value={draft}
          placeholder="etiqueta propia y Enter"
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
