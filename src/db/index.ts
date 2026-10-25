import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOURNAL_DB } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));

let instance: Database.Database | null = null;

/**
 * Conexion a nuestra base. WAL para poder leer desde la API mientras el
 * ingestor escribe, que es el caso normal: dejas el servidor levantado y
 * lanzas la ingesta cuando quieres.
 */
export function db(): Database.Database {
  if (instance) return instance;

  mkdirSync(dirname(JOURNAL_DB), { recursive: true });

  instance = new Database(JOURNAL_DB);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  instance.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));

  migrate(instance);

  return instance;
}

/**
 * Cambios de esquema sobre bases que YA existen.
 *
 * `schema.sql` solo sirve para una instalacion nueva: `CREATE TABLE IF NOT
 * EXISTS` no toca una tabla ya creada, asi que una columna anadida alli no
 * aparece jamas en la base de quien lleva meses usando el diario. Y el fallo es
 * silencioso hasta que una consulta pide la columna y revienta en ejecucion.
 *
 * Cada paso tiene que poder ejecutarse mil veces sin hacer nada a partir de la
 * segunda.
 */
function migrate(target: Database.Database): void {
  const columns = new Set(
    (target.prepare('PRAGMA table_info("operations")').all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );

  if (!columns.has('account_id')) {
    target.exec('ALTER TABLE operations ADD COLUMN account_id TEXT');
  }

  // El indice se crea AQUI y no en schema.sql: ese fichero se ejecuta entero
  // antes que esta funcion, asi que en una base ya existente intentaria indexar
  // una columna que todavia no se ha anadido y el servidor no arranca. Con
  // IF NOT EXISTS da igual repetirlo en cada apertura.
  target.exec('CREATE INDEX IF NOT EXISTS idx_ops_account ON operations (account_id)');

  // Rellena la cuenta de lo que se ingirio antes de que la columna existiera.
  // Sale del fill que ABRE la operacion: quien dice a que cuenta pertenece es
  // el broker, no una fecha de corte que hayamos elegido nosotros.
  target.exec(`
    UPDATE operations
       SET account_id = (
             SELECT f.account_id FROM fills f WHERE f.trade_id = operations.first_fill_id
           )
     WHERE account_id IS NULL
  `);

  // --- Calendario: lo que trae Investing y un ICS no ------------------------
  //
  // Un ICS solo da hora y titulo. El JSON de Investing trae ademas la
  // PREVISION y el DATO ANTERIOR, que es lo que de verdad mueve el precio: el
  // mercado no reacciona al dato, reacciona a la diferencia entre el dato y lo
  // que se esperaba. Sin la prevision guardada, el diario no puede decir nunca
  // si una vela fue por sorpresa o por inercia.
  const eventos = new Set(
    (target.prepare('PRAGMA table_info("economic_events")').all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );

  const nuevas: Array<[string, string]> = [
    ['forecast', 'REAL'],
    ['previous', 'REAL'],
    ['actual', 'REAL'],
    ['unit', 'TEXT'],
    ['precision_digits', 'INTEGER'],
    ['preliminary', 'INTEGER'],
    ['reference_period', 'TEXT'],
    ['previous_revised_from', 'REAL'],
    ['revision', 'TEXT'],
    // Clave estable del proveedor. Permite reimportar el mismo evento cuando
    // cambia de hora sin que aparezca duplicado, cosa que con el id compuesto
    // por hora+titulo era imposible.
    ['event_key', 'TEXT'],
  ];

  for (const [nombre, tipo] of nuevas) {
    if (!eventos.has(nombre)) {
      target.exec(`ALTER TABLE economic_events ADD COLUMN ${nombre} ${tipo}`);
    }
  }

  // --- Festivos y medias sesiones -------------------------------------------
  //
  // Tabla aparte y no una fila mas del calendario: un festivo no es un dato a
  // una hora, es un intervalo en el que el mercado esta cerrado o cierra antes.
  // Las medias sesiones son la parte util: el mercado sigue abierto pero la
  // liquidez se cae, y una operacion a las 14:00 de un 24 de diciembre no se
  // puede comparar con una de un martes normal.
  target.exec(`
    CREATE TABLE IF NOT EXISTS market_holidays (
      id        TEXT PRIMARY KEY,
      exchange  TEXT NOT NULL,
      name      TEXT NOT NULL,
      day       TEXT NOT NULL,   -- YYYY-MM-DD en hora del mercado
      from_ts   INTEGER NOT NULL,
      to_ts     INTEGER NOT NULL,
      full_day  INTEGER NOT NULL,
      source    TEXT
    )
  `);

  target.exec('CREATE INDEX IF NOT EXISTS idx_holidays_day ON market_holidays (day)');

  // --- Contexto de mercado -------------------------------------------------
  //
  // Materias primas, bonos, indices, resultados y noticias. Tablas APARTE de
  // todo lo demas a proposito: son datos de fuera, ninguna metrica del diario
  // los lee, y si algun dia se borran no se mueve ni una cifra tuya.
  target.exec(`
    CREATE TABLE IF NOT EXISTS global_quotes (
      symbol     TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      kind       TEXT NOT NULL,
      price      REAL NOT NULL,
      change_pct REAL,
      ts         INTEGER NOT NULL
    )
  `);

  // La clave es (simbolo, fecha) y no el simbolo solo: una empresa presenta
  // cuatro veces al año y el historico reciente sirve para explicar la vela
  // de ayer.
  target.exec(`
    CREATE TABLE IF NOT EXISTS global_earnings (
      symbol           TEXT NOT NULL,
      name             TEXT NOT NULL,
      date             TEXT NOT NULL,
      when_            TEXT,
      eps_estimate     REAL,
      eps_actual       REAL,
      revenue_estimate REAL,
      revenue_actual   REAL,
      PRIMARY KEY (symbol, date)
    )
  `);

  target.exec('CREATE INDEX IF NOT EXISTS idx_earnings_date ON global_earnings (date)');

  // El id del proveedor como clave primaria es lo que permite saber cuantas
  // noticias son NUEVAS en cada refresco, que es lo que decide si suena la
  // alerta. Comparar por fecha fallaria: llegan desordenadas.
  target.exec(`
    CREATE TABLE IF NOT EXISTS global_news (
      id       TEXT PRIMARY KEY,
      ts       INTEGER NOT NULL,
      headline TEXT NOT NULL,
      source   TEXT,
      url      TEXT,
      summary  TEXT,
      symbols  TEXT
    )
  `);

  target.exec('CREATE INDEX IF NOT EXISTS idx_news_ts ON global_news (ts DESC)');

  // Sentimiento y relevancia. Van como ALTER y no en el CREATE de arriba
  // porque la tabla ya existe en tu maquina.
  //
  // Solo los trae Alpha Vantage. Lo que llega de Finnhub se queda en null, que
  // NO es lo mismo que neutro: null es "nadie lo ha puntuado".
  //   sentiment  de -1 (muy negativo) a +1 (muy positivo)
  //   relevance  cuanto habla la noticia de ESE simbolo, de 0 a 1
  {
    const cols = new Set(
      (target.prepare('PRAGMA table_info("global_news")').all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    if (!cols.has('sentiment')) target.exec('ALTER TABLE global_news ADD COLUMN sentiment REAL');
    if (!cols.has('relevance')) target.exec('ALTER TABLE global_news ADD COLUMN relevance REAL');
  }

  // COMO LE FUE A CADA FUENTE POR SEPARADO.
  //
  // Antes solo se guardaba "el ultimo refresco fallo" con todos los fallos
  // pegados en un texto. Eso no distingue dos situaciones que no se parecen en
  // nada: un corte de red de treinta segundos que se arregla solo, y una
  // fuente que lleva dos dias sin contestar. Las dos enseñaban el mismo aviso,
  // asi que el aviso dejaba de significar algo.
  //
  // Con la hora del ultimo acierto de cada bloque se puede decidir: si los
  // precios entraron hace cinco minutos, que el petroleo fallara ahora no es
  // motivo de alarma; si lleva dos dias, si.
  target.exec(`
    CREATE TABLE IF NOT EXISTS global_blocks (
      name    TEXT PRIMARY KEY,
      ok_at   INTEGER,   -- ultima vez que trajo datos
      rows    INTEGER,   -- cuantos trajo esa vez
      fail_at INTEGER,   -- ultima vez que fallo
      error   TEXT
    )
  `);

  // Cierre de cada simbolo por jornada, que es lo que permite calcular la
  // variacion a 5 dias SIN pedirsela a nadie.
  //
  // El endpoint de velas diarias de Finnhub dejo de estar en el plan gratuito,
  // y pedirselo a Alpha Vantage serian diez llamadas que no caben en su cuota.
  // Guardando el ultimo precio de cada jornada, a la quinta sesion el dato
  // sale solo y ya no depende de ningun proveedor.
  target.exec(`
    CREATE TABLE IF NOT EXISTS global_daily_close (
      symbol TEXT NOT NULL,
      day    TEXT NOT NULL,   -- jornada de mercado YYYY-MM-DD
      close  REAL NOT NULL,
      PRIMARY KEY (symbol, day)
    )
  `);
}

/** Abre la base de Quantower en solo lectura. Nunca escribimos ahi. */
export function openReadOnly(path: string): Database.Database {
  return new Database(path, { readonly: true, fileMustExist: true });
}
