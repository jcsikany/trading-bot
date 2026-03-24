const cron = require('node-cron');
const { getKlines }                = require('./binanceClient');
const { generateSignal }           = require('./signalEngine');
const { executeBuy, executeSell, checkRiskLevels, getOpenPosition } = require('./orderManager');
const { getPortfolioSummary }      = require('./portfolio');
const {
  notifyBuy,
  notifySell,
  notifySignal,
  notifyStopLossRisk,
  notifyDailySummary,
  notifyBotStart,
} = require('./notifier');
const { pool } = require('./db');

const SYMBOLS      = ['BTCUSDT', 'ETHUSDT'];
const PAPER_TRADING = process.env.PAPER_TRADING === 'true';
const STOP_LOSS_WARNING_THRESHOLD = 0.03; // Alerta si el precio está a <3% del SL

// ─────────────────────────────────────────
// Análisis diario principal
// ─────────────────────────────────────────

async function runDailyAnalysis() {
  const timestamp = new Date().toISOString();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🤖 ANÁLISIS DIARIO [${timestamp}]`);
  console.log(`   Modo: ${PAPER_TRADING ? '📝 PAPER TRADING' : '💰 LIVE TRADING'}`);
  console.log(`${'═'.repeat(60)}`);

  const portfolio = await getPortfolioSummary();
  const availableUsdt = parseFloat(portfolio.currentCapital);

  for (const symbol of SYMBOLS) {
    try {
      console.log(`\n📊 Analizando ${symbol}...`);

      // Obtener velas diarias (suficientes para todos los indicadores)
      const candles = await getKlines(symbol, '1d', 500);
      const signal  = generateSignal(candles);

      console.log([
        `   Acción: ${signal.action}`,
        `Score: ${signal.score}%`,
        `RSI: ${signal.indicators.rsi.value.toFixed(1)}`,
        `Precio: $${signal.indicators.currentPrice.toFixed(2)}`,
        `ATR: $${signal.indicators.atr.toFixed(2)}`,
      ].join(' | '));

      console.log(`   Scores → MACD: ${(signal.scores.macd * 100).toFixed(0)}% | RSI: ${(signal.scores.rsi * 100).toFixed(0)}% | EMA: ${(signal.scores.ema * 100).toFixed(0)}% | BB: ${(signal.scores.bb * 100).toFixed(0)}% | VWAP: ${(signal.scores.vwap * 100).toFixed(0)}% | OBV: ${(signal.scores.obv * 100).toFixed(0)}%`);

      // Guardar señal en BD
      await pool.query(
        `INSERT INTO signals
           (symbol, action, score, rsi, macd_signal, ema_signal, bb_signal, obv_signal, vwap_signal, price, atr)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          symbol,
          signal.action,
          signal.score,
          signal.indicators.rsi.value,
          signal.indicators.macd.bullishCross ? 'bullish_cross' : signal.indicators.macd.bearishCross ? 'bearish_cross' : signal.indicators.macd.bullishMomentum ? 'bullish' : 'bearish',
          signal.indicators.ema.bullishAlign ? 'bullish_align' : signal.indicators.ema.aboveEma50 ? 'above_ema50' : 'bearish',
          signal.indicators.bb.nearLower ? 'near_lower' : signal.indicators.bb.nearUpper ? 'near_upper' : 'middle',
          signal.indicators.obv.bullish ? 'bullish' : 'bearish',
          signal.indicators.vwap.aboveVwap ? 'above' : 'below',
          signal.indicators.currentPrice,
          signal.indicators.atr,
        ]
      );

      // Notificar señal (solo BUY/SELL)
      await notifySignal(symbol, signal.action, signal.score, signal.indicators);

      // Ejecutar operación
      if (signal.action === 'BUY') {
        const trade = await executeBuy(symbol, signal, availableUsdt);
        if (trade) {
          await notifyBuy(
            symbol,
            parseFloat(trade.price),
            parseFloat(trade.quantity),
            signal.score,
            parseFloat(trade.stop_loss),
            parseFloat(trade.take_profit),
            PAPER_TRADING
          );
        }
      } else if (signal.action === 'SELL') {
        const open = await getOpenPosition(symbol);
        if (open) {
          const trade = await executeSell(symbol, 'signal');
          if (trade) {
            await notifySell(symbol, trade.closePrice, trade.pnl, trade.pnlPct, 'signal', PAPER_TRADING);
          }
        }
      }

    } catch (err) {
      console.error(`❌ Error analizando ${symbol}:`, err.message);
    }
  }
}

// ─────────────────────────────────────────
// Chequeo de riesgo cada 4 horas
// ─────────────────────────────────────────

async function runRiskCheck() {
  console.log(`\n🛡️  [${new Date().toISOString()}] Chequeo de riesgo...`);

  for (const symbol of SYMBOLS) {
    try {
      const result = await checkRiskLevels(symbol);
      if (result) {
        await notifySell(symbol, result.closePrice, result.pnl, result.pnlPct, result.reason, PAPER_TRADING);
      } else {
        // Verificar si estamos cerca del stop loss (alerta preventiva)
        const open = await getOpenPosition(symbol);
        if (open) {
          const { getCurrentPrice } = require('./binanceClient');
          const currentPrice = await getCurrentPrice(symbol);
          const stopLoss     = parseFloat(open.stop_loss);
          const distancePct  = (currentPrice - stopLoss) / currentPrice;

          if (distancePct < STOP_LOSS_WARNING_THRESHOLD) {
            await notifyStopLossRisk(symbol, currentPrice, stopLoss);
          }
        }
      }
    } catch (err) {
      console.error(`❌ Error en risk check ${symbol}:`, err.message);
    }
  }
}

// ─────────────────────────────────────────
// Resumen diario (8 AM UTC)
// ─────────────────────────────────────────

async function runDailySummary() {
  try {
    const portfolio = await getPortfolioSummary();
    console.log('\n📈 RESUMEN DIARIO:');
    console.log(`   Capital: $${portfolio.currentCapital} | P&L: $${portfolio.totalPnl} (${portfolio.totalPnlPct}%)`);
    console.log(`   Trades: ${portfolio.totalTrades} | Win Rate: ${portfolio.winRate}%`);
    portfolio.openPositions.forEach(p => {
      console.log(`   📌 ${p.symbol}: $${p.currentPrice} | P&L no realizado: $${p.unrealizedPnl} (${p.unrealizedPct}%)`);
    });
    await notifyDailySummary(portfolio);
  } catch (err) {
    console.error('❌ Error en resumen diario:', err.message);
  }
}

// ─────────────────────────────────────────
// Arrancar el scheduler
// ─────────────────────────────────────────

function startScheduler() {
  // ── Análisis principal: diario a las 00:05 UTC ──
  // (5 minutos después del cierre de la vela diaria)
  cron.schedule('5 0 * * *', runDailyAnalysis, { timezone: 'UTC' });

  // ── Chequeo de SL/TP: cada 4 horas ──
  cron.schedule('0 */4 * * *', runRiskCheck, { timezone: 'UTC' });

  // ── Resumen diario: 8 AM UTC (5 AM Uruguay) ──
  cron.schedule('0 8 * * *', runDailySummary, { timezone: 'UTC' });

  console.log('\n⏰ Scheduler iniciado:');
  console.log('   • Análisis principal: 00:05 UTC (cierre de vela diaria)');
  console.log('   • Chequeo SL/TP:      cada 4 horas');
  console.log('   • Resumen diario:     08:00 UTC');

  // Ejecutar análisis inmediatamente al arrancar
  console.log('\n🚀 Ejecutando análisis inicial...');
  runDailyAnalysis().catch(console.error);
}

module.exports = { startScheduler, runDailyAnalysis, runRiskCheck, runDailySummary };
