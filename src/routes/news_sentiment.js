const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const NodeCache = require('node-cache');

const router = express.Router();
const cache = new NodeCache({ stdTTL: 1800 });

async function getNewsSentiment(symbols = 'AAPL,MSFT,NVDA', limit = 10, sentiment = 'all') {
  const cacheKey = `news:${symbols}:${limit}:${sentiment}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const token = process.env.MARKETAUX_API_KEY;
    if (!token) throw new Error('MARKETAUX_API_KEY not configured');

    // Clamp limit to 25
    const safeLimit = Math.min(parseInt(limit), 25);
    
    const newsUrl = 'https://api.marketaux.com/v1/news/all' +
      `?symbols=${symbols}&api_token=${token}&limit=${safeLimit}` +
      '&language=en&filter_entities=true&must_have_entities=true';

    const newsRes = await fetch(newsUrl);
    const newsData = await newsRes.json();

    if (!newsData.data || !Array.isArray(newsData.data)) {
      throw new Error('Marketaux API error: ' + (newsData.error || 'invalid response'));
    }

    const articles = [];
    const bySymbol = {};
    const symbolList = symbols.split(',').map(s => s.trim());

    for (const article of newsData.data) {
      const title = article.title;
      const url = article.url;
      const published = article.published_at;
      const source = article.source;
      
      let sentimentScore = 0;
      const entitySentiments = [];
      
      if (article.entities && article.entities.length > 0) {
        sentimentScore = article.entities[0].sentiment_score || 0;
        for (const entity of article.entities) {
          if (entity.ticker) {
            entitySentiments.push({
              name: entity.name,
              ticker: entity.ticker,
              sentiment: entity.sentiment
            });
            
            if (!bySymbol[entity.ticker]) {
              bySymbol[entity.ticker] = {
                sentiments: [],
                articles: 0
              };
            }
            bySymbol[entity.ticker].sentiments.push(sentimentScore);
            bySymbol[entity.ticker].articles += 1;
          }
        }
      }

      articles.push({
        title,
        url,
        published,
        source,
        sentiment_score: sentimentScore,
        tickers: entitySentiments.map(e => e.ticker)
      });
    }

    const by_symbol = [];
    for (const sym of symbolList) {
      if (bySymbol[sym]) {
        const sentiments = bySymbol[sym].sentiments;
        const avgSent = sentiments.length > 0 
          ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length 
          : 0;
        
        let sentLabel = 'NEUTRAL';
        if (avgSent > 0.1) sentLabel = 'BULLISH';
        else if (avgSent < -0.1) sentLabel = 'BEARISH';

        by_symbol.push({
          symbol: sym,
          avg_sentiment: avgSent,
          article_count: bySymbol[sym].articles,
          sentiment_label: sentLabel
        });
      }
    }

    const result = {
      success: true,
      symbols,
      article_count: articles.length,
      by_symbol,
      articles,
      source: 'Marketaux'
    };

    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

router.get('/', async (req, res) => {
  const symbols = req.query.symbols || 'AAPL,MSFT,NVDA';
  const limit = req.query.limit || 10;
  const sentiment = req.query.sentiment || 'all';
  const result = await getNewsSentiment(symbols, limit, sentiment);
  res.json(result);
});

module.exports = router;
