const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 300 });

// Helper to extract underlying asset from token name
function parseUnderlyingAsset(name) {
  // "NVIDIA xStock" -> "NVIDIA"
  // "Tesla xStock" -> "Tesla"
  // "Alphabet Class A (Ondo Tokenized Stock)" -> "Alphabet"
  // "Circle Internet Group (Ondo Tokenized Stock)" -> "Circle"
  // "Micron Technology (Ondo Tokenized Stock)" -> "Micron"
  // "Strategy PP Variable xStock" -> "Strategy"
  const match = name.match(/^([^(]+?)(?:\s+(?:xStock|Class|[A-Z])|$)/);
  return match ? match[1].trim() : name;
}

router.get('/', async (req, res) => {
  try {
    const type = (req.query.type || 'stocks').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    // Validate type param
    if (!['stocks', 'rwa', 'all'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'type must be: stocks, rwa, or all'
      });
    }

    const cacheKey = `tokenized:${type}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const requests = [];

    if (type === 'stocks' || type === 'all') {
      requests.push(
        axios.get('https://api.coingecko.com/api/v3/coins/markets', {
          params: {
            vs_currency: 'usd',
            category: 'tokenized-stock',
            order: 'market_cap_desc',
            per_page: 50,
            page: 1,
            sparkline: false
          },
          timeout: 10000
        })
      );
    }

    if (type === 'rwa' || type === 'all') {
      requests.push(
        axios.get('https://api.coingecko.com/api/v3/coins/markets', {
          params: {
            vs_currency: 'usd',
            category: 'real-world-assets-rwa',
            order: 'market_cap_desc',
            per_page: 20,
            page: 1,
            sparkline: false
          },
          timeout: 10000
        })
      );
    }

    const responses = await Promise.all(requests);
    let allCoins = [];

    if (type === 'stocks' || type === 'all') {
      allCoins = allCoins.concat(responses[0].data || []);
    }

    if (type === 'rwa' || type === 'all') {
      allCoins = allCoins.concat(responses[type === 'all' ? 1 : 0].data || []);
    }

    // Remove duplicates by ID and limit
    const uniqueCoins = {};
    allCoins.forEach(coin => {
      if (!uniqueCoins[coin.id]) {
        uniqueCoins[coin.id] = coin;
      }
    });

    const tokens = Object.values(uniqueCoins)
      .slice(0, limit)
      .map(coin => ({
        id: coin.id,
        name: coin.name,
        symbol: coin.symbol?.toUpperCase(),
        underlying_asset: parseUnderlyingAsset(coin.name),
        price_usd: coin.current_price,
        market_cap_usd: coin.market_cap,
        volume_24h_usd: coin.total_volume,
        price_change_24h_pct: coin.price_change_percentage_24h,
        last_updated: coin.last_updated
      }));

    const result = {
      success: true,
      type: type === 'all' ? 'all' : type,
      count: tokens.length,
      tokens,
      source: 'CoinGecko'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Tokenized endpoint error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
