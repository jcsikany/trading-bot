require('dotenv').config();

const express = require('express');
const { initDB }              = require('./src/db');
const { startScheduler, runDailyAnalysis, runRiskCheck } = require('./src/scheduler');
const { getPortfolioSummary, getTradeHistory, getSignalHistory } = require('./src/portfolio');
const { notifyBotStart }      = require('./src/notifier');
const { backtestSymbol }      = require('./src/backtester');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ─────────────────────────────────────────
// Middleware de logging
// ─────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────
// Rutas
// ─────────────────────────────────────────

// Health check / estado del bot
app.get('/', (req, res) => {
  res.json({
    name:      'BTC/ETH Trading Bot',
    status:    'running',
    mode:      process.env.PAPER_TRADING === 'true' ? '📝 PAPER TRADING' : '💰 LIVE TRADING',
    symbols:   ['BTCUSDT', 'ETHUSDT'],
    interval:  '1d',
    timestamp: new Date().toISOString(),
    uptime:    `${Math.floor(process.uptime() / 60)} min`,
  });
});

// Resumen del portfolio
app.get('/portfolio', async (req, res) => {
  try {
    const summary = await getPortfolioSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Historial de trades
app.get('/trades', async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit) || 30;
    const trades = await getTradeHistory(limit);
    res.json({ count: trades.length, trades });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Historial de señales
app.get('/signals', async (req, res) => {
  try {
    const { symbol, limit } = req.query;
    const signals = await getSignalHistory(symbol || null, parseInt(limit) || 30);
    res.json({ count: signals.length, signals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forzar análisis manualmente (útil para testing)
app.post('/analyze', async (req, res) => {
  res.json({ message: 'Análisis disparado manualmente', timestamp: new Date().toISOString() });
  runDailyAnalysis().catch(console.error);
});

// Forzar chequeo de riesgo manualmente
app.post('/risk-check', async (req, res) => {
  res.json({ message: 'Risk check disparado manualmente', timestamp: new Date().toISOString() });
  runRiskCheck().catch(console.error);
});

// Correr backtest desde la API
app.post('/backtest', async (req, res) => {
  const { symbol = 'BTCUSDT', interval = '1d', candles = 365 } = req.body;

  if (!['BTCUSDT', 'ETHUSDT'].includes(symbol)) {
    return res.status(400).json({ error: 'Symbol debe ser BTCUSDT o ETHUSDT' });
  }

  try {
    const result = await backtestSymbol(symbol, interval, candles);
    // No enviamos los trades individuales en la respuesta API (pueden ser muchos)
    const { trades, equityCurve, ...summary } = result;
    res.json({ summary, tradesCount: trades.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// Arranque del servidor
// ─────────────────────────────────────────

async function main() {
  console.log('🤖 Iniciando BTC/ETH Trading Bot...');
  console.log(`   Modo: ${process.env.PAPER_TRADING === 'true' ? '📝 PAPER TRADING (seguro)' : '💰 LIVE TRADING (¡dinero real!)'}`);
  console.log(`   Capital inicial: $${process.env.INITIAL_CAPITAL || '200'}`);

  // Inicializar base de datos
  await initDB();

  // Arrancar el scheduler (análisis diario + risk checks)
  startScheduler();

  // Notificar que el bot arrancó
  await notifyBotStart(process.env.PAPER_TRADING === 'true' ? 'PAPER TRADING' : 'LIVE TRADING');

  // Levantar servidor HTTP
  app.listen(PORT, () => {
    console.log(`\n✅ Servidor corriendo en puerto ${PORT}`);
    console.log(`   GET  /portfolio  → Resumen del portfolio`);
    console.log(`   GET  /trades     → Historial de operaciones`);
    console.log(`   GET  /signals    → Historial de señales`);
    console.log(`   POST /analyze    → Disparar análisis manual`);
    console.log(`   POST /risk-check → Disparar chequeo de riesgo`);
    console.log(`   POST /backtest   → Correr backtest`);
  });
}

main().catch(err => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
