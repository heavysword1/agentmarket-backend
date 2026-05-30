const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 120 });

// Mapping of token name patterns to stock tickers
const TICKER_MAPPING = {
  'NVIDIA': 'NVDA',
  'Tesla': 'TSLA',
  'Alphabet': 'GOOGL',
  'Circle': 'CRCL',
  'Micron': 'MU',
  'Strategy': 'MSTR'
};

// Helper to extract stock ticker from token name
function extractTicker(tokenName) {
  for (const [pattern, ticker] of Object.entries(TICKER_MAPPING)) {
    if (tokenName.includes(pattern)) {
      return ticker;
    }
  }
  return null;
}

router.get('/', async (req, res) => {
  try {
    const now = new Date().toISOString();

    // Step 1: Get tokenized prices from CoinGecko
    const tokenResponse = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        category: 'tokenized-stock',
        order: 'market_cap_desc',
        per_page: 50,
        page: 1,
        sparkline: false
      },
      timeout: 10000
    });

    const tokenizedCoins = tokenResponse.data || [];

    // Step 2: Build mapping and filter coins with valid tickers
    const pairsMap = {};
    const tickersNeeded = new Set();

    for (const coin of tokenizedCoins) {
      const ticker = extractTicker(coin.name);
      if (ticker) {
        pairsMap[ticker] = {
          token_symbol: coin.symbol?.toUpperCase(),
          token_name: coin.name,
          token_price_usd: coin.current_price,
          stock_ticker: ticker
        };
        tickersNeeded.add(ticker);
      }
    }

    if (tickersNeeded.size === 0) {
      return res.json({
        success: true,
        as_of: now,
        pairs: [],
        disclaimer: 'Not financial advice. Spreads may reflect fees, liquidity differences, or fractional denomination.',
        note: 'No tokenized stocks with mapped tickers found.',
        source: 'CoinGecko + Twelve Data'
      });
    }

    // Step 3: Get stock prices from Twelve Data
    const tickersParam = Array.from(tickersNeeded).join(',');
    const stockResponse = await axios.get('https://api.twelvedata.com/price', {
      params: {
        symbol: tickersParam,
        apikey: process.env.TWELVE_DATA_API_KEY
      },
      timeout: 10000
    });

    const stockData = stockResponse.data || {};

    // Step 4: Calculate spreads and build response
    const pairs = [];
    for (const [ticker, tokenInfo] of Object.entries(pairsMap)) {
      const stockPrice = stockData[ticker]?.price || stockData[ticker];
      if (!stockPrice) {
        continue;
      }

      const tokenPrice = parseFloat(tokenInfo.token_price_usd);
      const stockPriceNum = parseFloat(stockPrice);

      if (!isFinite(tokenPrice) || !isFinite(stockPriceNum) || stockPriceNum <= 0) {
        continue;
      }

      const premiumPct = ((tokenPrice / stockPriceNum) - 1) * 100;
      const spreadUsd = tokenPrice - stockPriceNum;

      let signal;
      if (Math.abs(premiumPct) < 0.5) {
        signal = 'FAIR_VALUE';
      } else if (premiumPct > 0) {
        signal = 'PREMIUM';
      } else {
        signal = 'DISCOUNT';
      }

      pairs.push({
        token_symbol: tokenInfo.token_symbol,
        token_name: tokenInfo.token_name,
        token_price_usd: parseFloat(tokenPrice.toFixed(4)),
        stock_ticker: ticker,
        stock_price_usd: parseFloat(stockPriceNum.toFixed(4)),
        premium_pct: parseFloat(premiumPct.toFixed(2)),
        spread_usd: parseFloat(spreadUsd.toFixed(4)),
        signal,
        note: 'Tokenized asset may trade at premium/discount due to liquidity, fees, or market structure'
      });
    }

    // Sort by absolute premium descending
    pairs.sort((a, b) => Math.abs(b.premium_pct) - Math.abs(a.premium_pct));

    const result = {
      success: true,
      as_of: now,
      pairs,
      disclaimer: 'Not financial advice. Spreads may reflect fees, liquidity differences, or fractional denomination.',
      source: 'CoinGecko + Twelve Data'
    };

    cache.set(`arbitrage`, result);
    res.json(result);
  } catch (err) {
    console.error('Arbitrage endpoint error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
