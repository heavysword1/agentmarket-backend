const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const sort = (req.query.sort || 'abs_desc').toLowerCase();

    if (!['rate_desc', 'rate_asc', 'abs_desc'].includes(sort)) {
      return res.status(400).json({ 
        success: false, 
        error: 'sort must be rate_desc, rate_asc, or abs_desc' 
      });
    }

    const cacheKey = `funding:${limit}:${sort}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Fetch from Gate.io
    let allRates = [];
    
    try {
      const gateRes = await axios.get(
        'https://api.gateio.ws/api/v4/futures/usdt/contracts?limit=50&settle=usdt',
        { timeout: 10000 }
      );

      const contracts = gateRes.data || [];
      
      contracts.forEach(contract => {
        if (contract.symbol && contract.funding_rate !== undefined && contract.funding_rate !== null) {
          const fundingRatePct = parseFloat(contract.funding_rate) * 100;
          const annualizedPct = fundingRatePct * 3 * 365; // 3 payments per day * 365 days

          let signal = '';
          if (fundingRatePct > 0) {
            signal = 'BEARISH/SHORT_CROWDED'; // Longs pay shorts
          } else if (fundingRatePct < 0) {
            signal = 'BULLISH/LONG_CROWDED'; // Shorts pay longs
          }

          allRates.push({
            symbol: contract.symbol,
            funding_rate_pct: parseFloat(fundingRatePct.toFixed(4)),
            annualized_pct: parseFloat(annualizedPct.toFixed(2)),
            signal,
            in_delisting: contract.in_delisting || false,
            source: 'Gate.io'
          });
        }
      });
    } catch (gateErr) {
      console.warn('Gate.io fetch failed:', gateErr.message);
    }

    // Try OKX as supplement (currently fetches BTC-USDT-SWAP as example)
    try {
      const okxRes = await axios.get(
        'https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP',
        { timeout: 10000 }
      );

      if (okxRes.data.data && okxRes.data.data.length > 0) {
        const okxData = okxRes.data.data[0];
        if (okxData.fundingRate !== undefined) {
          const fundingRatePct = parseFloat(okxData.fundingRate) * 100;
          const annualizedPct = fundingRatePct * 3 * 365;

          let signal = '';
          if (fundingRatePct > 0) {
            signal = 'BEARISH/SHORT_CROWDED';
          } else if (fundingRatePct < 0) {
            signal = 'BULLISH/LONG_CROWDED';
          }

          // Check if BTC-USDT-SWAP already exists in allRates
          const existingIndex = allRates.findIndex(r => r.symbol === 'BTC-USDT-SWAP');
          if (existingIndex === -1) {
            allRates.push({
              symbol: 'BTC-USDT-SWAP',
              funding_rate_pct: parseFloat(fundingRatePct.toFixed(4)),
              annualized_pct: parseFloat(annualizedPct.toFixed(2)),
              signal,
              source: 'OKX'
            });
          }
        }
      }
    } catch (okxErr) {
      console.warn('OKX fetch failed:', okxErr.message);
    }

    // Sort according to request
    let sortedRates = [...allRates];
    
    if (sort === 'rate_desc') {
      sortedRates.sort((a, b) => b.funding_rate_pct - a.funding_rate_pct);
    } else if (sort === 'rate_asc') {
      sortedRates.sort((a, b) => a.funding_rate_pct - b.funding_rate_pct);
    } else { // abs_desc
      sortedRates.sort((a, b) => Math.abs(b.funding_rate_pct) - Math.abs(a.funding_rate_pct));
    }

    // Extract top positive, top negative, and limited all_rates
    const topPositive = sortedRates.filter(r => r.funding_rate_pct > 0).slice(0, 5);
    const topNegative = sortedRates.filter(r => r.funding_rate_pct < 0).slice(0, 5);
    const allRatesLimited = sortedRates.slice(0, limit);

    const result = {
      success: true,
      as_of: new Date().toISOString(),
      top_positive: topPositive,
      top_negative: topNegative,
      all_rates: allRatesLimited,
      source: 'Gate.io'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Funding rates error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
