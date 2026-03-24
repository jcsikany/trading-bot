const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    -- Operaciones abiertas y cerradas
    CREATE TABLE IF NOT EXISTS trades (
      id             SERIAL PRIMARY KEY,
      symbol         VARCHAR(20)    NOT NULL,
      side           VARCHAR(10)    NOT NULL,          -- BUY | SELL
      price          DECIMAL(20,8)  NOT NULL,
      quantity       DECIMAL(20,8)  NOT NULL,
      usdt_value     DECIMAL(20,2)  NOT NULL,
      stop_loss      DECIMAL(20,8),
      take_profit    DECIMAL(20,8),
      score          DECIMAL(5,2),
      mode           VARCHAR(10)    DEFAULT 'paper',   -- paper | live
      status         VARCHAR(10)    DEFAULT 'open',    -- open | closed | stopped
      close_price    DECIMAL(20,8),
      pnl            DECIMAL(20,2),
      pnl_pct        DECIMAL(10,4),
      created_at     TIMESTAMP      DEFAULT NOW(),
      closed_at      TIMESTAMP
    );

    -- Historial de señales generadas cada día
    CREATE TABLE IF NOT EXISTS signals (
      id           SERIAL PRIMARY KEY,
      symbol       VARCHAR(20)   NOT NULL,
      action       VARCHAR(10)   NOT NULL,             -- BUY | SELL | HOLD
      score        DECIMAL(5,2)  NOT NULL,
      rsi          DECIMAL(10,4),
      macd_signal  VARCHAR(10),
      ema_signal   VARCHAR(10),
      bb_signal    VARCHAR(10),
      obv_signal   VARCHAR(10),
      vwap_signal  VARCHAR(10),
      price        DECIMAL(20,8),
      atr          DECIMAL(20,8),
      created_at   TIMESTAMP     DEFAULT NOW()
    );

    -- Resultados de backtesting
    CREATE TABLE IF NOT EXISTS backtest_results (
      id              SERIAL PRIMARY KEY,
      symbol          VARCHAR(20)    NOT NULL,
      interval        VARCHAR(10)    DEFAULT '1d',
      candles_count   INTEGER,
      initial_capital DECIMAL(20,2),
      final_capital   DECIMAL(20,2),
      total_trades    INTEGER,
      winning_trades  INTEGER,
      losing_trades   INTEGER,
      win_rate        DECIMAL(5,2),
      total_pnl       DECIMAL(20,2),
      total_pnl_pct   DECIMAL(10,4),
      max_drawdown    DECIMAL(10,4),
      created_at      TIMESTAMP      DEFAULT NOW()
    );
  `);

  console.log('✅ Base de datos inicializada correctamente');
}

module.exports = { pool, initDB };
