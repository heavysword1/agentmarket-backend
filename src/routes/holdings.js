const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const cache = new NodeCache({ stdTTL: 86400 });

const SEC_HEADERS = { 'User-Agent': 'AgentMarket market.memoryapi.org contact@memoryapi.org', 'Accept': 'application/json' };

async function getCikForInstitution(name) {
  const { data } = await axios.get(`https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(name)}%22&dateRange=custom&startdt=2024-01-01&forms=13F-HR`, {
    headers: SEC_HEADERS, timeout: 15000
  });
  const hits = data?.hits?.hits || [];
  if (!hits.length) throw new Error(`No 13F filings found for institution: ${name}`);
  const cik = hits[0]._source?.entity_id || hits[0]._source?.file_num;
  if (!cik) throw new Error('Could not extract CIK from search results');
  return cik.toString().replace(/^CIK/, '').replace(/^0+/, '');
}

async function getSubmissions(cik) {
  const padded = cik.toString().padStart(10, '0');
  const { data } = await axios.get(`https://data.sec.gov/submissions/CIK${padded}.json`, {
    headers: SEC_HEADERS, timeout: 15000
  });
  return data;
}

router.get('/', async (req, res) => {
  try {
    let cik = req.query.cik || '0001067983';
    const institution = req.query.institution || null;
    const limit = parseInt(req.query.limit) || 1;

    if (institution) {
      cik = await getCikForInstitution(institution);
    }

    const cacheKey = `holdings:${cik}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const submissions = await getSubmissions(cik);
    const filings = submissions?.filings?.recent || {};
    const forms = filings.form || [];
    const dates = filings.filingDate || [];
    const accNums = filings.accessionNumber || [];
    const primaryDocs = filings.primaryDocument || [];

    // Find 13F filings
    const thirteenFs = [];
    for (let i = 0; i < forms.length; i++) {
      if (forms[i] && (forms[i].startsWith('13F-HR') || forms[i] === '13F-HR')) {
        thirteenFs.push({ form: forms[i], date: dates[i], accessionNumber: accNums[i], primaryDocument: primaryDocs[i] });
        if (thirteenFs.length >= limit) break;
      }
    }

    if (!thirteenFs.length) {
      return res.json({ success: false, error: 'No 13F-HR filings found for this CIK', cik });
    }

    const latest = thirteenFs[0];
    const accFormatted = latest.accessionNumber.replace(/-/g, '');
    const filing_url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=13F&dateb=&owner=include&count=5`;
    const filing_doc_url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accFormatted}/${latest.primaryDocument}`;

    const result = {
      success: true,
      institution_name: submissions.name || null,
      cik: cik.replace(/^0+/, ''),
      latest_13f_date: latest.date,
      filing_url,
      filing_doc_url,
      accession_number: latest.accessionNumber,
      source: 'SEC EDGAR Form 13F'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
