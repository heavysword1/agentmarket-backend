const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 60 }); // 1 minute

// Map of coin IDs to their ticker symbols
const coinTickerMap = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  'binance-coin': 'BNB',
  solana: 'SOL',
  ripple: 'XRP',
  cardano: 'ADA',
  polkadot: 'DOT',
  'dogecoin': 'DOGE',
  litecoin: 'LTC',
  'bitcoin-cash': 'BCH'
};

router.get('/', async (req, res) => {
  try {
    const coinParam = (req.query.coin || 'bitcoin').toLowerCase();
    const coinsParam = req.query.coins ? req.query.coins.split(',').map(c => c.trim().toLowerCase()) : null;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const coinsToFetch = coinsParam || [coinParam];
    const cacheKey = `cex_arb:${coinsToFetch.join(',')}:${limit}`;
    
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const results = [];

    // Fetch all coins in parallel
    const promises = coinsToFetch.map(coin => 
      axios.get(`https://api.coingecko.com/api/v3/coins/${coin}/tickers?depth=false&order=volume_desc`, {
        timeout: 10000
      }).catch(err => ({ coin, error: err.message }))
    );

    const responses = await Promise.all(promises);

    for (let i = 0; i < responses.length; i++) {
      const coin = coinsToFetch[i];
      
      if (responses[i].error || !responses[i].data) {
        results.push({
          success: false,
          coin,
          error: responses[i].error || 'No data'
        });
        continue;
      }

      const tickers = responses[i].data.tickers || [];
      const coinTicker = coinTickerMap[coin] || coin.toUpperCase();

      // Filter tickers where base == coin ticker AND target in ['USD','USDT','USDC']
      const filteredTickers = tickers.filter(t => 
        t.base === coinTicker && ['USD', 'USDT', 'USDC'].includes(t.target)
      );

      if (filteredTickers.length === 0) {
        results.push({
          success: false,
          coin,
          error: 'No tickers found for USD/USDT/USDC pairs'
        });
        continue;
      }

      // Build exchange price map
      const exchangePrices = {};
      filteredTickers.forEach(t => {
        if (t.last && t.market && t.market.name) {
          exchangePrices[t.market.name] = {
            price: parseFloat(t.last),
            target_currency: t.target
          };
        }
      });

      if (Object.keys(exchangePrices).length === 0) {
        results.push({
          success: false,
          coin,
          error: 'No valid price data found'
        });
        continue;
      }

      const prices = Object.values(exchangePrices).map(e => e.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const spreadPct = ((maxPrice - minPrice) / minPrice) * 100;
      const spreadUsd = maxPrice - minPrice;

      // Find best buy and sell exchanges
      let bestBuyExchange = null;
      let bestSellExchange = null;
      
      Object.entries(exchangePrices).forEach(([exchange, data]) => {
        if (!bestBuyExchange || data.price < exchangePrices[bestBuyExchange].price) {
          bestBuyExchange = exchange;
        }
        if (!bestSellExchange || data.price > exchangePrices[bestSellExchange].price) {
          bestSellExchange = exchange;
        }
      });

      // Sort exchanges by price descending and take top 15
      const allExchanges = Object.entries(exchangePrices)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.price - a.price)
        .slice(0, 15);

      results.push({
        success: true,
        coin,
        as_of: new Date().toISOString(),
        best_buy: {
          exchange: bestBuyExchange,
          price: exchangePrices[bestBuyExchange].price
        },
        best_sell: {
          exchange: bestSellExchange,
          price: exchangePrices[bestSellExchange].price
        },
        spread_pct: parseFloat(spreadPct.toFixed(4)),
        spread_usd: parseFloat(spreadUsd.toFixed(2)),
        signal: spreadPct > 0.1 ? 'ARBITRAGE' : 'TIGHT',
        all_exchanges: allExchanges,
        source: 'CoinGecko'
      });
    }

    const result = coinsParam ? { success: true, results, source: 'CoinGecko' } : results[0];
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('CEX arbitrage error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
