const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes

const STABLECOINS = [
  'usd-coin',
  'tether',
  'dai',
  'frax',
  'true-usd',
  'usdd',
  'paypal-usd',
  'first-digital-usd',
  'ethena-usde',
  'mountain-protocol-usdm'
];

const STABLECOIN_SYMBOLS = {
  'usd-coin': 'USDC',
  'tether': 'USDT',
  'dai': 'DAI',
  'frax': 'FRAX',
  'true-usd': 'TUSD',
  'usdd': 'USDD',
  'paypal-usd': 'PYUSD',
  'first-digital-usd': 'FDUSD',
  'ethena-usde': 'USDe',
  'mountain-protocol-usdm': 'USDm'
};

router.get('/', async (req, res) => {
  try {
    const cacheKey = 'stablecoins:peg';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const idsQuery = STABLECOINS.join(',');
    const priceRes = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${idsQuery}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
      { timeout: 10000 }
    );

    const priceData = priceRes.data;
    const stablecoins = [];
    let alertCount = 0;

    STABLECOINS.forEach(coinId => {
      const data = priceData[coinId];
      if (!data) return;

      const priceUsd = data.usd || 1.0;
      const pegDeviationPct = (priceUsd - 1.0) * 100;
      const change24hPct = data.usd_24h_change || 0;
      const marketCapUsd = data.usd_market_cap || 0;

      let status;
      if (Math.abs(pegDeviationPct) > 0.1) {
        status = 'DE_PEGGED';
        alertCount++;
      } else if (Math.abs(pegDeviationPct) > 0.05) {
        status = 'WATCH';
      } else {
        status = 'STABLE';
      }

      stablecoins.push({
        symbol: STABLECOIN_SYMBOLS[coinId] || coinId,
        price_usd: parseFloat(priceUsd.toFixed(6)),
        peg_deviation_pct: parseFloat(pegDeviationPct.toFixed(4)),
        status,
        change_24h_pct: parseFloat(change24hPct.toFixed(2)),
        market_cap_usd: Math.round(marketCapUsd)
      });
    });

    // Sort by absolute peg deviation descending
    stablecoins.sort((a, b) => Math.abs(b.peg_deviation_pct) - Math.abs(a.peg_deviation_pct));

    const result = {
      success: true,
      as_of: new Date().toISOString(),
      alert_count: alertCount,
      stablecoins,
      source: 'CoinGecko'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Stablecoins error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
