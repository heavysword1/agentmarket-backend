const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 300 });

// Predefined pre-IPO token mappings
const KNOWN_PREIPO_IDS = {
  spacex: 'spacex-republic-pre-ipo',
  openai: 'openai-republic-pre-ipo',
  stripe: 'stripe-republic-pre-ipo',
  anthropic: 'anthropic-pre-ipo'
};

router.get('/', async (req, res) => {
  try {
    const company = (req.query.company || 'all').toLowerCase();
    const limit = parseInt(req.query.limit) || 10;
    const cacheKey = `preipo:${company}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    let tokenIds = [];

    if (company === 'all') {
      // Search for both "pre-ipo" and "republic" tokens on CoinGecko
      try {
        const [searchPreIpo, searchRepublic] = await Promise.all([
          axios.get('https://api.coingecko.com/api/v3/search', {
            params: { query: 'pre-ipo' },
            timeout: 10000
          }),
          axios.get('https://api.coingecko.com/api/v3/search', {
            params: { query: 'republic' },
            timeout: 10000
          })
        ]);

        const preIpoCoins = (searchPreIpo.data?.coins || []).slice(0, limit);
        const republicCoins = (searchRepublic.data?.coins || []).slice(0, limit);

        // Deduplicate by ID
        const combined = {};
        preIpoCoins.concat(republicCoins).forEach(coin => {
          if (!combined[coin.id]) {
            combined[coin.id] = coin.id;
          }
        });

        tokenIds = Object.values(combined).slice(0, limit);
      } catch (searchErr) {
        console.warn('Search failed, falling back to known IDs:', searchErr.message);
        tokenIds = Object.values(KNOWN_PREIPO_IDS);
      }
    } else if (KNOWN_PREIPO_IDS[company]) {
      tokenIds = [KNOWN_PREIPO_IDS[company]];
    } else {
      return res.status(400).json({
        success: false,
        error: `Unknown company: ${company}. Supported: spacex, openai, stripe, anthropic, all`
      });
    }

    if (tokenIds.length === 0) {
      return res.json({
        success: true,
        count: 0,
        tokens: [],
        note: 'These are speculative pre-IPO tokens, not actual equity',
        source: 'CoinGecko'
      });
    }

    // Fetch market data for identified tokens
    const idsParam = tokenIds.join(',');
    const { data } = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        ids: idsParam,
        order: 'market_cap_desc',
        per_page: limit,
        page: 1,
        sparkline: false
      },
      timeout: 10000
    });

    const tokens = (data || []).map(coin => ({
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol?.toUpperCase(),
      price_usd: coin.current_price,
      market_cap_usd: coin.market_cap,
      price_change_24h_pct: coin.price_change_percentage_24h,
      high_24h: coin.high_24h,
      low_24h: coin.low_24h,
      total_volume_usd: coin.total_volume,
      last_updated: coin.last_updated
    }));

    const result = {
      success: true,
      count: tokens.length,
      tokens,
      note: 'These are speculative pre-IPO tokens, not actual equity',
      source: 'CoinGecko'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Pre-IPO endpoint error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
