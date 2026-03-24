const ti = require('technicalindicators');

// ─────────────────────────────────────────
// Indicadores individuales
// ─────────────────────────────────────────

function calcRSI(closes, period = 14) {
  const result = ti.RSI.calculate({ values: closes, period });
  return {
    current: result[result.length - 1],
    prev:    result[result.length - 2],
  };
}

function calcMACD(closes) {
  const result = ti.MACD.calculate({
    values:             closes,
    fastPeriod:         12,
    slowPeriod:         26,
    signalPeriod:       9,
    SimpleMAOscillator: false,
    SimpleMASignal:     false,
  });
  const last = result[result.length - 1];
  const prev = result[result.length - 2];
  return {
    macd:           last.MACD,
    signal:         last.signal,
    histogram:      last.histogram,
    prevMacd:       prev.MACD,
    prevSignal:     prev.signal,
    bullishCross:   prev.MACD < prev.signal && last.MACD > last.signal,
    bearishCross:   prev.MACD > prev.signal && last.MACD < last.signal,
    bullishMomentum: last.MACD > last.signal,
    bearishMomentum: last.MACD < last.signal,
  };
}

function calcEMA(closes, period) {
  const result = ti.EMA.calculate({ values: closes, period });
  return result[result.length - 1];
}

function calcBollingerBands(closes, period = 20, stdDev = 2) {
  const result = ti.BollingerBands.calculate({ period, values: closes, stdDev });
  const last = result[result.length - 1];
  return {
    upper:     last.upper,
    middle:    last.middle,
    lower:     last.lower,
    bandwidth: (last.upper - last.lower) / last.middle, // volatilidad relativa
  };
}

function calcATR(candles, period = 14) {
  const result = ti.ATR.calculate({
    high:   candles.map(c => c.high),
    low:    candles.map(c => c.low),
    close:  candles.map(c => c.close),
    period,
  });
  return result[result.length - 1];
}

function calcOBV(candles) {
  const result = ti.OBV.calculate({
    close:  candles.map(c => c.close),
    volume: candles.map(c => c.volume),
  });
  const recent = result.slice(-10);
  // Comparamos la media de los últimos 5 días vs los 5 anteriores
  const recentAvg = recent.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const prevAvg   = recent.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  return {
    current:        result[result.length - 1],
    bullish:        recentAvg > prevAvg,
    momentum:       ((recentAvg - prevAvg) / Math.abs(prevAvg)) * 100,
  };
}

function calcVWAP(candles, lookback = 20) {
  const recent = candles.slice(-lookback);
  let cumulativeTPV = 0;
  let cumulativeVol = 0;
  recent.forEach(c => {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTPV += typicalPrice * c.volume;
    cumulativeVol += c.volume;
  });
  return cumulativeVol === 0 ? 0 : cumulativeTPV / cumulativeVol;
}

// ─────────────────────────────────────────
// Análisis completo (todos los indicadores)
// ─────────────────────────────────────────

/**
 * Recibe array de velas y devuelve todos los indicadores calculados
 * Requiere mínimo ~210 velas para EMA200
 */
function analyzeAll(candles) {
  if (candles.length < 210) {
    throw new Error(`Se necesitan al menos 210 velas, se recibieron ${candles.length}`);
  }

  const closes       = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  const rsi  = calcRSI(closes);
  const macd = calcMACD(closes);
  const ema50  = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const bb   = calcBollingerBands(closes);
  const atr  = calcATR(candles);
  const obv  = calcOBV(candles);
  const vwap = calcVWAP(candles);

  return {
    currentPrice,
    rsi: {
      value:        rsi.current,
      prev:         rsi.prev,
      oversold:     rsi.current < 35,
      overbought:   rsi.current > 70,
      neutral:      rsi.current >= 35 && rsi.current <= 70,
    },
    macd,
    ema: {
      ema50,
      ema200,
      aboveEma50:   currentPrice > ema50,
      aboveEma200:  currentPrice > ema200,
      bullishAlign: currentPrice > ema50 && ema50 > ema200,  // Golden area
      bearishAlign: currentPrice < ema50 && ema50 < ema200,  // Death area
    },
    bb: {
      upper:      bb.upper,
      middle:     bb.middle,
      lower:      bb.lower,
      bandwidth:  bb.bandwidth,
      nearLower:  currentPrice <= bb.lower * 1.008,    // Dentro del 0.8% de la banda inferior
      nearUpper:  currentPrice >= bb.upper * 0.992,    // Dentro del 0.8% de la banda superior
      aboveMiddle: currentPrice > bb.middle,
    },
    atr,
    obv,
    vwap: {
      value:      vwap,
      aboveVwap:  currentPrice > vwap,
      distance:   ((currentPrice - vwap) / vwap) * 100, // % por encima/debajo del VWAP
    },
  };
}

module.exports = { analyzeAll, calcATR };
