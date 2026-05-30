const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 1800 }); // 30 minutes

router.get('/', async (req, res) => {
  try {
    const type = (req.query.type || 'both').toLowerCase();
    if (!['crypto', 'market', 'both'].includes(type)) {
      return res.status(400).json({ success: false, error: 'type must be crypto, market, or both' });
    }

    const cacheKey = `sentiment:${type}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const result = {
      success: true,
      source: 'Alternative.me (Crypto F&G) / FRED (Market VIX)'
    };

    // Get crypto Fear & Greed from alternative.me
    if (type === 'crypto' || type === 'both') {
      const fngRes = await axios.get('https://api.alternative.me/fng/?limit=7&format=json', { timeout: 10000 });
      const fngData = fngRes.data.data || [];
      
      if (fngData.length > 0) {
        const current = fngData[0];
        const history = fngData.map(d => ({
          value: parseInt(d.value),
          label: d.value_classification,
          timestamp: new Date(parseInt(d.timestamp) * 1000).toISOString()
        }));
        
        result.crypto_fear_greed = {
          value: parseInt(current.value),
          label: current.value_classification,
          timestamp: new Date(parseInt(current.timestamp) * 1000).toISOString(),
          history
        };
      }
    }

    // Get VIX from FRED for traditional market
    if (type === 'market' || type === 'both') {
      const FRED_API_KEY = process.env.FRED_API_KEY;
      if (!FRED_API_KEY) {
        result.market_vix = { error: 'FRED API key not configured' };
      } else {
        const vixRes = await axios.get(
          `https://api.stlouisfed.org/fred/series/observations?series_id=VIXCLS&api_key=${FRED_API_KEY}&file_type=json&limit=1&sort_order=desc`,
          { timeout: 10000 }
        );
        
        const observations = vixRes.data.observations || [];
        if (observations.length > 0) {
          const latest = observations[0];
          const vixValue = parseFloat(latest.value);
          let label, interpretation;
          
          if (vixValue < 15) {
            label = 'Greed';
            interpretation = 'Low volatility, market overconfidence';
          } else if (vixValue < 25) {
            label = 'Neutral';
            interpretation = 'Normal market volatility';
          } else {
            label = 'Fear';
            interpretation = 'High volatility, market stress';
          }
          
          result.market_vix = {
            value: vixValue,
            label,
            interpretation,
            date: latest.date
          };
        }
      }
    }

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Sentiment error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
