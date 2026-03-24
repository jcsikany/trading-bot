const axios = require('axios');
const crypto = require('crypto');

// Siempre usamos precios reales aunque estemos en paper trading
const MARKET_URL = 'https://api.binance.com';

// Para órdenes reales usamos la URL correspondiente
const TRADE_URL = process.env.PAPER_TRADING === 'true'
  ? 'https://testnet.binance.vision'  // Testnet para pruebas
  : 'https://api.binance.com';        // Live para dinero real

// Rate limiting básico: Binance permite 1200 requests/minuto
const requestQueue = [];
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // ms entre requests

async function throttledRequest(fn) {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_REQUEST_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - timeSinceLast));
  }
  lastRequestTime = Date.now();
  return fn();
}

function sign(params) {
  const query = new URLSearchParams(params).toString();
  return crypto
    .createHmac('sha256', process.env.BINANCE_SECRET_KEY)
    .update(query)
    .digest('hex');
}

/**
 * Obtiene velas OHLCV de un símbolo
 * @param {string} symbol - Ej: 'BTCUSDT'
 * @param {string} interval - '1d', '4h', '1w'
 * @param {number} limit - máx 1000
 */
async function getKlines(symbol, interval = '1d', limit = 500) {
  return throttledRequest(async () => {
    const response = await axios.get(`${MARKET_URL}/api/v3/klines`, {
      params: { symbol, interval, limit },
    });

    return response.data.map(k => ({
      openTime:  k[0],
      open:      parseFloat(k[1]),
      high:      parseFloat(k[2]),
      low:       parseFloat(k[3]),
      close:     parseFloat(k[4]),
      volume:    parseFloat(k[5]),
      closeTime: k[6],
    }));
  });
}

/**
 * Obtiene el precio actual de mercado
 */
async function getCurrentPrice(symbol) {
  return throttledRequest(async () => {
    const response = await axios.get(`${MARKET_URL}/api/v3/ticker/price`, {
      params: { symbol },
    });
    return parseFloat(response.data.price);
  });
}

/**
 * Obtiene info de la cuenta (balances)
 */
async function getAccountInfo() {
  return throttledRequest(async () => {
    const timestamp = Date.now();
    const params = { timestamp };
    params.signature = sign(params);

    const response = await axios.get(`${TRADE_URL}/api/v3/account`, {
      params,
      headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY },
    });
    return response.data;
  });
}

/**
 * Coloca una orden de mercado (solo en live mode)
 */
async function placeMarketOrder(symbol, side, quantity) {
  if (process.env.PAPER_TRADING === 'true') {
    throw new Error('placeMarketOrder no debe llamarse en paper trading mode');
  }

  return throttledRequest(async () => {
    const timestamp = Date.now();
    const params = {
      symbol,
      side,           // 'BUY' | 'SELL'
      type: 'MARKET',
      quantity: parseFloat(quantity).toFixed(6),
      timestamp,
    };
    params.signature = sign(params);

    const response = await axios.post(`${TRADE_URL}/api/v3/order`, null, {
      params,
      headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY },
    });
    return response.data;
  });
}

/**
 * Obtiene los mínimos de cantidad permitidos por Binance
 */
async function getMinQty(symbol) {
  return throttledRequest(async () => {
    const response = await axios.get(`${MARKET_URL}/api/v3/exchangeInfo`, {
      params: { symbol },
    });
    const filters = response.data.symbols[0].filters;
    const lotFilter = filters.find(f => f.filterType === 'LOT_SIZE');
    return {
      minQty:  parseFloat(lotFilter.minQty),
      stepSize: parseFloat(lotFilter.stepSize),
    };
  });
}

module.exports = {
  getKlines,
  getCurrentPrice,
  getAccountInfo,
  placeMarketOrder,
  getMinQty,
};
