const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const NodeCache = require('node-cache');

const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 });

async function getAnalystRatings(symbol, limit = 5) {
  const cacheKey = `analyst:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const token = process.env.FINNHUB_API_KEY;
    if (!token) throw new Error('FINNHUB_API_KEY not configured');

    // Fetch recommendation data
    const recRes = await fetch(
      `https://finnhub.io/api/v1/stock/recommendation?symbol=${symbol}&token=${token}`
    );
    const recData = await recRes.json();
    if (!Array.isArray(recData)) {
      throw new Error(`Finnhub recommendation: ${recData.error || 'invalid response'}`);
    }

    // Fetch price target data
    const priceRes = await fetch(
      `https://finnhub.io/api/v1/price-target?symbol=${symbol}&token=${token}`
    );
    const priceData = await priceRes.json();
    if (priceData.error) {
      throw new Error(`Finnhub price-target: ${priceData.error}`);
    }

    // Get latest consensus
    const latest = recData[0] || {};
    const consensus = {
      strongBuy: latest.strongBuy || 0,
      buy: latest.buy || 0,
      hold: latest.hold || 0,
      sell: latest.sell || 0,
      strongSell: latest.strongSell || 0,
      total: (latest.strongBuy || 0) + (latest.buy || 0) + (latest.hold || 0) + (latest.sell || 0) + (latest.strongSell || 0)
    };

    // Determine recommendation
    if (consensus.total > 0) {
      if (consensus.strongBuy / consensus.total > 0.5) {
        consensus.recommendation = 'STRONG BUY';
      } else if ((consensus.strongBuy + consensus.buy) / consensus.total > 0.5) {
        consensus.recommendation = 'BUY';
      } else if ((consensus.strongSell + consensus.sell) / consensus.total > 0.3) {
        consensus.recommendation = 'SELL';
      } else {
        consensus.recommendation = 'HOLD';
      }
    } else {
      consensus.recommendation = 'HOLD';
    }

    const result = {
      success: true,
      symbol,
      consensus,
      price_target: {
        low: priceData.targetLow || null,
        mean: priceData.targetMean || null,
        high: priceData.targetHigh || null,
        median: priceData.targetMedian || null
      },
      history: recData.slice(0, 3),
      source: 'Finnhub'
    };

    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    return { success: false, error: err.message, symbol };
  }
}

router.get('/', async (req, res) => {
  const symbol = req.query.symbol || 'AAPL';
  const limit = req.query.limit || 5;
  const result = await getAnalystRatings(symbol, limit);
  res.json(result);
});

module.exports = router;
