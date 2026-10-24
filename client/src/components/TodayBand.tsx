import { useEffect, useState } from 'react';
import { api, type TodayReport } from '../api';
import { signedUsd, usd } from '../format';

/**
 * La jornada en curso contra el limite de perdida.
 *
 * Es la unica pieza de la aplicacion que mira hacia delante. Todo lo demas
 * lee lo que ya paso y lo explica bien; esto esta para poder parar mientras
 * todavia se puede parar.
 *
 * El motivo esta en los numeros de octubre: el mes cerro en -1.471 $ y el dia
 * 9, solo, hizo -1.260 $. Los otros trece dias operados suman -211 $ entre
 * todos. Un dia fue el 86% de la perdida del mes, y el diario sabia contarlo
 * al dia siguiente sin forma de avisar durante.
 *
 * Va en todas las pestanas por lo mismo que el aviso de noticias: si hay que
 * parar, tiene que verse estes donde estes.
 */
export function TodayBand() {
  const [hoy, setHoy] = useState<TodayReport | null>(null);

  useEffect(() => {
    let vivo = true;

    const mirar = () => {
      api
        .today()
        .then((d) => { if (vivo) setHoy(d); })
        .catch(() => { /* el servidor puede estar reiniciando */ });
    };

    mirar();
    const t = setInterval(mirar, 30_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  // Sin limite puesto no se pinta nada. Una banda permanente que solo dice
  // "llevas X" se vuelve parte del fondo en dos dias y deja de leerse; que
  // aparezca solo cuando hay algo que vigilar es lo que la mantiene viva.
  if (hoy === null || hoy.state === 'sin-limite') return null;
  if (hoy.operations === 0) return null;

  const pct = Math.min(1, hoy.used ?? 0);

  return (
    <div className={`hoy ${hoy.state}`}>
      <div className="hoy-linea">
        <span className="hoy-titulo">
          {hoy.state === 'pasado' ? 'Limite diario superado' : 'Hoy'}
        </span>

        <span className={`hoy-pnl ${hoy.netPnl < 0 ? 'neg' : hoy.netPnl > 0 ? 'pos' : ''}`}>
          {signedUsd(hoy.netPnl)}
        </span>

        <span className="hoy-ops">
          {hoy.operations} op{hoy.operations === 1 ? '' : 's'} · {hoy.contracts} contratos
        </span>

        <span className="hoy-queda">
          {hoy.state === 'pasado'
            ? `${usd(Math.abs(hoy.netPnl) - hoy.limit)} por debajo del limite de ${usd(hoy.limit)}`
            : `quedan ${usd(hoy.remaining ?? 0)} de ${usd(hoy.limit)}`}
        </span>
      </div>

      {/* La barra dice de un vistazo lo que el numero dice leyendo. Con el
          limite a punto de tocarse, leer es justo lo que no se hace. */}
      <div className="hoy-barra">
        <i style={{ width: `${(pct * 100).toFixed(1)}%` }} />
      </div>

      {hoy.state === 'pasado' && (
        <div className="hoy-nota">
          La jornada cierra a las 18:00 de Nueva York. Lo que operes ahora cuenta en este mismo dia.
        </div>
      )}
    </div>
  );
}
