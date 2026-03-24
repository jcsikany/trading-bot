/**
 * Backtester - Simula la estrategia contra datos históricos reales de Binance
 * Uso: npm run backtest
 */

require('dotenv').config();

const { getKlines }          = require('./binanceClient');
const { analyzeAll }         = require('./indicators');
const { generateSignal }     = require('./signalEngine');
const {
  calculateStopLoss,
  calculateTakeProfit,
  calculateQuantity,
  isStopLossTriggered,
  isTakeProfitTriggered,
  calculatePnL,
} = require('./riskManager');

const INITIAL_CAPITAL  = parseFloat(process.env.INITIAL_CAPITAL || '200');
const CAPITAL_PER_SYMBOL = INITIAL_CAPITAL * 0.5;  // 50% por símbolo
const WARMUP_CANDLES   = 210;                        // Necesario para EMA200
const BINANCE_FEE_PCT  = 0.001;                      // 0.1% por operación

// ─────────────────────────────────────────
// Backtest de un símbolo
// ─────────────────────────────────────────

async function backtestSymbol(symbol, interval = '1d', totalCandles = 500) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔍 Backtesting ${symbol} | Intervalo: ${interval} | Velas: ${totalCandles}`);
  console.log(`${'═'.repeat(60)}`);

  const allCandles = await getKlines(symbol, interval, Math.min(totalCandles + WARMUP_CANDLES, 1000));
  console.log(`📊 Velas obtenidas: ${allCandles.length}`);

  if (allCandles.length < WARMUP_CANDLES + 10) {
    throw new Error(`Datos insuficientes: ${allCandles.length} velas`);
  }

  let capital  = CAPITAL_PER_SYMBOL;
  let position = null;
  const trades      = [];
  const equityCurve = [{ i: 0, capital, date: new Date(allCandles[WARMUP_CANDLES].closeTime) }];

  let maxCapital = capital;
  let maxDrawdown = 0;

  // Recorremos desde WARMUP_CANDLES hasta el final
  for (let i = WARMUP_CANDLES; i < allCandles.length; i++) {
    const candles      = allCandles.slice(0, i + 1);
    const currentCandle = candles[candles.length - 1];
    const price         = currentCandle.close;
    const date          = new Date(currentCandle.closeTime).toISOString().split('T')[0];

    // ── Chequear SL / TP si hay posición ──
    if (position) {
      let closed = false;

      if (isStopLossTriggered(price, position.stopLoss)) {
        const fee  = position.usdtValue * BINANCE_FEE_PCT;
        const { pnl, pnlPct } = calculatePnL(position.entryPrice, price, position.quantity, position.usdtValue);
        const netPnl = pnl - fee;
        capital += position.usdtValue + netPnl;
        trades.push({ date, type: 'SELL', reason: 'stop_loss', entryPrice: position.entryPrice, exitPrice: price, pnl: netPnl, pnlPct, fee });
        console.log(`  🛑 ${date} STOP LOSS  [${symbol}] @ $${price.toFixed(0)} | P&L: $${netPnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        position = null;
        closed   = true;
      }

      if (!closed && isTakeProfitTriggered(price, position.takeProfit)) {
        const fee  = position.usdtValue * BINANCE_FEE_PCT;
        const { pnl, pnlPct } = calculatePnL(position.entryPrice, price, position.quantity, position.usdtValue);
        const netPnl = pnl - fee;
        capital += position.usdtValue + netPnl;
        trades.push({ date, type: 'SELL', reason: 'take_profit', entryPrice: position.entryPrice, exitPrice: price, pnl: netPnl, pnlPct, fee });
        console.log(`  🎯 ${date} TAKE PROFIT [${symbol}] @ $${price.toFixed(0)} | P&L: $${netPnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        position = null;
        closed   = true;
      }
    }

    // ── Generar señal ──────────────────────
    let signal;
    try {
      signal = generateSignal(candles);
    } catch {
      continue;
    }

    // ── Ejecutar BUY ──────────────────────
    if (signal.action === 'BUY' && !position && capital >= 10) {
      const usdtAmount = capital;
      const fee        = usdtAmount * BINANCE_FEE_PCT;
      const qty        = calculateQuantity(usdtAmount - fee, price);
      const stopLoss   = calculateStopLoss(price, signal.indicators.atr);
      const takeProfit = calculateTakeProfit(price, signal.indicators.atr);

      position = {
        entryPrice: price,
        quantity:   qty,
        usdtValue:  usdtAmount - fee,
        stopLoss,
        takeProfit,
        date,
        score: signal.score,
      };
      capital -= usdtAmount;

      console.log(`  📈 ${date} BUY  [${symbol}] @ $${price.toFixed(0)} | Score: ${signal.score}% | SL: $${stopLoss.toFixed(0)} | TP: $${takeProfit.toFixed(0)}`);
    }

    // ── Ejecutar SELL por señal ────────────
    else if (signal.action === 'SELL' && position) {
      const fee  = position.usdtValue * BINANCE_FEE_PCT;
      const { pnl, pnlPct } = calculatePnL(position.entryPrice, price, position.quantity, position.usdtValue);
      const netPnl = pnl - fee;
      capital += position.usdtValue + netPnl;
      trades.push({ date, type: 'SELL', reason: 'signal', entryPrice: position.entryPrice, exitPrice: price, pnl: netPnl, pnlPct, fee });
      console.log(`  📉 ${date} SELL [${symbol}] @ $${price.toFixed(0)} | Score: ${signal.score}% | P&L: $${netPnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
      position = null;
    }

    // ── Equity curve y drawdown ────────────
    const totalCapital = position
      ? capital + position.usdtValue + calculatePnL(position.entryPrice, price, position.quantity, position.usdtValue).pnl
      : capital;

    if (totalCapital > maxCapital) maxCapital = totalCapital;
    const drawdown = ((maxCapital - totalCapital) / maxCapital) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    equityCurve.push({ i: i - WARMUP_CANDLES, capital: totalCapital, date });
  }

  // ── Cerrar posición abierta al final ──
  if (position) {
    const lastPrice = allCandles[allCandles.length - 1].close;
    const { pnl, pnlPct } = calculatePnL(position.entryPrice, lastPrice, position.quantity, position.usdtValue);
    capital += position.usdtValue + pnl;
    trades.push({ date: 'end', type: 'SELL', reason: 'end_of_backtest', entryPrice: position.entryPrice, exitPrice: lastPrice, pnl, pnlPct, fee: 0 });
  }

  // ── Estadísticas finales ───────────────
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades  = trades.filter(t => t.pnl <= 0);
  const totalPnl      = capital - CAPITAL_PER_SYMBOL;
  const totalPnlPct   = (totalPnl / CAPITAL_PER_SYMBOL) * 100;
  const avgWinPct     = winningTrades.length > 0 ? winningTrades.reduce((s, t) => s + t.pnlPct, 0) / winningTrades.length : 0;
  const avgLossPct    = losingTrades.length > 0  ? losingTrades.reduce((s, t) => s + t.pnlPct, 0) / losingTrades.length   : 0;
  const totalFees     = trades.reduce((s, t) => s + (t.fee || 0), 0);

  const summary = {
    symbol,
    interval,
    candlesAnalyzed: allCandles.length - WARMUP_CANDLES,
    initialCapital:  CAPITAL_PER_SYMBOL.toFixed(2),
    finalCapital:    capital.toFixed(2),
    totalPnl:        totalPnl.toFixed(2),
    totalPnlPct:     totalPnlPct.toFixed(2),
    totalTrades:     trades.length,
    winningTrades:   winningTrades.length,
    losingTrades:    losingTrades.length,
    winRate:         trades.length > 0 ? ((winningTrades.length / trades.length) * 100).toFixed(1) : '0',
    avgWinPct:       avgWinPct.toFixed(2),
    avgLossPct:      avgLossPct.toFixed(2),
    maxDrawdown:     maxDrawdown.toFixed(2),
    totalFeesPaid:   totalFees.toFixed(2),
    trades,
    equityCurve,
  };

  // ── Imprimir resumen ───────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 RESULTADO BACKTEST - ${symbol}`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`  Capital:    $${summary.initialCapital} → $${summary.finalCapital}`);
  console.log(`  P&L Total:  $${summary.totalPnl} (${summary.totalPnlPct}%)`);
  console.log(`  Trades:     ${summary.totalTrades} (${summary.winningTrades}W / ${summary.losingTrades}L)`);
  console.log(`  Win Rate:   ${summary.winRate}%`);
  console.log(`  Avg Win:    +${summary.avgWinPct}%  |  Avg Loss: ${summary.avgLossPct}%`);
  console.log(`  Max DD:     ${summary.maxDrawdown}%`);
  console.log(`  Fees:       $${summary.totalFeesPaid}`);

  return summary;
}

// ─────────────────────────────────────────
// Backtest combinado BTC + ETH
// ─────────────────────────────────────────

async function runAllBacktests() {
  const symbols  = ['BTCUSDT', 'ETHUSDT'];
  const results  = {};

  for (const symbol of symbols) {
    results[symbol] = await backtestSymbol(symbol, '1d', 500);
  }

  const totalFinal   = Object.values(results).reduce((sum, r) => sum + parseFloat(r.finalCapital), 0);
  const totalPnl     = totalFinal - INITIAL_CAPITAL;
  const totalPnlPct  = (totalPnl / INITIAL_CAPITAL) * 100;
  const totalTrades  = Object.values(results).reduce((sum, r) => sum + r.totalTrades, 0);
  const totalFees    = Object.values(results).reduce((sum, r) => sum + parseFloat(r.totalFeesPaid), 0);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🏆 RESUMEN COMBINADO BTC + ETH`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Capital inicial: $${INITIAL_CAPITAL.toFixed(2)}`);
  console.log(`  Capital final:   $${totalFinal.toFixed(2)}`);
  console.log(`  P&L Total:       $${totalPnl.toFixed(2)} (${totalPnlPct.toFixed(2)}%)`);
  console.log(`  Trades totales:  ${totalTrades}`);
  console.log(`  Fees totales:    $${totalFees.toFixed(2)}`);
  console.log(`${'═'.repeat(60)}\n`);

  return results;
}

// Ejecutar si se llama directamente
if (require.main === module) {
  runAllBacktests()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error en backtest:', err.message);
      process.exit(1);
    });
}

module.exports = { backtestSymbol, runAllBacktests };
