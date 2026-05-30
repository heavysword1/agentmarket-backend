require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const express = require('express');
const cors = require('cors');
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { bazaarResourceServerExtension } = require('@x402/extensions');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
const { HTTPFacilitatorClient } = require('@x402/core/server');

const quoteRouter = require('./routes/quote');
const indicesRouter = require('./routes/indices');
const holdingsRouter = require('./routes/holdings');
const fundamentalsRouter = require('./routes/fundamentals');
const sentimentRouter = require('./routes/sentiment');
const earningsRouter = require('./routes/earnings');
const fxRouter = require('./routes/fx');
const preipoRouter = require('./routes/preipo');
const mcpRouter = require('./routes/mcp');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3026;
const PAY_TO = process.env.PAY_TO_ADDRESS || '0x24FAcafEB49b4e3FACF0B3e69604A2F4640c9bf2';
const X402_NETWORK = process.env.X402_NETWORK || 'eip155:8453';
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://x402.org/facilitator';

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'agentmarket', port: PORT }));
app.get('/openapi.json', (req, res) => res.sendFile(require('path').join(__dirname, 'openapi.json')));

app.get('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({ resource: 'https://market.memoryapi.org/mcp', authorization_servers: [], bearer_methods_supported: [], resource_documentation: 'https://memoryapi.org' });
});
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.status(404).json({ error: 'No OAuth required.' });
});

app.use('/mcp', mcpRouter);

try {
  const { createFacilitatorConfig } = require('@coinbase/x402');
  const rawConfig = createFacilitatorConfig(process.env.CDP_API_KEY_NAME, process.env.CDP_API_KEY_PRIVATE_KEY);
  const facilitatorClient = new HTTPFacilitatorClient({ url: rawConfig.url, createAuthHeaders: rawConfig.createAuthHeaders });
  const x402Server = new x402ResourceServer(facilitatorClient)
    .register(X402_NETWORK, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  app.use(paymentMiddleware(
    {
      'GET /x402/market/quote': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Real-time stock price quotes for one or more ticker symbols. Returns price, % change, 52-week high/low, exchange, and currency.',
        extensions: { bazaar: { info: {
          description: 'Real-time stock quotes from Twelve Data. Get price, % change, 52-week high/low for any US-listed stock.',
          input: { type: 'http', method: 'GET',
            queryParams: { symbols: 'AAPL,MSFT,NVDA', exchange: 'NASDAQ' },
            schema: { properties: {
              symbols: { type: 'string', description: 'Comma-separated ticker symbols (default: AAPL,MSFT,NVDA,GOOGL,TSLA)' },
              exchange: { type: 'string', description: 'Filter by exchange: NYSE or NASDAQ' }
            }, required: [] }
          },
          output: { example: { success: true, count: 3, quotes: [{ symbol: 'AAPL', name: 'Apple Inc', price: 189.3, change_pct: 1.25, high_52w: 199.62, low_52w: 164.08, exchange: 'NASDAQ', currency: 'USD' }], as_of: '2025-01-01T00:00:00.000Z', source: 'Twelve Data' } }
        }}}
      },

      'GET /x402/market/indices': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Major market indices and macro indicators: S&P 500, NASDAQ, VIX, 10-Year Treasury, WTI Oil, Gold, USD/EUR from FRED.',
        extensions: { bazaar: { info: {
          description: 'Market indices and macro indicators from FRED (St. Louis Fed). Covers S&P 500, NASDAQ, VIX volatility index, 10Y Treasury rate, WTI crude oil, gold price, and USD/EUR exchange rate.',
          input: { type: 'http', method: 'GET', queryParams: {}, schema: { properties: {}, required: [] } },
          output: { example: { success: true, as_of: '2025-01-01T00:00:00.000Z', indices: { sp500: { value: 5893.62, date: '2025-01-02' }, vix: { value: 16.13, date: '2025-01-02' }, nasdaq: { value: 19310.79, date: '2025-01-02' }, treasury_10y: { value: 4.57, date: '2025-01-02' }, oil_wti: { value: 73.96, date: '2025-01-02' }, gold: { value: 2654.8, date: '2025-01-02' }, usd_eur: { value: 1.0344, date: '2025-01-02' } }, source: 'FRED / St. Louis Fed' } }
        }}}
      },

      'GET /x402/market/holdings': {
        accepts: [{ scheme: 'exact', price: '$0.005', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Institutional investor SEC Form 13F filings. Look up any institution by CIK or name to get their latest 13F filing date and link.',
        extensions: { bazaar: { info: {
          description: 'SEC EDGAR Form 13F institutional holdings data. Query by CIK number or institution name. Default is Berkshire Hathaway.',
          input: { type: 'http', method: 'GET',
            queryParams: { cik: '0001067983' },
            schema: { properties: {
              cik: { type: 'string', description: 'SEC CIK number (default: 0001067983 for Berkshire Hathaway)' },
              institution: { type: 'string', description: 'Institution name to search (e.g. "Bridgewater Associates")' }
            }, required: [] }
          },
          output: { example: { success: true, institution_name: 'BERKSHIRE HATHAWAY INC', cik: '1067983', latest_13f_date: '2024-11-14', filing_url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001067983&type=13F', source: 'SEC EDGAR Form 13F' } }
        }}}
      },

      'GET /x402/market/fundamentals': {
        accepts: [{ scheme: 'exact', price: '$0.005', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Company fundamentals from SEC EDGAR XBRL filings. Revenue, net income, EPS, assets, liabilities, and equity for any publicly-traded company.',
        extensions: { bazaar: { info: {
          description: 'SEC EDGAR XBRL company fundamentals. Extracts revenue, net income, EPS, total assets, total liabilities, and equity from the latest 10-K or 10-Q filing.',
          input: { type: 'http', method: 'GET',
            queryParams: { ticker: 'AAPL' },
            schema: { properties: {
              ticker: { type: 'string', description: 'Stock ticker symbol (default: AAPL)' }
            }, required: [] }
          },
          output: { example: { success: true, ticker: 'AAPL', company_name: 'APPLE INC', cik: '320193', fiscal_year_end: 2024, metrics: { revenue: { value: 383285000000, filed: '2024-10-31', period: '2024-09-28', form: '10-K' }, net_income: { value: 93736000000, filed: '2024-10-31', period: '2024-09-28', form: '10-K' }, eps: { value: 6.05, filed: '2024-10-31', period: '2024-09-28', form: '10-K' }, total_assets: { value: 352755000000, filed: '2024-10-31', period: '2024-09-28', form: '10-K' }, total_liabilities: { value: 120386000000, filed: '2024-10-31', period: '2024-09-28', form: '10-K' }, equity: { value: 232369000000, filed: '2024-10-31', period: '2024-09-28' } }, source: 'SEC EDGAR XBRL' } }
        }}}
      },

      'GET /x402/market/sentiment': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Market sentiment indicators: crypto Fear & Greed Index and traditional market VIX volatility.',
        extensions: { bazaar: { info: {
          description: 'Market fear and greed sentiment. Crypto F&G from alternative.me (0-100 scale), traditional market VIX from FRED (volatility index).',
          input: { type: 'http', method: 'GET',
            queryParams: { type: 'both' },
            schema: { properties: {
              type: { type: 'string', description: 'Sentiment type: crypto, market, or both (default: both)' }
            }, required: [] }
          },
          output: { example: { success: true, crypto_fear_greed: { value: 72, label: 'Greed', timestamp: '2025-01-02T18:00:00.000Z', history: [{ value: 72, label: 'Greed', timestamp: '2025-01-02T18:00:00.000Z' }] }, market_vix: { value: 16.13, label: 'Neutral', interpretation: 'Normal market volatility', date: '2025-01-02' }, source: 'Alternative.me (Crypto F&G) / FRED (Market VIX)' } }
        }}}
      },

      'GET /x402/market/earnings': {
        accepts: [{ scheme: 'exact', price: '$0.005', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Recent earnings announcements from SEC EDGAR Form 8-K filings. Search by company or get all earnings in past N days.',
        extensions: { bazaar: { info: {
          description: 'SEC EDGAR Form 8-K earnings announcements. Default shows earnings from the past 7 days. Filter by ticker for specific company.',
          input: { type: 'http', method: 'GET',
            queryParams: { days: '7', ticker: '' },
            schema: { properties: {
              days: { type: 'integer', description: 'Lookback days (1-30, default: 7)' },
              ticker: { type: 'string', description: 'Optional: filter by ticker (e.g. AAPL)' }
            }, required: [] }
          },
          output: { example: { success: true, period_days: 7, count: 42, earnings_reports: [{ company: 'APPLE INC', cik: '320193', filed_date: '2024-10-31', period: '2024-09-28' }], source: 'SEC EDGAR 8-K Filings' } }
        }}}
      },

      'GET /x402/market/preipo': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Pre-IPO and private company token prices — SpaceX, OpenAI, and other unicorns trading as tokenized assets via CoinGecko.',
        extensions: { bazaar: { info: {
          description: 'Pre-IPO token prices for private unicorn companies (SpaceX, OpenAI, etc.) trading as synthetic crypto assets.',
          input: { type: 'http', method: 'GET', queryParams: { company: 'all', limit: '10' },
            schema: { properties: { company: { type: 'string', description: 'spacex|openai|all' }, limit: { type: 'string' } }, required: [] } },
          output: { example: { success: true, tokens: [{ name: 'SpaceX (Republic Pre-IPO)', price_usd: 892.29, price_change_24h_pct: 0.5 }] } }
        }}}
      },

      'GET /x402/market/fx': {
        accepts: [{ scheme: 'exact', price: '$0.001', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'Currency exchange rates USD vs major currencies. Historical rates from FRED (St. Louis Federal Reserve).',
        extensions: { bazaar: { info: {
          description: 'Foreign exchange rates (USD base). Includes 1-day and 5-day percent changes for major currency pairs (EUR, JPY, GBP, CAD, CHF, INR, BRL, KRW, MXN).',
          input: { type: 'http', method: 'GET',
            queryParams: { base: 'USD', pairs: 'EUR,JPY,GBP,CAD,CHF' },
            schema: { properties: {
              base: { type: 'string', description: 'Base currency (currently only USD supported)' },
              pairs: { type: 'string', description: 'Comma-separated currency codes (default: EUR,JPY,GBP,CAD,CHF,INR)' }
            }, required: [] }
          },
          output: { example: { success: true, base_currency: 'USD', as_of: '2025-01-02T18:00:00.000Z', rates: [{ pair: 'USD/EUR', rate: 1.0344, change_1d_pct: 0.125, change_5d_pct: -0.456, as_of: '2025-01-02' }], source: 'FRED / St. Louis Fed' } }
        }}}
      }
    },
    x402Server,
    { afterSettle: (req, res, next, s) => { const e = s?.extensionResponses; if (e) console.log('[CDP] EXTENSION-RESPONSES:', JSON.stringify(e)); next(); } },
    null, true
  ));

  console.log('✅ x402 payment middleware registered');
} catch (err) {
  console.warn('⚠️  x402 middleware skipped:', err.message);
}

app.use('/x402/market/quote', quoteRouter);
app.use('/x402/market/indices', indicesRouter);
app.use('/x402/market/holdings', holdingsRouter);
app.use('/x402/market/fundamentals', fundamentalsRouter);
app.use('/x402/market/sentiment', sentimentRouter);
app.use('/x402/market/earnings', earningsRouter);
app.use('/x402/market/preipo', preipoRouter);
app.use('/x402/market/fx', fxRouter);

app.listen(PORT, () => console.log(`AgentMarket running on port ${PORT}`));
