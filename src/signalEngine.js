const { analyzeAll } = require('./indicators');

// ─────────────────────────────────────────
// Pesos de cada indicador (suman 100%)
// ─────────────────────────────────────────
const WEIGHTS = {
  macd: 0.25,  // 25% - Mayor peso: detecta momentum y cruces
  rsi:  0.20,  // 20% - Sobrecompra/sobreventa
  ema:  0.20,  // 20% - Tendencia general
  bb:   0.15,  // 15% - Niveles extremos de precio
  vwap: 0.10,  // 10% - Precio justo intradía
  obv:  0.10,  // 10% - Confirma con volumen
};

// Umbrales para disparar operaciones
const BUY_THRESHOLD  = 0.55;  // 55% para comprar (bajado para backtest)
const SELL_THRESHOLD = 0.50;  // 50% para vender (bajado para backtest)

// ─────────────────────────────────────────
// Scoring individual por indicador
// ─────────────────────────────────────────

function scoreMacd(macd, direction) {
  if (direction === 'buy') {
    if (macd.bullishCross)      return 1.0;   // Cruce alcista = señal fuerte
    if (macd.bullishMomentum)   return 0.5;   // Ya alcista pero sin cruce
    return 0;
  } else {
    if (macd.bearishCross)      return 1.0;   // Cruce bajista = señal fuerte
    if (macd.bearishMomentum)   return 0.5;   // Ya bajista pero sin cruce
    return 0;
  }
}

function scoreRsi(rsi, direction) {
  if (direction === 'buy') {
    if (rsi.value < 30)   return 1.0;  // Muy sobrevendido
    if (rsi.value < 40)   return 0.8;
    if (rsi.value < 50)   return 0.5;  // Zona neutral-bullish
    if (rsi.value < 60)   return 0.2;
    return 0;                           // Overbought = no comprar
  } else {
    if (rsi.value > 75)   return 1.0;  // Muy sobrecomprado
    if (rsi.value > 65)   return 0.8;
    if (rsi.value > 55)   return 0.5;  // Zona neutral-bearish
    if (rsi.value > 45)   return 0.2;
    return 0;                           // Oversold = no vender
  }
}

function scoreEma(ema, direction) {
  if (direction === 'buy') {
    if (ema.bullishAlign)    return 1.0;  // Precio > EMA50 > EMA200 (Golden Cross area)
    if (ema.aboveEma50)      return 0.6;  // Solo sobre EMA50
    if (ema.aboveEma200)     return 0.3;  // Solo sobre EMA200
    return 0;
  } else {
    if (ema.bearishAlign)    return 1.0;  // Precio < EMA50 < EMA200 (Death Cross area)
    if (!ema.aboveEma50)     return 0.6;  // Bajo EMA50
    if (!ema.aboveEma200)    return 0.3;  // Bajo EMA200
    return 0;
  }
}

function scoreBollingerBands(bb, direction) {
  if (direction === 'buy') {
    if (bb.nearLower)       return 1.0;  // Tocando banda inferior = rebote probable
    if (!bb.aboveMiddle)    return 0.4;  // Bajo la media = tendencia bajista
    return 0;
  } else {
    if (bb.nearUpper)       return 1.0;  // Tocando banda superior = caída probable
    if (bb.aboveMiddle)     return 0.4;  // Sobre la media = tendencia alcista
    return 0;
  }
}

function scoreVwap(vwap, direction) {
  if (direction === 'buy') {
    // Preferimos comprar cerca del VWAP o ligeramente por encima
    if (vwap.aboveVwap && vwap.distance < 2)   return 1.0;  // Justo sobre VWAP
    if (vwap.aboveVwap)                          return 0.7;  // Sobre VWAP
    if (!vwap.aboveVwap && vwap.distance > -3)  return 0.3;  // Cerca del VWAP por debajo
    return 0;
  } else {
    if (!vwap.aboveVwap && Math.abs(vwap.distance) < 2) return 1.0;
    if (!vwap.aboveVwap)                                  return 0.7;
    if (vwap.aboveVwap && vwap.distance < 3)             return 0.3;
    return 0;
  }
}

function scoreObv(obv, direction) {
  if (direction === 'buy') {
    if (obv.bullish && obv.momentum > 1)  return 1.0;  // OBV alcista con momentum
    if (obv.bullish)                       return 0.6;  // OBV alcista
    return 0;
  } else {
    if (!obv.bullish && obv.momentum < -1) return 1.0; // OBV bajista con momentum
    if (!obv.bullish)                       return 0.6;
    return 0;
  }
}

// ─────────────────────────────────────────
// Score total ponderado
// ─────────────────────────────────────────

function computeWeightedScore(indicators, direction) {
  const scores = {
    macd: scoreMacd(indicators.macd, direction),
    rsi:  scoreRsi(indicators.rsi, direction),
    ema:  scoreEma(indicators.ema, direction),
    bb:   scoreBollingerBands(indicators.bb, direction),
    vwap: scoreVwap(indicators.vwap, direction),
    obv:  scoreObv(indicators.obv, direction),
  };

  const total =
    scores.macd * WEIGHTS.macd +
    scores.rsi  * WEIGHTS.rsi  +
    scores.ema  * WEIGHTS.ema  +
    scores.bb   * WEIGHTS.bb   +
    scores.vwap * WEIGHTS.vwap +
    scores.obv  * WEIGHTS.obv;

  return { score: total, scores };
}

// ─────────────────────────────────────────
// Función principal: genera señal
// ─────────────────────────────────────────

/**
 * Recibe array de velas, devuelve señal con score y detalle
 */
function generateSignal(candles) {
  const indicators = analyzeAll(candles);

  const buyResult  = computeWeightedScore(indicators, 'buy');
  const sellResult = computeWeightedScore(indicators, 'sell');

  let action = 'HOLD';
  let score  = 0;
  let scores = {};
  let direction = 'buy';

  if (buyResult.score >= BUY_THRESHOLD) {
    action    = 'BUY';
    score     = buyResult.score;
    scores    = buyResult.scores;
    direction = 'buy';
  } else if (sellResult.score >= SELL_THRESHOLD) {
    action    = 'SELL';
    score     = sellResult.score;
    scores    = sellResult.scores;
    direction = 'sell';
  } else {
    // HOLD: guardamos el score más alto para logging
    if (buyResult.score > sellResult.score) {
      score  = buyResult.score;
      scores = buyResult.scores;
    } else {
      score  = sellResult.score;
      scores = sellResult.scores;
      direction = 'sell';
    }
  }

  return {
    action,
    direction,
    score:         Math.round(score * 100),  // 0-100
    scoreRaw:      score,
    scores,                                  // Score individual por indicador
    indicators,
    thresholdUsed: action === 'SELL' ? SELL_THRESHOLD : BUY_THRESHOLD,
  };
}

module.exports = {
  generateSignal,
  BUY_THRESHOLD,
  SELL_THRESHOLD,
  WEIGHTS,
};
