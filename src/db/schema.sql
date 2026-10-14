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
