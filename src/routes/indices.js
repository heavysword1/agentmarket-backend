const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 300 });

const FRED_SERIES = {
  sp500: 'SP500',
  vix: 'VIXCLS',
  nasdaq: 'NASDAQCOM',
  treasury_10y: 'DGS10',
  oil_wti: 'DCOILWTICO',
  gold: 'GOLDAMGBD228NLBM',
  usd_eur: 'DEXUSEU'
};

async function fetchFredSeries(seriesId, apiKey) {
  const { data } = await axios.get('https://api.stlouisfed.org/fred/series/observations', {
    params: { series_id: seriesId, api_key: apiKey, file_type: 'json', limit: 5, sort_order: 'desc' },
    timeout: 15000
  });
  const obs = (data.observations || []).find(o => o.value !== '.' && o.value !== '');
  return obs ? { value: parseFloat(obs.value), date: obs.date } : null;
}

router.get('/', async (req, res) => {
  try {
    const cacheKey = 'indices:all';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const API_KEY = process.env.FRED_API_KEY;
    const entries = Object.entries(FRED_SERIES);
    const results = await Promise.all(entries.map(([key, id]) =>
      fetchFredSeries(id, API_KEY).then(val => ({ key, val })).catch(err => ({ key, val: null, error: err.message }))
    ));

    const indices = {};
    for (const { key, val } of results) {
      indices[key] = val;
    }

    const result = {
      success: true,
      as_of: new Date().toISOString(),
      indices,
      source: 'FRED / St. Louis Fed'
    };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
