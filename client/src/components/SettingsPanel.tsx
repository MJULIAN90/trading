import { useEffect, useState } from 'react';
import { TIMEFRAMES, api, timeframeLabel, type ChartPrefs, type EmaSetting } from '../api';

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
  }, []);

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(prefs) || Number(fee) !== commission;

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

        {/* Etiquetas de las notas. Quitar una de aqui solo deja de sugerirla:
            las que ya estan puestas en operaciones no se tocan. */}
        <div style={{ marginTop: 12 }}>
          <div className="note" style={{ marginBottom: 6 }}>
            Etiquetas que se ofrecen al anotar una operacion
          </div>

          <div className="notes-tags">
            {draft.noteTags.map((t) => (
              <button
                key={t}
                type="button"
                className="tag on"
                title="quitar de las sugerencias"
                onClick={() =>
                  setDraft({ ...draft, noteTags: draft.noteTags.filter((x) => x !== t) })
                }
              >
                {t} ×
              </button>
            ))}
          </div>

          <div className="notes-new" style={{ marginTop: 6 }}>
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
                if (!clean || draft.noteTags.includes(clean)) {
                  setTagDraft('');
                  return;
                }

                setDraft({ ...draft, noteTags: [...draft.noteTags, clean] });
                setTagDraft('');
              }}
            />
          </div>
        </div>

        <div className="note">
          Las velas son un techo, no una promesa: el mercado para una hora al dia y los fines de
          semana, y la parte posterior a una operacion reciente todavia no existe. En 4h es normal
          ver la mitad de las que pides.
        </div>
      </div>

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
    </>
  );
}
