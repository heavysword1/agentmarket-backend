const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 60 });

router.get('/', async (req, res) => {
  try {
    const symbols = req.query.symbols || 'AAPL,MSFT,NVDA,GOOGL,TSLA';
    const exchange = req.query.exchange || null;
    const cacheKey = `quote:${symbols}:${exchange || ''}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const API_KEY = process.env.TWELVE_DATA_API_KEY;
    const params = { symbol: symbols, apikey: API_KEY };
    if (exchange) params.exchange = exchange;

    const { data } = await axios.get('https://api.twelvedata.com/quote', { params, timeout: 15000 });

    // If single symbol, data is an object; if multiple, data is a map
    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
    let quotes;

    if (symbolList.length === 1) {
      const d = data;
      if (d.status === 'error') throw new Error(d.message || 'Twelve Data error');
      quotes = [{
        symbol: d.symbol,
        name: d.name,
        price: parseFloat(d.close),
        change_pct: parseFloat(d.percent_change),
        high_52w: d['52_week'] ? parseFloat(d['52_week'].high) : null,
        low_52w: d['52_week'] ? parseFloat(d['52_week'].low) : null,
        exchange: d.exchange,
        currency: d.currency
      }];
    } else {
      quotes = symbolList.map(sym => {
        const d = data[sym];
        if (!d || d.status === 'error') return { symbol: sym, error: d?.message || 'Not found' };
        return {
          symbol: d.symbol,
          name: d.name,
          price: parseFloat(d.close),
          change_pct: parseFloat(d.percent_change),
          high_52w: d['52_week'] ? parseFloat(d['52_week'].high) : null,
          low_52w: d['52_week'] ? parseFloat(d['52_week'].low) : null,
          exchange: d.exchange,
          currency: d.currency
        };
      });
    }

    const result = {
      success: true,
      count: quotes.length,
      quotes,
      as_of: new Date().toISOString(),
      source: 'Twelve Data'
    };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
