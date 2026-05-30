const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 86400 });
const SEC_HEADERS = { 'User-Agent': 'memoryapi.org contact@memoryapi.org' };

let tickerCache = null;

async function getCIK(ticker) {
  if (!tickerCache) {
    const { data } = await axios.get('https://www.sec.gov/files/company_tickers.json', { headers: SEC_HEADERS, timeout: 15000 });
    tickerCache = {};
    Object.values(data).forEach(r => { tickerCache[r.ticker.toUpperCase()] = { cik: r.cik_str, name: r.title }; });
  }
  return tickerCache[ticker.toUpperCase()];
}

function getLatestValue(facts, metric) {
  const unit = facts?.[metric];
  if (!unit) return null;
  const vals = unit?.units ? Object.values(unit.units)[0] : null;
  if (!vals) return null;
  const recent = vals.filter(v => v.form && (v.form.includes('10-K') || v.form.includes('10-Q')))
    .sort((a, b) => new Date(b.end) - new Date(a.end));
  if (!recent.length) return null;
  return { value: recent[0].val, period: recent[0].end, form: recent[0].form };
}

router.get('/', async (req, res) => {
  try {
    let { ticker = 'AAPL' } = req.query;
    ticker = ticker.toUpperCase();
    const cacheKey = `fundamentals:${ticker}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const company = await getCIK(ticker);
    if (!company) return res.status(404).json({ success: false, error: `Company with ticker ${ticker} not found` });

    const cikPadded = String(company.cik).padStart(10, '0');
    const { data: facts } = await axios.get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cikPadded}.json`, { headers: SEC_HEADERS, timeout: 20000 });

    const usgaap = facts.facts?.['us-gaap'] || {};
    const revenue = getLatestValue(usgaap, 'Revenues') || getLatestValue(usgaap, 'RevenueFromContractWithCustomerExcludingAssessedTax') || getLatestValue(usgaap, 'SalesRevenueNet');
    const netIncome = getLatestValue(usgaap, 'NetIncomeLoss');
    const eps = getLatestValue(usgaap, 'EarningsPerShareBasic');
    const assets = getLatestValue(usgaap, 'Assets');
    const liabilities = getLatestValue(usgaap, 'Liabilities');

    const result = {
      success: true, ticker, company_name: company.name, cik: company.cik,
      metrics: {
        revenue: revenue ? { value: revenue.value, period: revenue.period, form: revenue.form } : null,
        net_income: netIncome ? { value: netIncome.value, period: netIncome.period } : null,
        eps: eps ? { value: eps.value, period: eps.period } : null,
        total_assets: assets ? { value: assets.value, period: assets.period } : null,
        total_liabilities: liabilities ? { value: liabilities.value, period: liabilities.period } : null,
        equity: (assets && liabilities) ? { value: assets.value - liabilities.value, period: assets.period } : null
      },
      source: 'SEC EDGAR XBRL',
      disclaimer: 'Information only. Verify on sec.gov before any action.'
    };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
