const { pool } = require('./db');
const { getCurrentPrice } = require('./binanceClient');
const { calculatePnL } = require('./riskManager');

const PAPER_TRADING    = process.env.PAPER_TRADING === 'true';
const MODE             = PAPER_TRADING ? 'paper' : 'live';
const INITIAL_CAPITAL  = parseFloat(process.env.INITIAL_CAPITAL || '200');

// ─────────────────────────────────────────
// Resumen del portfolio
// ─────────────────────────────────────────

async function getPortfolioSummary() {
  // Trades cerrados
  const closed = await pool.query(
    `SELECT
       COUNT(*)                                     AS total_trades,
       COUNT(CASE WHEN pnl > 0 THEN 1 END)          AS winning_trades,
       COUNT(CASE WHEN pnl <= 0 THEN 1 END)         AS losing_trades,
       COALESCE(SUM(pnl), 0)                        AS realized_pnl,
       COALESCE(AVG(CASE WHEN pnl > 0 THEN pnl_pct END), 0) AS avg_win_pct,
       COALESCE(AVG(CASE WHEN pnl <= 0 THEN pnl_pct END), 0) AS avg_loss_pct,
       COALESCE(MAX(pnl), 0)                        AS best_trade,
       COALESCE(MIN(pnl), 0)                        AS worst_trade
     FROM trades
     WHERE mode = $1 AND status = 'closed'`,
    [MODE]
  );

  // Posiciones abiertas con P&L no realizado
  const openTrades = await pool.query(
    `SELECT * FROM trades WHERE mode = $1 AND status = 'open'`,
    [MODE]
  );

  // Calcular P&L no realizado
  let unrealizedPnl = 0;
  const openPositions = [];

  for (const trade of openTrades.rows) {
    try {
      const currentPrice = await getCurrentPrice(trade.symbol);
      const { pnl, pnlPct } = calculatePnL(
        parseFloat(trade.price),
        currentPrice,
        parseFloat(trade.quantity),
        parseFloat(trade.usdt_value)
      );
      unrealizedPnl += pnl;
      openPositions.push({
        symbol:        trade.symbol,
        entryPrice:    parseFloat(trade.price).toFixed(2),
        currentPrice:  currentPrice.toFixed(2),
        quantity:      parseFloat(trade.quantity).toFixed(6),
        usdtValue:     parseFloat(trade.usdt_value).toFixed(2),
        stopLoss:      parseFloat(trade.stop_loss).toFixed(2),
        takeProfit:    parseFloat(trade.take_profit).toFixed(2),
        unrealizedPnl: pnl.toFixed(2),
        unrealizedPct: pnlPct.toFixed(2),
        openedAt:      trade.created_at,
      });
    } catch (err) {
      console.error(`Error obteniendo precio de ${trade.symbol}:`, err.message);
    }
  }

  const stats         = closed.rows[0];
  const realizedPnl   = parseFloat(stats.realized_pnl);
  const totalPnl      = realizedPnl + unrealizedPnl;
  const currentCapital = INITIAL_CAPITAL + totalPnl;
  const totalPnlPct   = ((totalPnl / INITIAL_CAPITAL) * 100);

  const totalTrades   = parseInt(stats.total_trades);
  const winningTrades = parseInt(stats.winning_trades);
  const losingTrades  = parseInt(stats.losing_trades);

  return {
    mode:            PAPER_TRADING ? '📝 PAPER TRADING' : '💰 LIVE TRADING',
    initialCapital:  INITIAL_CAPITAL.toFixed(2),
    currentCapital:  currentCapital.toFixed(2),
    realizedPnl:     realizedPnl.toFixed(2),
    unrealizedPnl:   unrealizedPnl.toFixed(2),
    totalPnl:        totalPnl.toFixed(2),
    totalPnlPct:     totalPnlPct.toFixed(2),
    totalTrades,
    winningTrades,
    losingTrades,
    winRate:         totalTrades > 0
      ? ((winningTrades / totalTrades) * 100).toFixed(1)
      : '0.0',
    avgWinPct:       parseFloat(stats.avg_win_pct).toFixed(2),
    avgLossPct:      parseFloat(stats.avg_loss_pct).toFixed(2),
    bestTrade:       parseFloat(stats.best_trade).toFixed(2),
    worstTrade:      parseFloat(stats.worst_trade).toFixed(2),
    openPositions,
  };
}

// ─────────────────────────────────────────
// Historial de trades
// ─────────────────────────────────────────

async function getTradeHistory(limit = 30) {
  const result = await pool.query(
    `SELECT
       id, symbol, side, price, quantity, usdt_value,
       stop_loss, take_profit, score, status,
       close_price, pnl, pnl_pct, created_at, closed_at
     FROM trades
     WHERE mode = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [MODE, limit]
  );
  return result.rows;
}

// ─────────────────────────────────────────
// Historial de señales
// ─────────────────────────────────────────

async function getSignalHistory(symbol = null, limit = 30) {
  let query = `SELECT * FROM signals`;
  const params = [];

  if (symbol) {
    query += ` WHERE symbol = $1`;
    params.push(symbol);
    query += ` ORDER BY created_at DESC LIMIT $2`;
    params.push(limit);
  } else {
    query += ` ORDER BY created_at DESC LIMIT $1`;
    params.push(limit);
  }

  const result = await pool.query(query, params);
  return result.rows;
}

module.exports = {
  getPortfolioSummary,
  getTradeHistory,
  getSignalHistory,
  INITIAL_CAPITAL,
};
