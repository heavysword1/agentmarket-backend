const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();

const quoteCache = new NodeCache({ stdTTL: 60 });
const indicesCache = new NodeCache({ stdTTL: 300 });
const holdingsCache = new NodeCache({ stdTTL: 86400 });

const SEC_HEADERS = { 'User-Agent': 'AgentMarket market.memoryapi.org contact@memoryapi.org', 'Accept': 'application/json' };

const FRED_SERIES = {
  sp500: 'SP500', vix: 'VIXCLS', nasdaq: 'NASDAQCOM',
  treasury_10y: 'DGS10', oil_wti: 'DCOILWTICO', gold: 'GOLDAMGBD228NLBM', usd_eur: 'DEXUSEU'
};

const TOOLS = [
  {
    name: 'get_stock_quotes',
    description: 'Get real-time stock price quotes for one or more symbols. Returns price, % change, 52-week high/low, exchange, and currency.',
    inputSchema: {
      type: 'object',
      properties: {
        symbols: { type: 'string', description: 'Comma-separated ticker symbols (e.g. AAPL,MSFT,NVDA)', default: 'AAPL,MSFT,NVDA,GOOGL,TSLA' },
        exchange: { type: 'string', description: 'Filter by exchange: NYSE or NASDAQ' }
      }
    }
  },
  {
    name: 'get_market_indices',
    description: 'Get major market indices and macro indicators: S&P 500, NASDAQ, VIX, 10-Year Treasury, WTI Oil, Gold, USD/EUR. Data from FRED (St. Louis Fed).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_institutional_holdings',
    description: 'Get institutional investor 13F SEC filings for a given CIK or institution name. Default is Berkshire Hathaway (CIK 0001067983).',
    inputSchema: {
      type: 'object',
      properties: {
        cik: { type: 'string', description: 'SEC CIK number (e.g. 0001067983 for Berkshire Hathaway)', default: '0001067983' },
        institution: { type: 'string', description: 'Institution name to search for CIK (e.g. "Bridgewater Associates")' }
      }
    }
  }
];

async function fetchFredSeries(seriesId, apiKey) {
  const { data } = await axios.get('https://api.stlouisfed.org/fred/series/observations', {
    params: { series_id: seriesId, api_key: apiKey, file_type: 'json', limit: 5, sort_order: 'desc' },
    timeout: 15000
  });
  const obs = (data.observations || []).find(o => o.value !== '.' && o.value !== '');
  return obs ? { value: parseFloat(obs.value), date: obs.date } : null;
}

async function executeTool(name, args) {
  switch (name) {
    case 'get_stock_quotes': {
      const symbols = args.symbols || 'AAPL,MSFT,NVDA,GOOGL,TSLA';
      const exchange = args.exchange || null;
      const cacheKey = `mcp:quote:${symbols}:${exchange || ''}`;
      const cached = quoteCache.get(cacheKey);
      if (cached) return cached;

      const API_KEY = process.env.TWELVE_DATA_API_KEY;
      const params = { symbol: symbols, apikey: API_KEY };
      if (exchange) params.exchange = exchange;
      const { data } = await axios.get('https://api.twelvedata.com/quote', { params, timeout: 15000 });

      const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
      let quotes;
      if (symbolList.length === 1) {
        const d = data;
        if (d.status === 'error') throw new Error(d.message || 'Twelve Data error');
        quotes = [{ symbol: d.symbol, name: d.name, price: parseFloat(d.close), change_pct: parseFloat(d.percent_change), high_52w: d['52_week'] ? parseFloat(d['52_week'].high) : null, low_52w: d['52_week'] ? parseFloat(d['52_week'].low) : null, exchange: d.exchange, currency: d.currency }];
      } else {
        quotes = symbolList.map(sym => {
          const d = data[sym];
          if (!d || d.status === 'error') return { symbol: sym, error: d?.message || 'Not found' };
          return { symbol: d.symbol, name: d.name, price: parseFloat(d.close), change_pct: parseFloat(d.percent_change), high_52w: d['52_week'] ? parseFloat(d['52_week'].high) : null, low_52w: d['52_week'] ? parseFloat(d['52_week'].low) : null, exchange: d.exchange, currency: d.currency };
        });
      }

      const result = { success: true, count: quotes.length, quotes, as_of: new Date().toISOString(), source: 'Twelve Data' };
      quoteCache.set(cacheKey, result);
      return result;
    }

    case 'get_market_indices': {
      const cacheKey = 'mcp:indices:all';
      const cached = indicesCache.get(cacheKey);
      if (cached) return cached;

      const API_KEY = process.env.FRED_API_KEY;
      const entries = Object.entries(FRED_SERIES);
      const results = await Promise.all(entries.map(([key, id]) =>
        fetchFredSeries(id, API_KEY).then(val => ({ key, val })).catch(() => ({ key, val: null }))
      ));
      const indices = {};
      for (const { key, val } of results) indices[key] = val;
      const result = { success: true, as_of: new Date().toISOString(), indices, source: 'FRED / St. Louis Fed' };
      indicesCache.set(cacheKey, result);
      return result;
    }

    case 'get_institutional_holdings': {
      let cik = args.cik || '0001067983';
      const institution = args.institution || null;
      const cacheKey = `mcp:holdings:${cik}:${institution || ''}`;
      const cached = holdingsCache.get(cacheKey);
      if (cached) return cached;

      if (institution) {
        const { data } = await axios.get(`https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(institution)}%22&dateRange=custom&startdt=2024-01-01&forms=13F-HR`, { headers: SEC_HEADERS, timeout: 15000 });
        const hits = data?.hits?.hits || [];
        if (!hits.length) throw new Error(`No 13F filings found for: ${institution}`);
        cik = (hits[0]._source?.entity_id || hits[0]._source?.file_num || '').toString().replace(/^CIK/, '').replace(/^0+/, '');
        if (!cik) throw new Error('Could not extract CIK from search results');
      }

      const padded = cik.toString().padStart(10, '0');
      const { data: submissions } = await axios.get(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: SEC_HEADERS, timeout: 15000 });
      const filings = submissions?.filings?.recent || {};
      const forms = filings.form || [], dates = filings.filingDate || [], accNums = filings.accessionNumber || [], primaryDocs = filings.primaryDocument || [];
      const thirteenFs = [];
      for (let i = 0; i < forms.length; i++) {
        if (forms[i]?.startsWith('13F-HR')) {
          thirteenFs.push({ form: forms[i], date: dates[i], accessionNumber: accNums[i], primaryDocument: primaryDocs[i] });
          if (thirteenFs.length >= 1) break;
        }
      }
      if (!thirteenFs.length) throw new Error('No 13F-HR filings found for this CIK');
      const latest = thirteenFs[0];
      const accFormatted = latest.accessionNumber.replace(/-/g, '');
      const result = {
        success: true, institution_name: submissions.name || null, cik: cik.replace(/^0+/, ''),
        latest_13f_date: latest.date,
        filing_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=13F&dateb=&owner=include&count=5`,
        filing_doc_url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accFormatted}/${latest.primaryDocument}`,
        accession_number: latest.accessionNumber, source: 'SEC EDGAR Form 13F'
      };
      holdingsCache.set(cacheKey, result);
      return result;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

router.get('/', (req, res) => {
  res.json({ name: 'AgentMarket', version: '1.0.0', transport: 'http', protocol: 'mcp', tools: TOOLS.map(t => t.name) });
});

router.post('/', async (req, res) => {
  const { method, params, id } = req.body;
  try {
    let result;
    switch (method) {
      case 'initialize':
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'AgentMarket', version: '1.0.0' } };
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call': {
        const { name, arguments: args = {} } = params;
        const toolResult = await executeTool(name, args);
        result = { content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }] };
        break;
      }
      default:
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
    }
    res.json({ jsonrpc: '2.0', id, result });
  } catch (err) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
  }
});

module.exports = router;
