function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getMarketPrice(market, keyCandidates) {
  for (const key of keyCandidates) {
    const value = numberOrNull(market?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function inferSideFromPrices(market) {
  const up = getMarketPrice(market, ["upPrice", "up", "yesPrice", "yes", "up_price"]);
  const down = getMarketPrice(market, ["downPrice", "down", "noPrice", "no", "down_price"]);
  if (up === null || down === null) return { side: "NEUTRAL", spread: 0, up, down };
  const spread = Math.abs(up - down);
  if (spread < 0.015) return { side: "NEUTRAL", spread, up, down };
  return { side: up > down ? "UP" : "DOWN", spread, up, down };
}

function summarizeBook(orderbook) {
  const bestBid = orderbook?.bestBid || orderbook?.bids?.[0] || null;
  const bestAsk = orderbook?.bestAsk || orderbook?.asks?.[0] || null;

  const bidPrice = numberOrNull(bestBid?.price ?? bestBid);
  const askPrice = numberOrNull(bestAsk?.price ?? bestAsk);
  const bidSize = numberOrNull(bestBid?.size) ?? 0;
  const askSize = numberOrNull(bestAsk?.size) ?? 0;
  const mid = numberOrNull(orderbook?.mid) ?? (bidPrice !== null && askPrice !== null ? (bidPrice + askPrice) / 2 : null);
  const spread = bidPrice !== null && askPrice !== null ? Math.max(0, askPrice - bidPrice) : null;
  const depthUsdc = Math.max(0, (bidPrice || 0) * bidSize + (askPrice || 0) * askSize);
  const imbalance = (bidSize + askSize) > 0 ? (bidSize - askSize) / (bidSize + askSize) : 0;

  return {
    bidPrice,
    askPrice,
    bidSize,
    askSize,
    mid,
    spread,
    spreadBps: spread !== null && mid ? Math.round((spread / mid) * 10000) : null,
    depthUsdc: Number(depthUsdc.toFixed(4)),
    imbalance: Number(imbalance.toFixed(4)),
    health: orderbook?.health || "UNKNOWN",
    payloadHash: orderbook?.payloadHash || null
  };
}

function summarizeCandles(candlesPayload) {
  const candles = Array.isArray(candlesPayload?.candles) ? candlesPayload.candles : [];
  const latest = candlesPayload?.latest || candles.at?.(-1) || null;
  const prev = candles.length >= 2 ? candles[candles.length - 2] : null;

  const latestClose = numberOrNull(latest?.close ?? latest?.price ?? candlesPayload?.livePrice);
  const prevClose = numberOrNull(prev?.close ?? prev?.price);

  const momentumBps = latestClose !== null && prevClose !== null && prevClose > 0
    ? ((latestClose - prevClose) / prevClose) * 10000
    : 0;

  const closes = candles.map((c) => numberOrNull(c.close ?? c.price)).filter((x) => x !== null);
  let realizedVolBps = 0;
  if (closes.length >= 3) {
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(1, returns.length);
    realizedVolBps = Math.sqrt(variance) * 10000;
  }

  return {
    latest,
    latestClose,
    prevClose,
    momentumBps: Number(momentumBps.toFixed(2)),
    realizedVolBps: Number(realizedVolBps.toFixed(2)),
    count: candles.length,
    payloadHash: candlesPayload?.payloadHash || null
  };
}

function bpsSignal({ market, orderbook, candles }) {
  const asset = process.env.ASSET || "BTC";
  const minDiffBps = Number(process.env.MIN_DIFF_BPS || 4.5);
  const maxSpread = Number(process.env.MAX_SPREAD || 0.08);
  const minLiquidityUsdc = Number(process.env.MIN_LIQUIDITY_USDC || 25);

  const priceSide = inferSideFromPrices(market);
  const book = summarizeBook(orderbook);
  const candle = summarizeCandles(candles);

  const marketEdgeBps = priceSide.spread * 10000;
  const momentumSide = candle.momentumBps > minDiffBps ? "UP" : candle.momentumBps < -minDiffBps ? "DOWN" : "NEUTRAL";

  let suggestedDirection = priceSide.side;
  if (suggestedDirection === "NEUTRAL" && momentumSide !== "NEUTRAL") suggestedDirection = momentumSide;
  if (priceSide.side !== "NEUTRAL" && momentumSide !== "NEUTRAL" && priceSide.side !== momentumSide) {
    suggestedDirection = "NEUTRAL";
  }

  const spreadPenalty = book.spread !== null && book.spread > maxSpread ? 25 : 0;
  const liquidityPenalty = book.depthUsdc < minLiquidityUsdc ? 20 : 0;
  const momentumBoost = Math.min(20, Math.abs(candle.momentumBps) / 2);
  const edgeBoost = Math.min(25, marketEdgeBps / 10);
  const confidence = clamp(Math.round(50 + edgeBoost + momentumBoost - spreadPenalty - liquidityPenalty), 0, 95);

  const entryMode = Math.abs(candle.momentumBps) >= minDiffBps * 2 ? "momentum" : "sideway_micro_scalp";
  const riskFlags = [];
  if (book.spread !== null && book.spread > maxSpread) riskFlags.push("WIDE_SPREAD");
  if (book.depthUsdc < minLiquidityUsdc) riskFlags.push("LOW_LIQUIDITY");
  if (suggestedDirection === "NEUTRAL") riskFlags.push("NO_CLEAR_DIRECTION");
  if (priceSide.side !== "NEUTRAL" && momentumSide !== "NEUTRAL" && priceSide.side !== momentumSide) riskFlags.push("DIRECTION_CONFLICT");

  return {
    asset,
    suggestedDirection,
    confidence,
    entryMode,
    regime: Math.abs(candle.momentumBps) > minDiffBps * 4 ? "BREAKOUT" : "NORMAL",
    edge: {
      marketEdgeBps: Number(marketEdgeBps.toFixed(2)),
      momentumBps: candle.momentumBps,
      minDiffBps,
      priceSide: priceSide.side,
      momentumSide
    },
    book,
    candle,
    riskFlags
  };
}

function evaluateRisk({ analyzerPayload, oraclePayload }) {
  const minConfidence = Number(process.env.MIN_CONFIDENCE || 60);
  const maxSpread = Number(process.env.MAX_SPREAD || 0.08);
  const minLiquidityUsdc = Number(process.env.MIN_LIQUIDITY_USDC || 25);

  const direction = analyzerPayload?.suggestedDirection || "NEUTRAL";
  const confidence = Number(analyzerPayload?.confidence || 0);
  const book = analyzerPayload?.signal?.book || analyzerPayload?.book || summarizeBook(oraclePayload?.orderbook || {});
  const flags = new Set([...(analyzerPayload?.riskFlags || []), ...(analyzerPayload?.signal?.riskFlags || [])]);

  if (confidence < minConfidence) flags.add("LOW_CONFIDENCE");
  if (direction === "NEUTRAL") flags.add("NO_CLEAR_DIRECTION");
  if (book?.spread !== null && Number(book?.spread) > maxSpread) flags.add("WIDE_SPREAD");
  if (Number(book?.depthUsdc || 0) < minLiquidityUsdc) flags.add("LOW_LIQUIDITY");

  const hardBlocks = ["NO_CLEAR_DIRECTION", "WIDE_SPREAD", "LOW_LIQUIDITY"];
  const approved = hardBlocks.every((flag) => !flags.has(flag)) && confidence >= minConfidence;

  return {
    approved,
    riskLevel: approved ? (confidence >= 75 ? "LOW" : "MEDIUM") : "HIGH",
    flags: Array.from(flags),
    checks: [
      "DRY_RUN_ONLY",
      "NO_PRIVATE_KEY_USAGE",
      "NO_REAL_TRADE_EXECUTION",
      `MIN_CONFIDENCE_${minConfidence}`,
      `MAX_SPREAD_${maxSpread}`,
      `MIN_LIQUIDITY_USDC_${minLiquidityUsdc}`
    ]
  };
}

module.exports = {
  numberOrNull,
  clamp,
  inferSideFromPrices,
  summarizeBook,
  summarizeCandles,
  bpsSignal,
  evaluateRisk
};
