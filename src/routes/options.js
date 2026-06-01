const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 300 });

router.get('/', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'AAPL';
    const type = req.query.type || 'calls';
    const strikePriceFrom = req.query.strikePriceFrom || '';
    const strikePriceTo = req.query.strikePriceTo || '';
    const nearMoney = req.query.near_money === 'true';

    const cacheKey = `options:${symbol}:${type}:${strikePriceFrom}:${strikePriceTo}:${nearMoney}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const API_KEY = process.env.RAPIDAPI_KEY;
    const API_HOST = 'yahoo-finance15.p.rapidapi.com';

    const params = { type };
    if (strikePriceFrom) params.strikePriceFrom = strikePriceFrom;
    if (strikePriceTo) params.strikePriceTo = strikePriceTo;

    const options = {
      method: 'GET',
      url: `https://yahoo-finance15.p.rapidapi.com/api/v1/markets/options/${symbol}`,
      params,
      headers: {
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': API_HOST
      },
      timeout: 15000
    };

    const { data } = await axios.request(options);

    // Extract current price
    const current_price = data.underlyingPrice || null;
    const expiration_dates = data.expirationDates || [];

    // Extract options from response
    let options_list = [];
    if (data.options && data.options.length > 0) {
      options_list = data.options.map(opt => ({
        strike: opt.strike,
        lastPrice: opt.lastPrice,
        bid: opt.bid,
        ask: opt.ask,
        volume: opt.volume,
        openInterest: opt.openInterest,
        impliedVolatility: opt.impliedVolatility,
        inTheMoney: opt.inTheMoney
      }));

      // Filter for near_money if requested (within 10% of current price)
      if (nearMoney && current_price) {
        const lowerBound = current_price * 0.9;
        const upperBound = current_price * 1.1;
        options_list = options_list.filter(opt => opt.strike >= lowerBound && opt.strike <= upperBound);
      }
    }

    const result = {
      success: true,
      symbol,
      current_price,
      expiration_dates,
      options: options_list,
      source: 'Yahoo Finance'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
