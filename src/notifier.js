const axios = require('axios');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ─────────────────────────────────────────
// Envío base de notificación
// ─────────────────────────────────────────

async function sendPush(title, body, data = {}) {
  const token = process.env.EXPO_PUSH_TOKEN;

  // Sin token: solo log en consola (útil en desarrollo)
  if (!token) {
    console.log(`\n📱 [PUSH] ${title}`);
    console.log(`   ${body}`);
    return;
  }

  try {
    const payload = {
      to:       token,
      title,
      body,
      data,
      sound:    'default',
      priority: 'high',
      badge:    1,
    };

    const response = await axios.post(EXPO_PUSH_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.data?.data?.status === 'error') {
      console.error('❌ Push error:', response.data.data.message);
    }
  } catch (err) {
    console.error('❌ Error enviando notificación:', err.message);
  }
}

// ─────────────────────────────────────────
// Notificaciones específicas del bot
// ─────────────────────────────────────────

async function notifyBuy(symbol, price, quantity, score, stopLoss, takeProfit, isPaper = true) {
  const coin  = symbol.replace('USDT', '');
  const label = isPaper ? '📝 PAPER' : '💰 LIVE';
  const slPct = (((price - stopLoss) / price) * 100).toFixed(1);
  const tpPct = (((takeProfit - price) / price) * 100).toFixed(1);

  await sendPush(
    `🟢 BUY ${coin} — Score ${score}% | ${label}`,
    `Compra ${quantity.toFixed(5)} ${coin} @ $${price.toLocaleString()}\nSL: -${slPct}% | TP: +${tpPct}%`,
    { symbol, action: 'BUY', price, score, isPaper }
  );
}

async function notifySell(symbol, exitPrice, pnl, pnlPct, reason, isPaper = true) {
  const coin   = symbol.replace('USDT', '');
  const label  = isPaper ? '📝 PAPER' : '💰 LIVE';
  const emoji  = pnl >= 0 ? '✅' : '❌';
  const reasonMap = {
    signal:          'Señal técnica',
    stop_loss:       '🛑 Stop Loss',
    take_profit:     '🎯 Take Profit',
    end_of_backtest: 'Fin de backtest',
  };

  await sendPush(
    `${emoji} SELL ${coin} [${reasonMap[reason] || reason}] | ${label}`,
    `Venta @ $${exitPrice.toLocaleString()}\nP&L: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`,
    { symbol, action: 'SELL', exitPrice, pnl, pnlPct, reason, isPaper }
  );
}

async function notifySignal(symbol, action, score, indicators) {
  if (action === 'HOLD') return; // No notificamos HOLDs para no saturar

  const coin  = symbol.replace('USDT', '');
  const emoji = action === 'BUY' ? '🔵' : '🔴';
  const macdStr = indicators.macd.bullishCross
    ? 'Cruz alcista ✅'
    : indicators.macd.bearishCross
      ? 'Cruz bajista 🔻'
      : `Momentum ${indicators.macd.bullishMomentum ? '↑' : '↓'}`;

  await sendPush(
    `${emoji} SEÑAL ${action} ${coin} — ${score}%`,
    `RSI: ${indicators.rsi.value.toFixed(1)} | Precio: $${indicators.currentPrice.toLocaleString()}\nMACD: ${macdStr}`,
    { symbol, action, score }
  );
}

async function notifyStopLossRisk(symbol, currentPrice, stopLoss) {
  const coin     = symbol.replace('USDT', '');
  const distPct  = (((currentPrice - stopLoss) / currentPrice) * 100).toFixed(2);

  await sendPush(
    `⚠️ ${coin} cerca del Stop Loss`,
    `Precio: $${currentPrice.toLocaleString()}\nSL: $${stopLoss.toLocaleString()} (a ${distPct}% de distancia)`,
    { symbol, currentPrice, stopLoss, alert: 'near_stop_loss' }
  );
}

async function notifyDailySummary(portfolio) {
  const emoji    = parseFloat(portfolio.totalPnl) >= 0 ? '📈' : '📉';
  const openCount = portfolio.openPositions.length;

  await sendPush(
    `${emoji} Resumen Diario — Bot BTC/ETH`,
    `Capital: $${portfolio.currentCapital} (${portfolio.totalPnlPct}%)\nTrades: ${portfolio.totalTrades} | WR: ${portfolio.winRate}%\nPosiciones abiertas: ${openCount}`,
    { type: 'daily_summary', ...portfolio }
  );
}

async function notifyBotStart(mode) {
  await sendPush(
    `🤖 Bot BTC/ETH iniciado`,
    `Modo: ${mode}\nAnalizando BTCUSDT y ETHUSDT cada día a las 00:05 UTC`,
    { type: 'bot_start' }
  );
}

module.exports = {
  sendPush,
  notifyBuy,
  notifySell,
  notifySignal,
  notifyStopLossRisk,
  notifyDailySummary,
  notifyBotStart,
};
