import { useEffect, useState } from 'react';
import {
  TIMEFRAMES,
  api,
  timeframeLabel,
  type ChartPrefs,
  type EmaSetting,
  type TagImpact,
} from '../api';
import { signClass, signedUsd } from '../format';
import { useSticky } from '../sticky';
import {
  KINDS,
  KIND_HELP,
  KIND_LABEL,
  kindOf,
  polarityApplies,
  polarityClass,
  polarityOf,
  tagsOfKind,
} from '../tags';

/**
 * Las pestanas salen de una pregunta sencilla: ¿que estoy viniendo a cambiar?
 *
 * El reparto no es estetico. El editor de etiquetas vivia DENTRO de "Grafico
 * de la operacion", justo debajo de "Margen derecho", porque era donde habia
 * sitio. No tiene nada que ver con el grafico, y mientras estuvo ahi era
 * invisible para cualquiera que no supiera que estaba.
 */
const TABS = ['grafico', 'etiquetas', 'costes', 'datos'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = {
  grafico: 'Grafico',
  etiquetas: 'Etiquetas',
  costes: 'Costes',
  datos: 'Datos',
};

/**
 * Ajustes de la instalacion: lo que cada quien quiere ver y con que numeros se
 * calculan sus metricas.
 *
 * Dos reglas de las que no me muevo aqui:
 *
 * 1. Nada se guarda al teclear. Se escribe, se pulsa Guardar y entonces se
 *    manda. Un campo que se autoguarda mientras escribes "20" pasa por "2" y
 *    deja la EMA en 2 durante un instante; con un color, parpadea el grafico
 *    entero en cada movimiento del selector.
 * 2. Lo que vuelve del servidor es lo que se ensena. El servidor valida y puede
 *    recortar un valor; si la pantalla se quedara con lo que escribiste,
 *    estarias viendo un numero que la aplicacion no esta usando.
 */

interface Storage {
  totalMb: number;
  tables: Array<{ name: string; mb: number; rows: number | null; share: number }>;
  rawDays: number | null;
  retentionDays: number;
  prunable: number;
}

function EmaRow({
  ema,
  onChange,
}: {
  ema: EmaSetting;
  onChange: (next: EmaSetting) => void;
}) {
  return (
    <tr>
      <td>
        <label style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={ema.on}
            onChange={(e) => onChange({ ...ema, on: e.target.checked })}
          />
        </label>
      </td>
      <td>
        <input
          type="number"
          min="1"
          max="1000"
          value={ema.period}
          style={{ width: 80 }}
          onChange={(e) => onChange({ ...ema, period: Number(e.target.value) })}
        />
      </td>
      <td>
        <input
          type="color"
          value={ema.color}
          style={{ width: 46, height: 26, padding: 2 }}
          onChange={(e) => onChange({ ...ema, color: e.target.value })}
        />
        <span style={{ color: 'var(--ink-muted)', fontSize: 11, marginLeft: 8 }}>{ema.color}</span>
      </td>
    </tr>
  );
}

export function SettingsPanel({
  prefs,
  commission,
  onSaved,
}: {
  prefs: ChartPrefs;
  commission: number;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ChartPrefs>(prefs);
  const [fee, setFee] = useState(String(commission));
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [bars, setBars] = useState<Array<{ symbol: string; bars: number; from: number; to: number }>>([]);
  // Cuantas operaciones usan cada etiqueta. Este es el unico sitio de la
  // aplicacion donde se borra una categoria, asi que aqui hay que saber a que
  // se esta renunciando antes de hacerlo.
  const [tagUse, setTagUse] = useState<Record<string, number>>({});
  /**
   * Lo que cada etiqueta sumo o resto DE VERDAD. Va al lado de la calificacion
   * a mano, no en su lugar: la columna de la izquierda es lo que el cree y esta
   * es lo que midieron sus operaciones, y el dia que no coincidan hay que poder
   * verlo. Mezclarlas haria imposible la pregunta mas util de todas, que es en
   * que se esta equivocando al juzgar sus propias conductas.
   */
  const [tagStats, setTagStats] = useState<Record<string, TagImpact>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [renameMsg, setRenameMsg] = useState<string | null>(null);
  const [tab, setTab] = useSticky<Tab>('ajustes.tab', 'grafico', (v) =>
    (TABS as readonly string[]).includes(v),
  );

  useEffect(() => { setDraft(prefs); }, [prefs]);
  useEffect(() => { setFee(String(commission)); }, [commission]);

  useEffect(() => {
    // Informativo: si falla, la pantalla de ajustes sigue sirviendo para lo
    // que de verdad importa, que es cambiar cosas.
    fetch('/api/storage').then((r) => r.json()).then(setStorage).catch(() => {});
    fetch('/api/bars/status')
      .then((r) => r.json())
      .then((d) => setBars(d.symbols ?? []))
      .catch(() => {});

    api.tags()
      .then((r) => {
        const m: Record<string, number> = {};
        const s: Record<string, TagImpact> = {};
        for (const row of r.impact ?? []) { m[row.tag] = row.count; s[row.tag] = row; }
        setTagUse(m);
        setTagStats(s);
      })
      .catch(() => {});
  }, []);

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(prefs) || Number(fee) !== commission;

  /** Recuenta los usos. Despues de renombrar los numeros cambian. */
  async function reloadUse() {
    try {
      const r = await api.tags();
      const m: Record<string, number> = {};
      const s: Record<string, TagImpact> = {};
      for (const row of r.impact ?? []) { m[row.tag] = row.count; s[row.tag] = row; }
      setTagUse(m);
      setTagStats(s);
    } catch {
      // Los contadores son informativos; sin ellos se sigue pudiendo editar.
    }
  }

  /**
   * Renombra una etiqueta. Se aplica al momento, no al pulsar Guardar.
   *
   * La lista local se actualiza a mano en vez de coger la que devuelve el
   * servidor: si hay etiquetas nuevas sin guardar en el borrador, la del
   * servidor no las lleva y pisarla las perderia.
   */
  async function applyRename(from: string, raw: string) {
    const to = raw.trim().toLowerCase().slice(0, 40);

    if (!to || to === from) {
      setEditing(null);
      return;
    }

    const actuales = draft.noteTags ?? [];
    const fusiona = actuales.includes(to) || (tagUse[to] ?? 0) > 0;

    if (fusiona) {
      const deOrigen = tagUse[from] ?? 0;
      const deDestino = tagUse[to] ?? 0;
      const ok = window.confirm(
        `Ya existe "${to}".\n\n` +
        `Renombrar "${from}" a "${to}" FUSIONA las dos en una sola.\n` +
        `Se moveran ${deOrigen} operacion(es) de "${from}" a "${to}", que ya tiene ${deDestino}.\n\n` +
        'Esto no se puede deshacer desde la aplicacion. ¿Fusionar?',
      );
      if (!ok) return;
    }

    try {
      const r = await api.renameTag(from, to);

      const siguiente: string[] = [];
      for (const t of actuales) {
        const next = t === from ? to : t;
        if (!siguiente.includes(next)) siguiente.push(next);
      }
      if (!siguiente.includes(to)) siguiente.push(to);

      setDraft((d) => ({ ...d, noteTags: siguiente }));
      setEditing(null);
      setRenameMsg(
        r.merged
          ? `"${from}" fusionada en "${to}". Se movieron ${r.operations} operacion(es).`
          : `"${from}" pasa a llamarse "${to}" en ${r.operations} operacion(es).`,
      );

      await reloadUse();
      onSaved();
    } catch (e) {
      setRenameMsg(`No se pudo renombrar: ${(e as Error).message}`);
      setEditing(null);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const applied = await api.saveChartPrefs(draft);
      setDraft(applied);

      const n = Number(fee);
      if (Number.isFinite(n) && n >= 0 && n !== commission) await api.saveSettings(n);

      setSaved(new Date().toLocaleTimeString());
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const setEma = (i: number, next: EmaSetting) =>
    setDraft((d) => ({ ...d, emas: d.emas.map((e, j) => (j === i ? next : e)) }));

  return (
    <>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'grafico' && (
      <div className="panel">
        <h2>Grafico de la operacion</h2>

        <div className="filters">
          <label>
            Temporalidad
            <select
              value={draft.timeframe}
              onChange={(e) => setDraft({ ...draft, timeframe: Number(e.target.value) })}
            >
              {TIMEFRAMES.map((t) => (
                <option key={t} value={t}>{timeframeLabel(t)}</option>
              ))}
            </select>
          </label>

          <label>
            Velas
            <input
              type="number"
              min="20"
              max="1000"
              step="10"
              value={draft.candles}
              style={{ width: 80 }}
              onChange={(e) => setDraft({ ...draft, candles: Number(e.target.value) })}
            />
          </label>

          <label title="Que parte de las velas se ensena antes de la entrada">
            Antes de la entrada
            <select
              value={draft.beforeShare}
              onChange={(e) => setDraft({ ...draft, beforeShare: Number(e.target.value) })}
            >
              {[0.5, 0.66, 0.75, 0.85].map((v) => (
                <option key={v} value={v}>{Math.round(v * 100)}%</option>
              ))}
            </select>
          </label>

          <label>
            <input
              type="checkbox"
              checked={draft.showSessions}
              onChange={(e) => setDraft({ ...draft, showSessions: e.target.checked })}
            />
            killzones encendidas
          </label>
        </div>

        {/* Margenes del grafico. Se guardan aqui, en el servidor, para que
            valgan en TODAS las operaciones y no solo en la que estes viendo. */}
        <div className="filters" style={{ marginTop: 8 }}>
          <label title="Hueco entre la ULTIMA VELA y el eje de precio, medido en velas. 0 las pega al borde.">
            Margen derecho
            <input
              type="number"
              min="0"
              max="300"
              step="1"
              value={draft.rightOffset}
              style={{ width: 70 }}
              onChange={(e) => setDraft({ ...draft, rightOffset: Number(e.target.value) })}
            />
            <span className="note" style={{ marginLeft: 4 }}>velas</span>
          </label>

          <label title="Donde cae la entrada dentro de la ventana. Mas alto = la entrada mas a la derecha y menos hueco despues.">
            Entrada al
            <select
              value={draft.entryShare}
              onChange={(e) => setDraft({ ...draft, entryShare: Number(e.target.value) })}
            >
              {[0.4, 0.55, 0.7, 0.8, 0.9].map((v) => (
                <option key={v} value={v}>{Math.round(v * 100)}%</option>
              ))}
            </select>
          </label>

          <label title="Aire por encima de las velas">
            Aire arriba
            <select
              value={draft.marginTop}
              onChange={(e) => setDraft({ ...draft, marginTop: Number(e.target.value) })}
            >
              {[0, 0.04, 0.08, 0.14, 0.22].map((v) => (
                <option key={v} value={v}>{Math.round(v * 100)}%</option>
              ))}
            </select>
          </label>

          <label title="Altura del delta abajo. El margen inferior del precio vale lo mismo, asi que no queda hueco muerto.">
            Delta abajo
            <select
              value={draft.deltaShare}
              onChange={(e) => setDraft({ ...draft, deltaShare: Number(e.target.value) })}
            >
              {[0.1, 0.14, 0.18, 0.25, 0.32].map((v) => (
                <option key={v} value={v}>{Math.round(v * 100)}%</option>
              ))}
            </select>
          </label>
        </div>

        <div className="note">
          Las velas son un techo, no una promesa: el mercado para una hora al dia y los fines de
          semana, y la parte posterior a una operacion reciente todavia no existe. En 4h es normal
          ver la mitad de las que pides.
        </div>
      </div>
      )}

      {tab === 'etiquetas' && (
      <div className="panel">
        <h2>Etiquetas</h2>

        <div className="note" style={{ marginBottom: 8, lineHeight: 1.5 }}>
          Las categorias que se ofrecen al anotar una operacion.{' '}
          <b>Este es el unico sitio donde se borran o se renombran.</b> Desde la pantalla de notas
          solo se ponen y se quitan de cada operacion.
          <br />
          <b>Tres ejes.</b> <i>Estrategia</i> es qu&eacute; clase de operaci&oacute;n era y la eliges antes
          de entrar: solo una por operaci&oacute;n, y poner otra sustituye a la anterior.{' '}
          <i>Contexto</i> es lo que hab&iacute;a en el mercado, que te lo encuentras. Ninguna de las dos
          es buena ni mala. <b>Solo la conducta lleva calificaci&oacute;n</b>, porque dentro de
          cualquier estrategia puedes ejecutar bien o fatal.
          <br />
          <b>Renombrar se aplica al momento</b>, no al pulsar Guardar: cambia tambien el nombre en
          las operaciones que ya la llevan. Si no lo hiciera, donde habia una conducta pasaria a
          haber dos con la mitad de los casos cada una, y las estadisticas por etiqueta dejarian de
          significar nada.
        </div>

        <table className="tag-table">
          <thead>
            <tr>
              <th>Etiqueta</th>
              <th title="De que habla la etiqueta. Solo las de conducta pueden ser buenas o malas.">Eje</th>
              <th title="Lo que TU crees que es esa conducta. Es una hipotesis.">Calificacion</th>
              <th title="Lo que dicen tus operaciones con esa etiqueta. Esto es el dato.">
                Lo que miden tus operaciones
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {KINDS.flatMap((eje) =>
              tagsOfKind(draft.noteTags ?? [], draft.tagKind, eje, draft.tagPolarity),
            ).map((t) => {
              const usos = tagUse[t] ?? 0;
              const medido = tagStats[t];
              const pol = polarityOf(t, draft.tagPolarity);
              const eje = kindOf(t, draft.tagKind);
              const conPolaridad = polarityApplies(t, draft.tagKind);

              const setEje = (next: 'estrategia' | 'contexto' | 'conducta') => {
                const mapa = { ...(draft.tagKind ?? {}) };
                if (next === 'conducta') delete mapa[t];
                else mapa[t] = next;

                // Al sacarla de conducta pierde la calificacion: una
                // estrategia no es buena ni mala, y dejarle el color guardado
                // haria que volviera a aparecer sola si algun dia la devuelves
                // a conducta sin querer.
                const pols = { ...(draft.tagPolarity ?? {}) };
                if (next !== 'conducta') delete pols[t];

                setDraft({ ...draft, tagKind: mapa, tagPolarity: pols });
              };

              const setPol = (next: 'buena' | 'mala' | 'neutra') => {
                const mapa = { ...(draft.tagPolarity ?? {}) };
                if (next === 'neutra') delete mapa[t];
                else mapa[t] = next;
                setDraft({ ...draft, tagPolarity: mapa });
              };

              // Cuando la creencia y la medida no coinciden, se dice. Es el
              // unico motivo por el que las dos columnas estan juntas.
              const choca =
                conPolaridad && medido && medido.count >= 5 &&
                ((pol === 'mala' && medido.pnl > 0) || (pol === 'buena' && medido.pnl < 0));

              return (
                <tr key={t}>
                  <td>
                    {editing === t ? (
                      <input
                        autoFocus
                        value={editDraft}
                        maxLength={40}
                        style={{ width: 190 }}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onBlur={() => setEditing(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') { setEditing(null); return; }
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          void applyRename(t, editDraft);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className={`tag ${conPolaridad ? polarityClass(pol) : ''}`}
                        title="renombrar (cambia tambien las operaciones que ya la llevan)"
                        onClick={() => { setEditing(t); setEditDraft(t); }}
                      >
                        {t}{usos > 0 ? ` (${usos})` : ''}
                      </button>
                    )}
                  </td>

                  <td>
                    <select
                      value={eje}
                      title={KIND_HELP[eje]}
                      onChange={(e) => setEje(e.target.value as 'estrategia' | 'contexto' | 'conducta')}
                    >
                      {KINDS.map((v) => (
                        <option key={v} value={v}>{KIND_LABEL[v]}</option>
                      ))}
                    </select>
                  </td>

                  <td>
                    {conPolaridad ? (
                      <select value={pol} onChange={(e) => setPol(e.target.value as 'buena' | 'mala' | 'neutra')}>
                        <option value="buena">buena</option>
                        <option value="neutra">sin calificar</option>
                        <option value="mala">mala</option>
                      </select>
                    ) : (
                      // Sin desplegable, y con el motivo escrito. Dejarlo
                      // desactivado invitaria a preguntarse por que no se
                      // puede tocar; asi se lee de una vez.
                      <span className="note">no aplica</span>
                    )}
                  </td>

                  <td className="note">
                    {!medido || medido.count === 0 ? (
                      'todavia sin operaciones'
                    ) : (
                      <>
                        <b className={signClass(medido.pnl)}>{signedUsd(medido.pnl, 0)}</b>
                        {' en '}{medido.count} ops · {Math.round((medido.wins / medido.count) * 100)}% acierto
                        {medido.count < 10 && <span> · muestra corta</span>}
                        {choca && (
                          <div className="neg">
                            La marcaste <b>{pol}</b> y los numeros dicen lo contrario.
                          </div>
                        )}
                      </>
                    )}
                  </td>

                  <td>
                    <button
                      type="button"
                      className="tag-x"
                      title={
                        usos > 0
                          ? `borrar la categoria (la usan ${usos} operaciones)`
                          : 'borrar la categoria (no la usa ninguna operacion)'
                      }
                      onClick={() => {
                        if (usos > 0 && !window.confirm(
                          `"${t}" esta puesta en ${usos} operacion(es).\n\n` +
                          'Al borrarla dejara de ofrecerse al anotar. Las operaciones que ya ' +
                          'la llevan la conservan, pero no podras ponersela a ninguna nueva.\n\n' +
                          '¿Borrar la categoria?',
                        )) {
                          return;
                        }
                        const mapa = { ...(draft.tagPolarity ?? {}) };
                        delete mapa[t];
                        setDraft({
                          ...draft,
                          noteTags: (draft.noteTags ?? []).filter((x) => x !== t),
                          tagPolarity: mapa,
                        });
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>


        <div className="notes-new" style={{ marginTop: 8 }}>
          <input
            value={tagDraft}
            placeholder="etiqueta nueva y Enter"
            maxLength={40}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();

              // Misma normalizacion que al anotar: sin esto "Revancha" y
              // "revancha" contarian como dos conductas distintas.
              const clean = tagDraft.trim().toLowerCase().slice(0, 40);
              const actuales = draft.noteTags ?? [];

              if (!clean || actuales.includes(clean)) {
                setTagDraft('');
                return;
              }

              setDraft({ ...draft, noteTags: [...actuales, clean] });
              setTagDraft('');
            }}
          />
        </div>

        {renameMsg && <div className="note" style={{ marginTop: 8 }}>{renameMsg}</div>}
      </div>
      )}

      {tab === 'grafico' && (
      <div className="panel">
        <h2>Medias moviles</h2>

        <table>
          <thead>
            <tr><th>Estado</th><th>Periodo</th><th>Color</th></tr>
          </thead>
          <tbody>
            {draft.emas.map((e, i) => (
              <EmaRow key={i} ema={e} onChange={(next) => setEma(i, next)} />
            ))}
          </tbody>
        </table>

        <div className="note">
          Se calculan sobre las velas que estas viendo: una EMA de 21 en 4h es otra linea distinta
          de una EMA de 21 en 1m. Si pides un periodo mayor que el numero de velas del grafico, la
          linea no se dibuja y la leyenda lo avisa.
        </div>
      </div>
      )}

      {tab === 'costes' && (
      <div className="panel">
        <h2>Costes</h2>

        <div className="filters">
          <label title="Comision mas tasas por contrato, ida y vuelta completa">
            Comision
            <input
              type="number"
              step="0.05"
              min="0"
              value={fee}
              style={{ width: 90 }}
              onChange={(e) => setFee(e.target.value)}
            />
            $/contrato
          </label>
        </div>

        <div className="note">
          <b>Este numero lo pones tu, no viene del broker.</b> En las 329 ejecuciones guardadas el
          campo de comision llega vacio, que es lo normal en una cuenta de simulacion. Todo lo que
          la aplicacion llama &quot;neto&quot; sale de multiplicar esta cifra por los contratos, asi
          que si no se parece a lo que te cobran de verdad, no se parecera ninguna metrica.
        </div>
      </div>
      )}

      {/* La barra de guardar se esconde en "Datos", que no tiene nada que
          guardar... salvo que haya cambios pendientes en otra pestana. Un
          aviso de "hay cambios sin guardar" que desaparece al cambiar de
          pestana es la forma mas facil de perder lo que acabas de escribir. */}
      {(tab !== 'datos' || dirty) && (
      <div className="save-bar">
        <button className="primary" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
        <button disabled={!dirty || saving} onClick={() => { setDraft(prefs); setFee(String(commission)); }}>
          Descartar
        </button>
        {error && <span className="neg">No se pudo guardar: {error}</span>}
        {!error && saved && !dirty && <span className="live">guardado a las {saved}</span>}
        {dirty && !saving && <span style={{ color: 'var(--warn)' }}>hay cambios sin guardar</span>}
      </div>
      )}

      {tab === 'datos' && (
      <div className="panel">
        <h2>Donde vive todo esto</h2>

        {storage ? (
          <>
            <table>
              <thead>
                <tr><th>Tabla</th><th>Tamano</th><th>Filas</th><th>Del total</th></tr>
              </thead>
              <tbody>
                {/* Solo las tablas de verdad. `dbstat` devuelve tambien cada
                    indice interno de SQLite, que son veinte filas de 0 MB y
                    tapan las cuatro que interesan. Lo que ocupan se suma en una
                    sola linea para que el total siga cuadrando. */}
                {storage.tables
                  .filter((t) => t.rows !== null)
                  .map((t) => (
                    <tr key={t.name}>
                      <td>{t.name}</td>
                      <td>{t.mb} MB</td>
                      <td>{t.rows!.toLocaleString('es')}</td>
                      <td>{Math.round(t.share * 100)}%</td>
                    </tr>
                  ))}
                {(() => {
                  const idx = storage.tables.filter((t) => t.rows === null);
                  if (idx.length === 0) return null;
                  const mb = idx.reduce((a, t) => a + t.mb, 0);
                  return (
                    <tr style={{ color: 'var(--ink-muted)' }}>
                      <td>indices internos ({idx.length})</td>
                      <td>{mb.toFixed(2)} MB</td>
                      <td>—</td>
                      <td>{storage.totalMb > 0 ? Math.round((mb / storage.totalMb) * 100) : 0}%</td>
                    </tr>
                  );
                })()}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 600 }}>
                  <td>Total</td><td>{storage.totalMb} MB</td><td colSpan={2} />
                </tr>
              </tfoot>
            </table>

            <div className="note">
              Todo esta en un solo fichero SQLite, <code>data/journal.db</code>. Es lo unico que hay
              que copiar para llevarse el historial a otro ordenador: las operaciones, las velas, las
              notas y estos ajustes.
              {storage.rawDays !== null && (
                <> Hay <b>{storage.rawDays} dias</b> de JSON crudo guardado.</>
              )}
            </div>
          </>
        ) : (
          <div className="empty">sin datos de almacenamiento</div>
        )}

        {bars.length > 0 && (
          <>
            <h2 style={{ marginTop: 18 }}>Velas capturadas</h2>
            <table>
              <thead><tr><th>Simbolo</th><th>Velas de 1m</th></tr></thead>
              <tbody>
                {bars.map((b) => (
                  <tr key={b.symbol}><td>{b.symbol}</td><td>{b.bars.toLocaleString('es')}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      )}
    </>
  );
}
