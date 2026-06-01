const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 60 });

router.get('/', async (req, res) => {
  try {
    const symbols = req.query.symbols || 'AAPL,MSFT,NVDA,TSLA,GOOGL,AMZN,META';
    const type = req.query.type || 'quote';
    const cacheKey = `yahoo:${symbols}:${type}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const API_KEY = process.env.RAPIDAPI_KEY;
    const API_HOST = 'yahoo-finance15.p.rapidapi.com';

    const options = {
      method: 'GET',
      url: 'https://yahoo-finance15.p.rapidapi.com/api/v1/markets/stock/quotes',
      params: {
        ticker: symbols,
        type: type
      },
      headers: {
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': API_HOST
      },
      timeout: 15000
    };

    const { data } = await axios.request(options);

    // Extract quotes from response body array
    const quotes = (data.body || []).map(item => ({
      symbol: item.symbol,
      regularMarketPrice: item.regularMarketPrice,
      regularMarketChange: item.regularMarketChange,
      regularMarketChangePercent: item.regularMarketChangePercent,
      regularMarketVolume: item.regularMarketVolume,
      marketCap: item.marketCap,
      trailingPE: item.trailingPE,
      fiftyTwoWeekHigh: item.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: item.fiftyTwoWeekLow,
      bid: item.bid,
      ask: item.ask,
      postMarketPrice: item.postMarketPrice
    }));

    const result = {
      success: true,
      count: quotes.length,
      quotes,
      source: 'Yahoo Finance'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
