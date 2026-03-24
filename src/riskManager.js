// ─────────────────────────────────────────
// Configuración de riesgo
// ─────────────────────────────────────────

const ATR_STOP_MULTIPLIER       = 1.5;  // Stop Loss: 1.5x ATR debajo del precio de entrada
const ATR_TAKE_PROFIT_MULTIPLIER = 3.0; // Take Profit: 3x ATR (ratio R:R = 1:2)
const CAPITAL_PER_SYMBOL        = 0.50; // 50% del capital disponible por símbolo (BTC 50%, ETH 50%)
const MIN_USDT_ORDER            = 10;   // Mínimo razonable por operación en Binance

// ─────────────────────────────────────────
// Cálculos de riesgo
// ─────────────────────────────────────────

/**
 * Determina cuánto capital en USDT asignar a una operación
 */
function calculatePositionSize(availableUsdt) {
  const position = availableUsdt * CAPITAL_PER_SYMBOL;
  if (position < MIN_USDT_ORDER) {
    throw new Error(`Capital insuficiente: $${position.toFixed(2)} es menor al mínimo de $${MIN_USDT_ORDER}`);
  }
  return position;
}

/**
 * Stop Loss dinámico basado en ATR
 * En posición long: entrada - (ATR * multiplicador)
 */
function calculateStopLoss(entryPrice, atr) {
  const stopLoss = entryPrice - atr * ATR_STOP_MULTIPLIER;
  return Math.max(stopLoss, entryPrice * 0.85); // Mínimo floor del 15% (seguridad extra)
}

/**
 * Take Profit dinámico basado en ATR
 * En posición long: entrada + (ATR * multiplicador)
 * Ratio R:R = 1:2 (arriesgas 1.5 ATR para ganar 3 ATR)
 */
function calculateTakeProfit(entryPrice, atr) {
  return entryPrice + atr * ATR_TAKE_PROFIT_MULTIPLIER;
}

/**
 * Calcula la cantidad de criptomoneda a comprar dado el capital y el precio
 */
function calculateQuantity(usdtAmount, price) {
  return usdtAmount / price;
}

/**
 * Verifica si el precio actual tocó el stop loss
 */
function isStopLossTriggered(currentPrice, stopLoss) {
  return currentPrice <= stopLoss;
}

/**
 * Verifica si el precio actual alcanzó el take profit
 */
function isTakeProfitTriggered(currentPrice, takeProfit) {
  return currentPrice >= takeProfit;
}

/**
 * Calcula el P&L de una posición
 */
function calculatePnL(entryPrice, currentPrice, quantity, usdtInvested) {
  const currentValue = currentPrice * quantity;
  const pnl    = currentValue - usdtInvested;
  const pnlPct = (pnl / usdtInvested) * 100;
  return { pnl, pnlPct, currentValue };
}

/**
 * Resumen del riesgo de una posición antes de abrir
 */
function getRiskSummary(entryPrice, atr, usdtAmount) {
  const stopLoss   = calculateStopLoss(entryPrice, atr);
  const takeProfit = calculateTakeProfit(entryPrice, atr);
  const riskUsdt   = (entryPrice - stopLoss) / entryPrice * usdtAmount;
  const rewardUsdt = (takeProfit - entryPrice) / entryPrice * usdtAmount;

  return {
    entryPrice,
    stopLoss:       stopLoss.toFixed(2),
    takeProfit:     takeProfit.toFixed(2),
    stopLossPct:    (((entryPrice - stopLoss) / entryPrice) * 100).toFixed(2),
    takeProfitPct:  (((takeProfit - entryPrice) / entryPrice) * 100).toFixed(2),
    riskUsdt:       riskUsdt.toFixed(2),
    rewardUsdt:     rewardUsdt.toFixed(2),
    riskRewardRatio: (rewardUsdt / riskUsdt).toFixed(2),
    atr:            atr.toFixed(2),
  };
}

module.exports = {
  calculatePositionSize,
  calculateStopLoss,
  calculateTakeProfit,
  calculateQuantity,
  isStopLossTriggered,
  isTakeProfitTriggered,
  calculatePnL,
  getRiskSummary,
  ATR_STOP_MULTIPLIER,
  ATR_TAKE_PROFIT_MULTIPLIER,
};
