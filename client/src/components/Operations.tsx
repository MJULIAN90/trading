import { useEffect, useState } from 'react';
import { api, type Filters, type Operation, type Page } from '../api';
import { dateTime, duration, num, sessionLabel, signClass } from '../format';

function OperationRow({ op }: { op: Operation }) {
  const [open, setOpen] = useState(false);
  const flags = op.review.flags;

  // Las de decision primero: son las unicas sobre las que se puede actuar la
  // proxima vez. Las de resultado solo describen como acabo.
  const ordered = [...flags].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'decision' ? -1 : 1;
    const order = { alert: 0, warn: 1, info: 2, good: 3 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <div className="op">
      <div className="op-head" onClick={() => setOpen((v) => !v)}>
        <span className="when">{dateTime(op.opened_at)}</span>
        <span className="ses">{sessionLabel(op.session)}</span>
        <span className="ses">{op.direction === 'LONG' ? 'Largo' : 'Corto'}</span>
        <span className="chips">
          {ordered.slice(0, 3).map((f) => (
            <span key={f.code} className={`chip ${f.severity}`}>{f.title}</span>
          ))}
          {ordered.length > 3 && <span className="chip info">+{ordered.length - 3}</span>}
        </span>
        <span className="dur">{duration(op.duration_sec)}</span>
        <span className={`pnl ${signClass(op.gross_pnl)}`}>{num(op.gross_pnl)}</span>
      </div>

      {open && (
        <div className="op-body">
          {ordered.length === 0 && <div className="op-meta">Sin observaciones.</div>}
          {ordered.map((f) => (
            <div key={f.code} className={`flag ${f.severity}`}>
              <span className="dot" />
              <span>
                <div className="title">{f.title}</div>
                <div className="detail">{f.detail}</div>
              </span>
              <span className="kind">{f.kind === 'decision' ? 'decision' : 'resultado'}</span>
            </div>
          ))}
          <div className="op-meta">
            Entrada {num(op.entry_price)} · salida {num(op.exit_price)} · {op.max_quantity} contrato
            {op.max_quantity === 1 ? '' : 's'} · {op.fills_count} ejecuciones · cerrada {dateTime(op.closed_at)}
          </div>
        </div>
      )}
    </div>
  );
}

export function Operations({ filters }: { filters: Filters }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [data, setData] = useState<Page<Operation> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cambiar filtros reinicia la paginacion: quedarse en la pagina 7 de un
  // listado que ahora tiene 2 no muestra nada y parece un fallo.
  useEffect(() => { setPage(1); }, [filters, onlyFlagged, pageSize]);

  useEffect(() => {
    let cancelled = false;
    api
      .operations({ ...filters, onlyFlagged }, page, pageSize)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [filters, page, pageSize, onlyFlagged]);

  if (error) return <div className="error">No se pudo cargar: {error}</div>;
  if (!data) return <div className="empty">cargando...</div>;

  return (
    <>
      <div className="filters" style={{ marginBottom: 12 }}>
        <label>
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
          solo con alertas de decision
        </label>
        <label>
          por pagina
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      {data.items.length === 0 && <div className="empty">no hay operaciones con estos filtros</div>}
      {data.items.map((op) => <OperationRow key={op.id} op={op} />)}

      <div className="pager">
        <span className="info">
          {data.total} operaciones · pagina {data.page} de {data.totalPages}
        </span>
        <button disabled={data.page <= 1} onClick={() => setPage(1)}>Primera</button>
        <button disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
        <button disabled={data.page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
        <button disabled={data.page >= data.totalPages} onClick={() => setPage(data.totalPages)}>Ultima</button>
      </div>
    </>
  );
}
