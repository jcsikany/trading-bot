const { pool }                  = require('./db');
const { placeMarketOrder, getCurrentPrice } = require('./binanceClient');
const {
  calculatePositionSize,
  calculateStopLoss,
  calculateTakeProfit,
  calculateQuantity,
  isStopLossTriggered,
  isTakeProfitTriggered,
  calculatePnL,
  getRiskSummary,
} = require('./riskManager');

const PAPER_TRADING   = process.env.PAPER_TRADING === 'true';
const MODE            = PAPER_TRADING ? 'paper' : 'live';

// ─────────────────────────────────────────
// Consultas de estado
// ─────────────────────────────────────────

async function getOpenPosition(symbol) {
  const result = await pool.query(
    `SELECT * FROM trades WHERE symbol = $1 AND status = 'open' AND mode = $2
     ORDER BY created_at DESC LIMIT 1`,
    [symbol, MODE]
  );
  return result.rows[0] || null;
}

async function getAllOpenPositions() {
  const result = await pool.query(
    `SELECT * FROM trades WHERE status = 'open' AND mode = $1`,
    [MODE]
  );
  return result.rows;
}

// ─────────────────────────────────────────
// Ejecución de compra
// ─────────────────────────────────────────

async function executeBuy(symbol, signal, availableUsdt) {
  // Verificar si ya hay posición abierta en este símbolo
  const existingPosition = await getOpenPosition(symbol);
  if (existingPosition) {
    console.log(`⏭️  [${symbol}] Ya existe posición abierta, saltando compra`);
    return null;
  }

  const price    = signal.indicators.currentPrice;
  const atr      = signal.indicators.atr;
  const risk     = getRiskSummary(price, atr, availableUsdt);

  let positionUsdt;
  try {
    positionUsdt = calculatePositionSize(availableUsdt);
  } catch (err) {
    console.error(`❌ [${symbol}] ${err.message}`);
    return null;
  }

  const quantity   = calculateQuantity(positionUsdt, price);
  const stopLoss   = parseFloat(risk.stopLoss);
  const takeProfit = parseFloat(risk.takeProfit);

  // ── Paper Trading ──────────────────────
  if (PAPER_TRADING) {
    const result = await pool.query(
      `INSERT INTO trades
         (symbol, side, price, quantity, usdt_value, stop_loss, take_profit, score, mode, status)
       VALUES ($1, 'BUY', $2, $3, $4, $5, $6, $7, 'paper', 'open')
       RETURNING *`,
      [symbol, price, quantity, positionUsdt, stopLoss, takeProfit, signal.score]
    );

    console.log([
      `📝 PAPER BUY  [${symbol}]`,
      `Precio: $${price.toFixed(2)}`,
      `Cant: ${quantity.toFixed(6)}`,
      `USDT: $${positionUsdt.toFixed(2)}`,
      `Score: ${signal.score}%`,
      `SL: $${stopLoss.toFixed(2)} (-${risk.stopLossPct}%)`,
      `TP: $${takeProfit.toFixed(2)} (+${risk.takeProfitPct}%)`,
      `R:R ${risk.riskRewardRatio}`,
    ].join(' | '));

    return result.rows[0];

  // ── Live Trading ───────────────────────
  } else {
    const order = await placeMarketOrder(symbol, 'BUY', quantity);
    const fillPrice = parseFloat(order.fills[0].price);

    const result = await pool.query(
      `INSERT INTO trades
         (symbol, side, price, quantity, usdt_value, stop_loss, take_profit, score, mode, status)
       VALUES ($1, 'BUY', $2, $3, $4, $5, $6, $7, 'live', 'open')
       RETURNING *`,
      [symbol, fillPrice, quantity, positionUsdt, stopLoss, takeProfit, signal.score]
    );

    console.log(`💰 LIVE BUY [${symbol}] @ $${fillPrice.toFixed(2)} | USDT: $${positionUsdt.toFixed(2)}`);
    return result.rows[0];
  }
}

// ─────────────────────────────────────────
// Ejecución de venta
// ─────────────────────────────────────────

async function executeSell(symbol, reason = 'signal') {
  const position = await getOpenPosition(symbol);
  if (!position) {
    console.log(`⏭️  [${symbol}] No hay posición abierta para cerrar`);
    return null;
  }

  const price = await getCurrentPrice(symbol);
  const { pnl, pnlPct } = calculatePnL(
    parseFloat(position.price),
    price,
    parseFloat(position.quantity),
    parseFloat(position.usdt_value)
  );

  // Actualizar registro en BD
  await pool.query(
    `UPDATE trades
     SET status = 'closed', close_price = $1, pnl = $2, pnl_pct = $3, closed_at = NOW()
     WHERE id = $4`,
    [price, pnl, pnlPct, position.id]
  );

  const emoji = pnl >= 0 ? '✅' : '❌';
  const modeLabel = PAPER_TRADING ? 'PAPER' : 'LIVE';
  const reasonLabels = { signal: 'Señal', stop_loss: 'Stop Loss 🛑', take_profit: 'Take Profit 🎯' };

  console.log([
    `${emoji} ${modeLabel} SELL [${symbol}] [${reasonLabels[reason] || reason}]`,
    `Precio: $${price.toFixed(2)}`,
    `Entrada: $${parseFloat(position.price).toFixed(2)}`,
    `P&L: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`,
  ].join(' | '));

  return {
    ...position,
    closePrice: price,
    pnl,
    pnlPct,
    reason,
  };
}

// ─────────────────────────────────────────
// Chequeo de Stop Loss / Take Profit
// ─────────────────────────────────────────

async function checkRiskLevels(symbol) {
  const position = await getOpenPosition(symbol);
  if (!position) return null;

  const currentPrice = await getCurrentPrice(symbol);
  const stopLoss     = parseFloat(position.stop_loss);
  const takeProfit   = parseFloat(position.take_profit);

  if (isStopLossTriggered(currentPrice, stopLoss)) {
    console.log(`🛑 [${symbol}] Stop Loss activado @ $${currentPrice.toFixed(2)} (SL: $${stopLoss.toFixed(2)})`);
    return await executeSell(symbol, 'stop_loss');
  }

  if (isTakeProfitTriggered(currentPrice, takeProfit)) {
    console.log(`🎯 [${symbol}] Take Profit alcanzado @ $${currentPrice.toFixed(2)} (TP: $${takeProfit.toFixed(2)})`);
    return await executeSell(symbol, 'take_profit');
  }

  const { pnlPct } = calculatePnL(
    parseFloat(position.price),
    currentPrice,
    parseFloat(position.quantity),
    parseFloat(position.usdt_value)
  );
  console.log(`📊 [${symbol}] Posición abierta | Precio actual: $${currentPrice.toFixed(2)} | P&L: ${pnlPct.toFixed(2)}% | SL: $${stopLoss.toFixed(2)} | TP: $${takeProfit.toFixed(2)}`);

  return null;
}

module.exports = {
  executeBuy,
  executeSell,
  checkRiskLevels,
  getOpenPosition,
  getAllOpenPositions,
};
