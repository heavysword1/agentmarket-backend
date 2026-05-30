const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 86400 });

// Helper: pad CIK to 10 digits with leading zeros
const padCIK = (cik) => String(cik).padStart(10, '0');

router.get('/', async (req, res) => {
  try {
    const ticker = (req.query.ticker || 'AAPL').toUpperCase();
    const cacheKey = `fundamentals:${ticker}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Step 1: Lookup CIK by ticker
    const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=10-K`;
    const searchRes = await axios.get(searchUrl, { timeout: 15000 });
    
    // Parse the search response to find entityId (CIK)
    let cik;
    if (searchRes.data?.hits?.hits?.length > 0) {
      const firstHit = searchRes.data.hits.hits[0];
      cik = firstHit._source?.entity_id || firstHit.fields?.entity_id?.[0];
    }
    
    if (!cik) {
      return res.status(404).json({ success: false, error: `Company with ticker ${ticker} not found` });
    }

    const paddedCIK = padCIK(cik);

    // Step 2: Fetch company facts from SEC EDGAR XBRL
    const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCIK}.json`;
    const factsRes = await axios.get(factsUrl, { timeout: 15000 });
    const facts = factsRes.data;

    const companyName = facts.entityName || 'Unknown';
    const fiscalYearEnd = facts.facts?.['us-gaap']?.FiscalYearFocus?.[0]?.val || null;

    // Extract financial metrics - find most recent 10-K or 10-Q value
    const getMetricValue = (factObj) => {
      if (!factObj) return null;
      const unitValues = factObj.units?.USD || [];
      const values = unitValues.filter(v => v.form && (v.form.includes('10-K') || v.form.includes('10-Q')));
      if (values.length === 0) return null;
      // Sort by filed date descending and take the most recent
      values.sort((a, b) => new Date(b.filed) - new Date(a.filed));
      return {
        value: values[0].val,
        filed: values[0].filed,
        period: values[0].end,
        form: values[0].form
      };
    };

    const revenue = getMetricValue(facts.facts?.['us-gaap']?.Revenues || facts.facts?.['us-gaap']?.RevenueFromContractWithCustomerExcludingAssessedTax);
    const netIncome = getMetricValue(facts.facts?.['us-gaap']?.NetIncomeLoss);
    const eps = getMetricValue(facts.facts?.['us-gaap']?.EarningsPerShareBasic);
    const assets = getMetricValue(facts.facts?.['us-gaap']?.Assets);
    const liabilities = getMetricValue(facts.facts?.['us-gaap']?.Liabilities);
    
    // Calculate equity = Assets - Liabilities
    let equity = null;
    if (assets && liabilities) {
      equity = {
        value: assets.value - liabilities.value,
        filed: assets.filed,
        period: assets.period
      };
    }

    const result = {
      success: true,
      ticker,
      company_name: companyName,
      cik: cik.toString(),
      fiscal_year_end: fiscalYearEnd,
      metrics: {
        revenue: revenue ? { value: revenue.value, filed: revenue.filed, period: revenue.period, form: revenue.form } : null,
        net_income: netIncome ? { value: netIncome.value, filed: netIncome.filed, period: netIncome.period, form: netIncome.form } : null,
        eps: eps ? { value: eps.value, filed: eps.filed, period: eps.period, form: eps.form } : null,
        total_assets: assets ? { value: assets.value, filed: assets.filed, period: assets.period, form: assets.form } : null,
        total_liabilities: liabilities ? { value: liabilities.value, filed: liabilities.filed, period: liabilities.period, form: liabilities.form } : null,
        equity: equity
      },
      source: 'SEC EDGAR XBRL'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Fundamentals error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
