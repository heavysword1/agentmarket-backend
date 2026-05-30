const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour

router.get('/', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(30, parseInt(req.query.days) || 7));
    const ticker = req.query.ticker ? req.query.ticker.toUpperCase() : null;
    const cacheKey = `earnings:${days}:${ticker || 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Build search query
    let searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22earnings%22&forms=8-K&dateRange=custom&startdt=${startStr}&enddt=${endStr}&hits.hits._source=entity_name,entity_id,file_date,period_of_report`;
    
    if (ticker) {
      searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22%20AND%20%22earnings%22&forms=8-K&dateRange=custom&startdt=${startStr}&enddt=${endStr}&hits.hits._source=entity_name,entity_id,file_date,period_of_report`;
    }

    const searchRes = await axios.get(searchUrl, { timeout: 15000 });
    const hits = searchRes.data?.hits?.hits || [];

    const earnings_reports = hits.slice(0, 50).map(hit => ({
      company: hit._source?.entity_name || 'Unknown',
      cik: hit._source?.entity_id || null,
      filed_date: hit._source?.file_date || null,
      period: hit._source?.period_of_report || null
    })).filter(e => e.cik && e.filed_date);

    const result = {
      success: true,
      period_days: days,
      count: earnings_reports.length,
      earnings_reports,
      source: 'SEC EDGAR 8-K Filings'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Earnings error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
