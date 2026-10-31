import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Cita, type CitaEconomica, type EarningsReport } from '../api';
import { displayOffsetAt, hora, num, zonaCorta } from '../format';

/**
 * La franja de resultados: quien presenta YA y como salio lo ultimo.
 *
 * Vive pegada a la barra de filtros, no dentro de la pestaña News, porque es
 * lo unico del contexto de mercado que tiene hora. Una noticia se lee cuando
 * se puede; que AAPL presente dentro de catorce minutos no admite "cuando se
 * pueda", y si hay que cambiar de pestaña para enterarse, no sirve.
 *
 * Dos avisos distintos y a proposito separados:
 *
 *   AMBAR  quien presenta en 3 dias o menos, con la hora y la cuenta atras.
 *   ROJO   un resultado que salio POR DEBAJO de lo esperado. Es el que
 *          explica los desplomes, y el que no se puede enterar uno tarde.
 *
 * Pide sus datos por su cuenta cada minuto en vez de colgarse del refresco
 * general: ese esta apagado en Operaciones y en Ajustes a proposito -recargar
 * debajo pisa lo que estas tocando-, y una alarma que solo suena en algunas
 * pestañas es peor que no tenerla.
 */

/** Cuando avisar, en minutos antes. De mas lejos a mas cerca. */
const HITOS = [1440, 360, 60, 15] as const;

const NOMBRE_HITO: Record<number, string> = {
  1440: 'falta 1 dia',
  360: 'faltan 6 horas',
  60: 'falta 1 hora',
  15: 'faltan 15 minutos',
};

const RECUERDO = 'avisos-resultados';

/**
 * Lo ya avisado, en el navegador.
 *
 * Sin esto, cada F5 vuelve a soltar el modal de los cuatro hitos ya pasados.
 * Es un dato de ESTA pantalla y de nadie mas, asi que no tiene por que subir
 * al servidor; y si el navegador lo pierde, lo peor que pasa es un aviso
 * repetido. De ahi el try/catch: en modo privado `localStorage` lanza al
 * tocarlo, y una excepcion aqui se llevaria la barra entera por delante.
 */
function leerRecuerdo(): Record<string, true> {
  try {
    return JSON.parse(localStorage.getItem(RECUERDO) ?? '{}') as Record<string, true>;
  } catch {
    return {};
  }
}

function guardarRecuerdo(r: Record<string, true>): void {
  try {
    localStorage.setItem(RECUERDO, JSON.stringify(r));
  } catch {
    /* sin memoria: se avisara otra vez, que es el fallo bueno de los dos */
  }
}

/**
 * Lo que puede sonar: un informe de resultados o un evento del calendario.
 *
 * Los dos son lo mismo para la alarma -una hora que se acerca-, asi que
 * comparten cola, recuerdo y modal. Lo que cambia es el texto y UNA cosa de
 * fondo: la hora de un resultado es una CONVENCION nuestra y la de un evento
 * economico es un DATO que viene con la fecha. Eso se dice en el modal.
 */
interface Aviso {
  /** Clave estable para el recuerdo. */
  id: string;
  tipo: 'resultados' | 'calendario';
  at: number;
  /** Lo que va en grande: "AAPL" o "T1 · CPI". */
  titulo: string;
  /** La linea pequeña de debajo: "Apple" o "USD · alto impacto". */
  sub: string;
  /** La linea que explica de donde sale la hora. */
  nota: string;
  /** Lo que se espera, si se sabe. */
  esperado: string | null;
}

const clave = (id: string, hito: number) => `${id}:${hito}`;

/** "2d 3h 14m", "3h 14m", "14m 20s". Debajo de un minuto, segundos. */
function cuenta(ms: number): string {
  if (ms <= 0) return 'ya';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * "lun 2 nov" de un INSTANTE, en el reloj activo.
 *
 * No vale `new Date(at).toISOString().slice(0,10)`: eso da el dia en UTC, y un
 * evento de las 21:00 de Nueva York cae ya en el dia siguiente en UTC. Se
 * veria el FOMC del miercoles anunciado como jueves.
 */
function diaDeInstante(at: number): string {
  const d = new Date(at + displayOffsetAt(at) * 3600_000);
  return diaCorto(d.toISOString().slice(0, 10));
}

/** "lun 2 nov" a partir de un YYYY-MM-DD, sin que la zona horaria lo corra un dia. */
function diaCorto(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const f = new Date(Date.UTC(y, m - 1, d));
  return `${DIAS[f.getUTCDay()]} ${d} ${MESES[m - 1]}`;
}

const cuando = (w: string | null) =>
  (w ?? '').toLowerCase().includes('bmo') ? 'antes de abrir' : 'despues del cierre';

/**
 * El aviso completo de la hora, para el `title`.
 *
 * Lleva SIEMPRE la hora de Nueva York aunque el reloj este en local: la
 * convencion esta definida sobre el cierre del mercado americano, asi que es
 * la unica forma de que se entienda de donde sale el numero que se ve.
 */
const explicaHora = (c: Cita) =>
  c.medido
    ? `${cuando(c.when)} · ${c.hhmm} en Nueva York · mediana de ${c.medido.n} informes reales (rango ${c.medido.rango}), medida sobre los 8-K de la SEC`
    : `${cuando(c.when)} · ${c.hhmm} en Nueva York · hora de convencion: no hay medicion de esta empresa`;

/**
 * El pitido.
 *
 * Generado con WebAudio en vez de un fichero de sonido: no hay que distribuir
 * un .mp3 con el repositorio ni acertar con la ruta en una instalacion nueva.
 * Dos tonos alternos cada segundo y medio, que se distinguen de cualquier
 * notificacion del sistema.
 *
 * El navegador puede negarse a sonar si todavia no has hecho clic en la
 * pagina. Por eso el modal NO depende del sonido: aparece igual, y si el audio
 * no arranca se queda en un aviso silencioso en vez de no aparecer.
 */
function usarPitido() {
  const ctx = useRef<AudioContext | null>(null);
  const timer = useRef<number | null>(null);

  const parar = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const sonar = useCallback(() => {
    const pitar = () => {
      try {
        ctx.current ??= new AudioContext();
        const c = ctx.current;
        if (c.state === 'suspended') void c.resume();
        for (const [i, hz] of [880, 660].entries()) {
          const osc = c.createOscillator();
          const vol = c.createGain();
          osc.type = 'sine';
          osc.frequency.value = hz;
          vol.gain.value = 0.0001;
          osc.connect(vol).connect(c.destination);
          const t = c.currentTime + i * 0.28;
          vol.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
          vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
          osc.start(t);
          osc.stop(t + 0.26);
        }
      } catch {
        /* sin audio disponible: el modal sigue saliendo */
      }
    };

    pitar();
    parar();
    timer.current = window.setInterval(pitar, 1500);
  }, [parar]);

  useEffect(() => parar, [parar]);

  return { sonar, parar };
}

export function EarningsStrip() {
  const [datos, setDatos] = useState<EarningsReport | null>(null);
  const [economicos, setEconomicos] = useState<CitaEconomica[]>([]);
  const [ahora, setAhora] = useState(Date.now());
  const [alarma, setAlarma] = useState<{ aviso: Aviso; hito: number } | null>(null);

  /**
   * Diferencia entre el reloj del servidor y el de esta pantalla.
   *
   * La cuenta atras se calcula aqui, cada segundo, pero el instante del
   * informe lo decide el servidor. Si el reloj del PC va dos minutos
   * adelantado, sin esta correccion la alarma de los 15 minutos sonaria a los
   * 17 y la cuenta atras llegaria a cero antes de tiempo.
   */
  const desfase = useRef(0);
  const { sonar, parar } = usarPitido();

  const cargar = useCallback(() => {
    api
      .earnings(3)
      .then((d) => {
        desfase.current = d.now - Date.now();
        setDatos(d);
      })
      .catch(() => {
        /* el servidor puede estar reiniciando; se reintenta al minuto */
      });

    // SIETE dias y no tres, al reves que los resultados. Los eventos T1 son
    // mensuales: con tres dias esta franja estaria vacia cuatro semanas de
    // cada cinco y pareceria rota.
    api
      .agendaEconomica(7)
      .then((d) => setEconomicos(d.agenda))
      .catch(() => { /* idem */ });
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 60_000);
    return () => clearInterval(t);
  }, [cargar]);

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const reloj = ahora + desfase.current;
  const falta = (at: number) => at - reloj;

  /**
   * Las dos agendas en una sola cola, ordenada por cercania.
   *
   * Ordenar importa: si un informe y unas nominas caen a la misma hora, suena
   * primero el que antes llega, y el otro en cuanto se cierre ese modal.
   */
  const avisos: Aviso[] = [
    ...(datos?.agenda ?? []).map((c) => ({
      id: `R:${c.symbol}:${c.date}`,
      tipo: 'resultados' as const,
      at: c.at,
      titulo: `${c.symbol} presenta resultados`,
      sub: c.name,
      nota: c.medido
        ? `${cuando(c.when)} — ${c.hhmm} en Nueva York. Mediana de ${c.medido.n} informes reales (rango ${c.medido.rango}), medida sobre los 8-K de la SEC.`
        : `${cuando(c.when)} — ${c.hhmm} en Nueva York. Hora de convencion: no hay medicion de esta empresa.`,
      esperado: c.epsEstimate === null ? null : `se espera un BPA de ${num(c.epsEstimate, 2)}`,
    })),
    ...economicos.map((e) => ({
      id: `C:${e.id}`,
      tipo: 'calendario' as const,
      at: e.at,
      titulo: e.titulo,
      sub: [e.currency, e.impact === 'high' ? 'impacto alto' : e.impact].filter(Boolean).join(' · '),
      // Aqui la hora NO es una convencion: viene con el evento.
      nota: `Hora publicada del dato. Sin operar desde ${e.silencioAntes} min antes hasta ${e.silencioDespues} min despues.`,
      esperado:
        e.forecast === null
          ? null
          : `se espera ${num(e.forecast, 2)}${e.previous === null ? '' : ` · anterior ${num(e.previous, 2)}`}`,
    })),
  ].sort((a, b) => a.at - b.at);

  // ---- disparo de las alarmas ----------------------------------------------
  //
  // Se dispara SOLO el hito mas cercano de los que se hayan cruzado sin
  // avisar, y los demas se dan por avisados en silencio. Abrir el diario con
  // veinte minutos para el informe tiene que soltar un aviso -"falta 1 hora"-,
  // no cuatro modales encadenados contando que hace un dia faltaba un dia.
  useEffect(() => {
    if (alarma !== null || datos === null) return;

    const recuerdo = leerRecuerdo();
    let cambio = false;
    let disparo: { aviso: Aviso; hito: number } | null = null;

    for (const c of avisos) {
      const min = falta(c.at) / 60_000;
      const cruzados = HITOS.filter((h) => min <= h);
      if (cruzados.length === 0) continue;

      const pendientes = cruzados.filter((h) => !recuerdo[clave(c.id, h)]);
      if (pendientes.length === 0) continue;

      // Ya presento: se da por avisado y no suena nada. Un modal por algo que
      // ocurrio hace dos horas solo estorba.
      if (min <= 0) {
        for (const h of pendientes) recuerdo[clave(c.id, h)] = true;
        cambio = true;
        continue;
      }

      // SOLO se marca como avisado lo de la cita que de verdad va a sonar. Si
      // dos empresas presentan a la vez, marcar las dos aqui dejaria la
      // segunda sin aviso para siempre: se queda pendiente y suena en cuanto
      // se cierre este modal.
      if (disparo === null) {
        for (const h of pendientes) recuerdo[clave(c.id, h)] = true;
        cambio = true;
        disparo = { aviso: c, hito: Math.min(...pendientes) };
      }
    }

    if (cambio) guardarRecuerdo(recuerdo);
    if (disparo) {
      setAlarma(disparo);
      sonar();
    }
    // `ahora` entra a proposito: es el latido que vuelve a mirar cada segundo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ahora, datos, economicos, alarma]);

  const cerrar = () => {
    parar();
    setAlarma(null);
  };

  if (datos === null && economicos.length === 0) return null;

  const proximos = datos?.agenda ?? [];
  const fallos = datos?.sorpresas.filter((s) => s.fallo) ?? [];
  const aciertos = datos?.sorpresas.filter((s) => !s.fallo) ?? [];

  // Dentro de tres dias: lo que de verdad te va a pillar operando. Lo demas
  // sigue en la franja pero apagado, como aviso de que viene.
  const PRONTO = 3 * 86_400_000;

  return (
    <>
      {proximos.length > 0 && (
        <div className="tira-resultados proximos">
          <b>Presentan en 3 dias o menos</b>
          <div className="citas">
            {proximos.map((c) => {
              const ms = falta(c.at);
              return (
                <span key={`${c.symbol}-${c.date}`} className={ms <= 3_600_000 ? 'cita ya' : 'cita'}>
                  <b>{c.symbol}</b>
                  <i>{diaCorto(c.date)}</i>
                  {/* La hora SIEMPRE con la palabra "convencion" al lado. No la
                      publica la empresa: la ponemos nosotros a partir de
                      "despues del cierre". */}
                  <u title={explicaHora(c)}>
                    {hora(c.at)} {zonaCorta()}
                  </u>
                  {/* Lo que hay detras de la hora, en una palabra. "medida"
                      lleva ademas cuantos informes: una mediana de seis no es
                      lo mismo que una de dos. */}
                  <em>{c.medido ? `medida · ${c.medido.n}` : 'convencion'}</em>
                  <strong>{ms > 0 ? `en ${cuenta(ms)}` : `hace ${cuenta(-ms)}`}</strong>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {economicos.length > 0 && (
        <div className="tira-resultados calendario">
          <b>Calendario economico</b>
          <div className="citas">
            {economicos.map((e) => {
              const ms = falta(e.at);
              // Dentro de tres dias se enciende; mas lejos se queda apagado.
              // Son dos cosas distintas: "prepara el dia" y "esto te pilla hoy".
              const clases = ['cita'];
              if (ms <= 3_600_000) clases.push('ya');
              else if (ms > PRONTO) clases.push('apagada');
              return (
                <span key={e.id} className={clases.join(' ')}>
                  <b>{e.titulo}</b>
                  <i>{diaDeInstante(e.at)}</i>
                  {/* Sin subrayado de puntos ni "convencion": esta hora es un
                      DATO, viene con el evento. */}
                  <u title={`Hora publicada del dato. Sin operar desde ${e.silencioAntes} min antes hasta ${e.silencioDespues} min despues.`}>
                    {hora(e.at)} {zonaCorta()}
                  </u>
                  <strong>{ms > 0 ? `en ${cuenta(ms)}` : `hace ${cuenta(-ms)}`}</strong>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {fallos.length > 0 && (
        <div className="tira-resultados fallo">
          <b>Resultado por debajo de lo esperado</b>
          <div className="citas">
            {fallos.map((s) => (
              <span key={`${s.symbol}-${s.date}`} className="cita">
                <b>{s.symbol}</b>
                <strong className="neg">{num(s.desvioPct, 1)}%</strong>
                <i>
                  {num(s.epsActual, 2)} contra {num(s.epsEstimate, 2)} esperado · {diaCorto(s.date)}
                </i>
              </span>
            ))}
            {aciertos.map((s) => (
              <span key={`${s.symbol}-${s.date}`} className="cita apagada">
                <b>{s.symbol}</b>
                <strong className="pos">+{num(s.desvioPct, 1)}%</strong>
                <i>{diaCorto(s.date)}</i>
              </span>
            ))}
          </div>
        </div>
      )}

      {alarma && (
        <div className="alarma-fondo" role="dialog" aria-modal="true">
          <div className={`alarma ${alarma.aviso.tipo}`}>
            <span className="hito">{NOMBRE_HITO[alarma.hito] ?? 'aviso'}</span>
            <h2>{alarma.aviso.titulo}</h2>
            <p className="quien">{alarma.aviso.sub}</p>
            <p className="momento">
              {diaDeInstante(alarma.aviso.at)} ·{' '}
              <b>
                {hora(alarma.aviso.at)}{' '}
                {zonaCorta() === 'NY' ? 'hora de Nueva York' : 'hora de este ordenador'}
              </b>
              <br />
              <small>{alarma.aviso.nota}</small>
            </p>
            <p className="restante">{cuenta(falta(alarma.aviso.at))}</p>
            {alarma.aviso.esperado !== null && (
              <p className="esperado">{alarma.aviso.esperado}</p>
            )}
            <button onClick={cerrar} autoFocus>
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}
