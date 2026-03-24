# 🤖 BTC/ETH Trading Bot

Bot de trading técnico para BTC y ETH en Binance con soporte para **Paper Trading** y **Live Trading**.

## 📊 Indicadores incluidos

| Indicador | Peso | Función |
|-----------|------|---------|
| MACD (12/26/9) | 25% | Detección de cruces y momentum |
| RSI (14) | 20% | Zonas de sobrecompra/sobreventa |
| EMA 50/200 | 20% | Tendencia general |
| Bollinger Bands (20,2) | 15% | Extremos de precio |
| VWAP (20 días) | 10% | Precio justo por volumen |
| OBV | 10% | Confirmación con volumen |

**Umbral de compra:** ≥ 70% | **Umbral de venta:** ≥ 65%

## 🛡️ Gestión de riesgo

- **Stop Loss dinámico:** 1.5x ATR por debajo del precio de entrada
- **Take Profit dinámico:** 3x ATR (ratio R:R = 1:2)
- **Capital por símbolo:** 50% del capital total
- **Máx. 1 posición abierta por símbolo a la vez**

## ⏰ Horarios de ejecución

- `00:05 UTC` — Análisis diario (al cierre de la vela D1)
- `Cada 4 horas` — Chequeo de Stop Loss / Take Profit
- `08:00 UTC` — Resumen diario push notification

---

## 🚀 Setup en Railway

### 1. Clonar y preparar el proyecto

```bash
git init
git add .
git commit -m "Initial bot setup"
```

### 2. Crear proyecto en Railway

1. Ir a [railway.app](https://railway.app) → New Project
2. Deploy from GitHub repo
3. Agregar **PostgreSQL** como plugin

### 3. Configurar variables de entorno en Railway

```
BINANCE_API_KEY=tu_api_key
BINANCE_SECRET_KEY=tu_secret_key
DATABASE_URL=         ← Railway lo llena automático con PostgreSQL
PAPER_TRADING=true    ← Empezar siempre en paper trading
INITIAL_CAPITAL=200
EXPO_PUSH_TOKEN=ExponentPushToken[...]
NODE_ENV=production
PORT=3000
```

### 4. Obtener API Key de Binance

1. Binance → Perfil → API Management
2. Crear nueva API Key
3. Habilitar: ✅ Spot Trading
4. Deshabilitar: ❌ Withdrawals (nunca habilitar esto)
5. Agregar IP de Railway al whitelist (en Railway: Settings → Networking → Outbound IPs)

---

## 📝 Flujo recomendado

```
1. PAPER TRADING (2-3 meses)
   └── npm run backtest       ← Ver resultados históricos primero
   └── Observar señales reales sin riesgo

2. Evaluar resultados
   └── Win Rate > 50%?
   └── Drawdown aceptable?
   └── P&L positivo?

3. LIVE TRADING
   └── Cambiar PAPER_TRADING=false en Railway
   └── Verificar que BINANCE_API_KEY tenga permisos de trading
```

---

## 🔌 API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/` | Estado del bot |
| GET | `/portfolio` | Resumen del portfolio y P&L |
| GET | `/trades?limit=30` | Historial de operaciones |
| GET | `/signals?symbol=BTCUSDT` | Historial de señales |
| POST | `/analyze` | Disparar análisis manual |
| POST | `/risk-check` | Chequear SL/TP manualmente |
| POST | `/backtest` | Correr backtest |

### Ejemplo backtest via API

```bash
curl -X POST https://tu-bot.railway.app/backtest \
  -H "Content-Type: application/json" \
  -d '{"symbol": "BTCUSDT", "interval": "1d", "candles": 365}'
```

---

## 📱 Notificaciones

El bot envía push notifications para:
- 🟢 Nueva compra (con precio, SL, TP y score)
- ✅/❌ Venta (con P&L y motivo)
- ⚠️ Alerta cuando el precio se acerca al Stop Loss (<3%)
- 📈 Resumen diario a las 8 AM UTC

---

## ⚠️ Disclaimer

Este bot es para fines educativos. Ninguna estrategia técnica garantiza ganancias. Siempre operá con capital que podés permitirte perder.
