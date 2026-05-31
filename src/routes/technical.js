const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const NodeCache = require('node-cache');

const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 });

async function fetchIndicator(symbol, functionName, apikey) {
  const baseUrl = 'https://www.alphavantage.co/query';
  const params = new URLSearchParams({
    function: functionName,
    symbol,
    interval: 'daily',
    time_period: 14,
    series_type: 'close',
    apikey
  });
  
  if (functionName === 'EMA') {
    params.set('time_period', '20');
  }

  const res = await fetch(`${baseUrl}?${params}`);
  return await res.json();
}

function parseIndicator(data, functionName) {
  if (data['Error Message']) throw new Error(data['Error Message']);
  if (data['Information']) throw new Error('API rate limit or error');

  const resultKey = functionName === 'RSI' ? 'Technical Analysis: RSI' :
                    functionName === 'MACD' ? 'Technical Analysis: MACD' :
                    functionName === 'BBANDS' ? 'Technical Analysis: Bollinger Bands' :
                    functionName === 'EMA' ? 'Technical Analysis: EMA' : null;

  if (!resultKey || !data[resultKey]) {
    throw new Error(`No data for ${functionName}`);
  }

  const result = data[resultKey];
  const firstKey = Object.keys(result)[0];
  const latest = result[firstKey];

  return { functionName, latest };
}

async function getTechnicalIndicators(symbol, indicators = 'rsi,macd,bbands,ema') {
  const cacheKey = `technical:${symbol}:${indicators}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const apikey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apikey) throw new Error('ALPHA_VANTAGE_API_KEY not configured');

    const indicatorList = indicators.split(',').map(i => i.trim().toUpperCase());
    const functionMap = {
      RSI: 'RSI',
      MACD: 'MACD',
      BBANDS: 'BBANDS',
      EMA: 'EMA'
    };

    const promises = indicatorList.map(ind => 
      fetchIndicator(symbol, functionMap[ind] || ind, apikey)
        .then(data => parseIndicator(data, functionMap[ind] || ind))
        .catch(err => ({ error: err.message, functionName: ind }))
    );

    const results = await Promise.all(promises);
    const parsed = {};
    const errors = [];

    for (const item of results) {
      if (item.error) {
        errors.push(item.error);
        continue;
      }

      const fname = item.functionName;
      const latest = item.latest;

      if (fname === 'RSI') {
        const rsiVal = parseFloat(latest['RSI'] || latest);
        parsed.rsi = {
          value: rsiVal,
          signal: rsiVal > 70 ? 'OVERBOUGHT' : rsiVal < 30 ? 'OVERSOLD' : 'NEUTRAL'
        };
      } else if (fname === 'MACD') {
        parsed.macd = {
          macd: parseFloat(latest['MACD']),
          signal: parseFloat(latest['MACD_Signal']),
          histogram: parseFloat(latest['MACD_Hist']),
          trend: parseFloat(latest['MACD']) > parseFloat(latest['MACD_Signal']) ? 'BULLISH' : 'BEARISH'
        };
      } else if (fname === 'BBANDS') {
        const upper = parseFloat(latest['Real Upper Band']);
        const middle = parseFloat(latest['Real Middle Band']);
        const lower = parseFloat(latest['Real Lower Band']);
        const pctB = ((middle - lower) / (upper - lower)) * 100;
        parsed.bbands = {
          upper,
          middle,
          lower,
          pct_b: pctB
        };
      } else if (fname === 'EMA') {
        parsed.ema_20 = parseFloat(latest['EMA'] || latest);
      }
    }

    if (errors.length === indicatorList.length) {
      throw new Error(errors[0]);
    }

    const result = {
      success: true,
      symbol,
      as_of: new Date().toISOString(),
      indicators: parsed,
      source: 'Alpha Vantage'
    };

    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    return { success: false, error: err.message, symbol };
  }
}

router.get('/', async (req, res) => {
  const symbol = req.query.symbol || 'AAPL';
  const indicators = req.query.indicators || 'rsi,macd,bbands,ema';
  const result = await getTechnicalIndicators(symbol, indicators);
  res.json(result);
});

module.exports = router;
