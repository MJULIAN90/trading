-- Esquema propio. Deliberadamente separado del de Quantower: ese pertenece al
-- vendor, puede cambiar sin aviso y solo lo leemos.

-- Ejecucion individual del broker. Es el dato crudo, tal cual vino, sin
-- interpretar. Si manana cambiamos como agrupamos operaciones, se puede
-- recalcular todo desde aqui sin volver a leer Quantower.
CREATE TABLE IF NOT EXISTS fills (
  trade_id      TEXT PRIMARY KEY,
  symbol        TEXT NOT NULL,
  account_id    TEXT,
  ts            INTEGER NOT NULL,          -- epoch ms UTC
  price         REAL NOT NULL,
  quantity      REAL NOT NULL,
  side          INTEGER NOT NULL,          -- 0 compra, 1 venta
  gross_pnl     REAL,                      -- solo en los fills que cierran
  fee           REAL,
  order_type    TEXT,
  order_id      TEXT
);

CREATE INDEX IF NOT EXISTS idx_fills_ts ON fills (ts);

-- Operacion completa: desde que la posicion sale de plano hasta que vuelve a
-- plano. Es la unidad que de verdad se analiza. El emparejado FIFO ingenuo da
-- resultados absurdos en cuanto hay entradas parciales, por eso se agrupa por
-- ciclos de posicion neta.
CREATE TABLE IF NOT EXISTS operations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol         TEXT NOT NULL,
  opened_at      INTEGER NOT NULL,         -- epoch ms UTC
  closed_at      INTEGER NOT NULL,
  direction      TEXT NOT NULL,            -- LONG | SHORT
  entry_price    REAL NOT NULL,
  exit_price     REAL NOT NULL,
  max_quantity   REAL NOT NULL,
  fills_count    INTEGER NOT NULL,
  gross_pnl      REAL NOT NULL,
  duration_sec   INTEGER NOT NULL,
  session        TEXT NOT NULL,            -- ASIA | LONDON | NY_AM | ... | OUTSIDE
  market_hour    REAL NOT NULL,            -- hora de mercado en decimal, para agrupar
  is_real        INTEGER NOT NULL,         -- 0 = pruebas de plataforma
  account_id     TEXT,                     -- cuenta del broker que la ejecuto
  first_fill_id  TEXT NOT NULL UNIQUE,     -- hace la ingesta idempotente
  last_fill_id   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_opened ON operations (opened_at);
CREATE INDEX IF NOT EXISTS idx_ops_session ON operations (session);

-- Snapshot del estado del mercado segun NUESTROS indicadores, escrito por el
-- propio indicador en Quantower. Guarda features crudas, nunca conclusiones:
-- "absorcion" es una definicion con umbrales que vamos a afinar, y si la
-- guardaramos ya calculada todo el historico quedaria inservible al cambiarla.
--
-- Incluye momentos SIN operacion a proposito. Sin ejemplos negativos no hay
-- forma de distinguir luego que situaciones valian la pena y cuales no.
CREATE TABLE IF NOT EXISTS context_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  symbol        TEXT NOT NULL,
  event         TEXT NOT NULL,             -- bar_close | position_open | position_close
  payload       TEXT NOT NULL,             -- JSON con las features crudas
  UNIQUE (ts, symbol, event)
);

CREATE INDEX IF NOT EXISTS idx_ctx_ts ON context_snapshots (ts);

-- Control de ingesta, para saber que se leyo y hasta donde sin tener que
-- reprocesar los ficheros enteros cada vez.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,
  ran_at        INTEGER NOT NULL,
  rows_read     INTEGER NOT NULL,
  rows_new      INTEGER NOT NULL,
  cursor        TEXT
);

-- ---------------------------------------------------------------------------
-- Vela normalizada, derivada de context_snapshots.
--
-- context_snapshots guarda el JSON crudo tal cual lo escribe el indicador, y eso
-- esta bien como archivo: permite cambiar las features sin migrar nada. Pero
-- para dibujar un grafico hay que leer cientos de velas y parsear JSON en cada
-- una, y eso no escala.
--
-- Esta tabla es la MISMA informacion en columnas tipadas. No se guarda nada que
-- no estuviera ya en el JSON, asi que se puede borrar y reconstruir entera en
-- cualquier momento. La clave es (symbol, ts): el indicador corre en varios
-- graficos a la vez (MNQ, NQ, MES) y cada uno escribe su propia vela al mismo
-- instante.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bars (
  symbol                 TEXT NOT NULL,
  ts                     INTEGER NOT NULL,       -- epoch ms UTC, apertura de la vela
  o                      REAL NOT NULL,
  h                      REAL NOT NULL,
  l                      REAL NOT NULL,
  c                      REAL NOT NULL,
  tick_size              REAL,

  buy                    REAL,
  sell                   REAL,
  delta                  REAL,
  buy_trades             REAL,
  sell_trades            REAL,
  avg_size               REAL,
  max_one_trade          REAL,                   -- la operacion individual mas grande

  -- Las referencias que tenia el indicador EN ESE MOMENTO. Son lo que permite
  -- reproducir los filtros exactos que estaban activos cuando decidiste, en vez
  -- de recalcularlos hoy con otros datos y ver un grafico que nunca viste.
  base_avg_range         REAL,
  base_max_abs_delta     REAL,
  base_typical_abs_delta REAL,
  base_avg_trade_size    REAL,

  book_bid_size          REAL,
  book_ask_size          REAL,
  book_pulled            INTEGER,

  PRIMARY KEY (symbol, ts)
);

CREATE INDEX IF NOT EXISTS idx_bars_ts ON bars (ts);

-- Clave/valor interno. De momento solo el cursor de derivacion de bars, para no
-- releer los 111.000 snapshots en cada ingesta.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Notas y etiquetas por operacion.
--
-- En tablas aparte y no como columnas de operations a proposito: operations se
-- regenera desde los fills, y si las notas vivieran ahi se perderian en cuanto
-- cambiemos como se agrupan las operaciones.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operation_notes (
  operation_id INTEGER PRIMARY KEY REFERENCES operations (id) ON DELETE CASCADE,
  note         TEXT NOT NULL DEFAULT '',
  updated_at   INTEGER NOT NULL
);

-- Las etiquetas las defines tu sobre la marcha. Una fila por etiqueta y no una
-- lista separada por comas: asi se puede agrupar por etiqueta en SQL y ver
-- cuanto dinero cuesta cada una.
CREATE TABLE IF NOT EXISTS operation_tags (
  operation_id INTEGER NOT NULL REFERENCES operations (id) ON DELETE CASCADE,
  tag          TEXT NOT NULL,
  PRIMARY KEY (operation_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_optags_tag ON operation_tags (tag);

-- ---------------------------------------------------------------------------
-- Calendario economico.
--
-- Entra por fichero (.ics o .csv) y no por API: Quantower no tiene calendario
-- economico -- lo que ofrece es un feed de titulares, sin prevision, sin dato
-- real y sin eventos futuros -- y las APIs de calendario piden clave y cambian
-- de plan gratuito cada temporada. Un ICS exportado no depende de nadie.
--
-- El id es hora + titulo normalizado, asi reimportar el mismo fichero o uno
-- actualizado que repita eventos no duplica nada.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS economic_events (
  id       TEXT PRIMARY KEY,
  ts       INTEGER NOT NULL,          -- epoch ms UTC
  title    TEXT NOT NULL,
  impact   TEXT,                      -- high | medium | low | NULL
  currency TEXT,
  source   TEXT,                      -- fichero del que salio
  detail   TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON economic_events (ts);
