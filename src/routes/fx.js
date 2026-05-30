const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour

// FRED FX series mapping
const FX_SERIES = {
  'EUR': 'DEXUSEU',  // USD/EUR
  'JPY': 'DEXJPUS',  // JPY/USD
  'GBP': 'DEXUSUK',  // USD/GBP
  'CNY': 'DEXCHUS',  // CNY/USD
  'CAD': 'DEXCAUS',  // CAD/USD
  'CHF': 'DEXSZUS',  // CHF/USD
  'INR': 'DEXINUS',  // INR/USD
  'BRL': 'DEXBZUS',  // BRL/USD
  'KRW': 'DEXKOUS',  // KRW/USD
  'MXN': 'DEXMXUS'   // MXN/USD
};

router.get('/', async (req, res) => {
  try {
    const base = (req.query.base || 'USD').toUpperCase();
    const pairsParam = req.query.pairs || 'EUR,JPY,GBP,CAD,CHF,INR';
    const pairs = pairsParam.split(',').map(p => p.trim().toUpperCase());
    
    if (base !== 'USD') {
      return res.status(400).json({ success: false, error: 'Currently only USD base currency is supported' });
    }

    const cacheKey = `fx:${base}:${pairs.join(',')}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const FRED_API_KEY = process.env.FRED_API_KEY;
    if (!FRED_API_KEY) {
      return res.status(500).json({ success: false, error: 'FRED API key not configured' });
    }

    // Fetch all series in parallel
    const requests = pairs.map(pair => {
      const seriesId = FX_SERIES[pair];
      if (!seriesId) return Promise.resolve(null);
      
      return axios.get(
        `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&limit=10&sort_order=desc`,
        { timeout: 10000 }
      ).then(res => ({ pair, seriesId, data: res.data }))
      .catch(err => ({ pair, seriesId, error: err.message }));
    });

    const responses = await Promise.all(requests);
    
    // Process responses and calculate changes
    const rates = responses
      .filter(r => r && r.data && !r.error)
      .map(r => {
        const observations = r.data.observations || [];
        if (observations.length === 0) return null;
        
        const current = parseFloat(observations[0].value);
        const prev1d = observations.length > 1 ? parseFloat(observations[1].value) : null;
        const prev5d = observations.length > 5 ? parseFloat(observations[5].value) : null;
        
        let change1d = null, change5d = null;
        if (prev1d) change1d = ((current - prev1d) / prev1d * 100).toFixed(3);
        if (prev5d) change5d = ((current - prev5d) / prev5d * 100).toFixed(3);
        
        return {
          pair: `USD/${r.pair}`,
          rate: current,
          change_1d_pct: change1d ? parseFloat(change1d) : null,
          change_5d_pct: change5d ? parseFloat(change5d) : null,
          as_of: observations[0].date
        };
      })
      .filter(r => r !== null);

    const result = {
      success: true,
      base_currency: 'USD',
      as_of: new Date().toISOString(),
      rates,
      source: 'FRED / St. Louis Fed'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('FX error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
