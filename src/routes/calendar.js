const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const NodeCache = require('node-cache');

const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 });

const categoryKeywords = {
  fed: ['FOMC', 'Federal Reserve'],
  inflation: ['CPI', 'PCE', 'Inflation'],
  employment: ['Employment', 'Unemployment', 'Jobs', 'NFP', 'Payroll'],
  gdp: ['GDP', 'Gross Domestic']
};

function categorizeEvent(name) {
  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(kw => name.includes(kw))) {
      return cat;
    }
  }
  return 'other';
}

async function getEconomicCalendar(days = 14, category = 'all') {
  const cacheKey = `calendar:${days}:${category}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const fredKey = process.env.FRED_API_KEY;
    if (!fredKey) throw new Error('FRED_API_KEY not configured');

    const today = new Date().toISOString().split('T')[0];
    const fredUrl = 'https://api.stlouisfed.org/fred/releases/dates' +
      `?api_key=${fredKey}&file_type=json&limit=50&sort_order=asc` +
      `&include_release_dates_with_no_data=true&realtime_start=${today}`;

    const fredRes = await fetch(fredUrl);
    const fredData = await fredRes.json();
    
    if (!fredData.release_dates) {
      throw new Error('FRED API error: ' + (fredData.error_message || 'no data'));
    }

    let events = [];
    for (const release of fredData.releases || []) {
      const releaseCat = categorizeEvent(release.name);
      if (category !== 'all' && releaseCat !== category) continue;
      
      events.push({
        date: release.date || today,
        name: release.name,
        category: releaseCat
      });
    }

    // Limit to recent days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    events = events.filter(e => new Date(e.date) >= cutoff);

    // Fetch sector performance from FMP
    let sectorPerf = [];
    try {
      const fmpKey = process.env.FMP_API_KEY;
      if (fmpKey) {
        const fmpRes = await fetch(
          `https://financialmodelingprep.com/api/v3/sectors-performance?apikey=${fmpKey}`
        );
        const fmpData = await fmpRes.json();
        if (Array.isArray(fmpData)) {
          sectorPerf = fmpData
            .map(s => ({
              sector: s.sector,
              change_pct: parseFloat(s.changesPercentage || s.change_pct || 0)
            }))
            .sort((a, b) => b.change_pct - a.change_pct);
        }
      }
    } catch (err) {
      // Gracefully fall back if FMP fails
      console.log('FMP sector performance unavailable:', err.message);
    }

    const result = {
      success: true,
      period_days: days,
      upcoming_events: events,
      sector_performance: sectorPerf,
      source: 'FRED + FMP'
    };

    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

router.get('/', async (req, res) => {
  const days = req.query.days || 14;
  const category = req.query.category || 'all';
  const result = await getEconomicCalendar(parseInt(days), category);
  res.json(result);
});

module.exports = router;
