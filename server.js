import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import translate from "@iamtraction/google-translate";
import cheerio from "cheerio";

const app = express();
const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['description', 'description'],
      ['content:encoded', 'contentEncoded']
    ]
  }
});

app.set("view engine", "ejs");
app.use(express.static("public"));

// Enhanced translation cache with expiration
const translationCache = {};
const CACHE_EXPIRY = 30 * 60 * 1000; // 30 minutes

async function translateToSwahili(text) {
  if (!text || text.trim() === "") return "";
  
  const now = Date.now();
  if (translationCache[text] && (now - translationCache[text].timestamp) < CACHE_EXPIRY) {
    return translationCache[text].translation;
  }

  try {
    const cleanText = text.replace(/[^\w\s.,!?;:'"-]/gi, '').trim();
    if (!cleanText) return "";
    
    const res = await translate(cleanText, { to: "sw" });
    const translation = res.text;
    
    translationCache[text] = { translation, timestamp: now };
    
    return translation;
  } catch (error) {
    console.error("Translation error:", error.message, "| Text:", text);
    return text;
  }
}

function isSwahili(text) {
  if (!text) return false;
  
  const swahiliIndicators = ['ya','wa','za','ku','na','ni','kwa','haya','hii','hili','hivi','mimi','wewe','yeye','sisi','nyinyi','wao','huko','hapa','pale','lakini','au','ama','basi','bila','kama','kwenye','katika','kutoka'];
  
  const words = text.toLowerCase().split(/\s+/);
  let count = 0;
  for (const word of words) {
    if (swahiliIndicators.includes(word)) count++;
    if (count >= 2) return true;
  }
  return false;
}

function stripHTML(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>?/gm, "");
}

async function fetchFeed(url) {
  try {
    console.log(`Fetching feed from: ${url}`);
    const res = await axios.get(url, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/xml, text/xml, */*"
      },
      timeout: 20000
    });
    return await parser.parseString(res.data);
  } catch (err) {
    console.error("Feed fetch error:", err.message, "| URL:", url);
    return { items: [], title: url, failed: true };
  }
}

// Fixed Tanzania news scraping function
async function scrapeTanzaniaNews() {
  try {
    console.log("Scraping Tanzania news from The Citizen...");
    const { data } = await axios.get('https://www.thecitizen.co.tz', {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(data);
    const articles = [];
    
    // Try different selectors for news headlines
    const selectors = [
      'h1', 'h2', 'h3', '.headline', '.title', '.news-title', 'a[href*="/news/"]',
      '.article-title', '.post-title', '.entry-title'
    ];
    
    $(selectors.join(', ')).each((i, el) => {
      const title = $(el).text().trim();
      if (title && title.length > 10 && title.length < 200 && 
          !title.includes('ADVERTISEMENT') && !title.match(/^\d+$/) &&
          !$(el).closest('footer').length && !$(el).closest('header').length) {
        
        let url = $(el).is('a') ? $(el).attr('href') : $(el).closest('a').attr('href');
        const fullUrl = url ? 
          (url.startsWith('http') ? url : `https://www.thecitizen.co.tz${url.startsWith('/') ? url : '/' + url}`) : 
          'https://www.thecitizen.co.tz';
        
        articles.push({
          title,
          link: fullUrl,
          pubDate: new Date().toISOString(),
          source: "The Citizen Tanzania",
          category: "tanzania",
          needsTranslation: !isSwahili(title)
        });
      }
    });
    
    // Remove duplicates by title
    const uniqueArticles = articles.filter((article, index, self) =>
      index === self.findIndex(a => a.title === article.title)
    );
    
    return uniqueArticles.slice(0, 5);
  } catch (err) {
    console.error("Tanzania scraping error:", err.message);
    return [];
  }
}

// Implement East Africa news scraping
async function scrapeEastAfricaNews() {
  try {
    console.log("Scraping East Africa news from The East African...");
    const { data } = await axios.get('https://www.theeastafrican.co.ke', {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(data);
    const articles = [];
    
    const selectors = [
      'h1', 'h2', 'h3', '.headline', '.title', '.news-title', 'a[href*="/news/"]',
      '.article-title', '.post-title', '.entry-title'
    ];
    
    $(selectors.join(', ')).each((i, el) => {
      const title = $(el).text().trim();
      if (title && title.length > 10 && title.length < 200 && 
          !title.includes('ADVERTISEMENT') && !title.match(/^\d+$/) &&
          !$(el).closest('footer').length && !$(el).closest('header').length) {
        
        let url = $(el).is('a') ? $(el).attr('href') : $(el).closest('a').attr('href');
        const fullUrl = url ? 
          (url.startsWith('http') ? url : `https://www.theeastafrican.co.ke${url.startsWith('/') ? url : '/' + url}`) : 
          'https://www.theeastafrican.co.ke';
        
        articles.push({
          title,
          link: fullUrl,
          pubDate: new Date().toISOString(),
          source: "The East African",
          category: "eastAfrica",
          needsTranslation: !isSwahili(title)
        });
      }
    });
    
    const uniqueArticles = articles.filter((article, index, self) =>
      index === self.findIndex(a => a.title === article.title)
    );
    
    return uniqueArticles.slice(0, 5);
  } catch (err) {
    console.error("East Africa scraping error:", err.message);
    return [];
  }
}

// Implement ESPN news scraping
async function scrapeESPNNews() {
  try {
    console.log("Scraping ESPN news...");
    const { data } = await axios.get('https://www.espn.com', {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(data);
    const articles = [];
    
    const selectors = [
      'h1', 'h2', 'h3', '.headline', '.title', '.news-title', 'a[href*="/story/"]',
      '.article-title', '.post-title', '.entry-title'
    ];
    
    $(selectors.join(', ')).each((i, el) => {
      const title = $(el).text().trim();
      if (title && title.length > 10 && title.length < 200 && 
          !title.includes('ADVERTISEMENT') && !title.match(/^\d+$/) &&
          (title.toLowerCase().includes('sport') || title.toLowerCase().includes('game') || 
           title.toLowerCase().includes('player') || title.toLowerCase().includes('team')) &&
          !$(el).closest('footer').length && !$(el).closest('header').length) {
        
        let url = $(el).is('a') ? $(el).attr('href') : $(el).closest('a').attr('href');
        const fullUrl = url ? 
          (url.startsWith('http') ? url : `https://www.espn.com${url.startsWith('/') ? url : '/' + url}`) : 
          'https://www.espn.com';
        
        articles.push({
          title,
          link: fullUrl,
          pubDate: new Date().toISOString(),
          source: "ESPN",
          category: "sports",
          needsTranslation: true // ESPN content is always in English
        });
      }
    });
    
    const uniqueArticles = articles.filter((article, index, self) =>
      index === self.findIndex(a => a.title === article.title)
    );
    
    return uniqueArticles.slice(0, 5);
  } catch (err) {
    console.error("ESPN scraping error:", err.message);
    return [];
  }
}

async function getArticles() {
  const feedCategories = {
    international: [
      "https://feeds.bbci.co.uk/news/rss.xml",
      "http://rss.cnn.com/rss/edition.rss",
      "https://feeds.reuters.com/reuters/topNews",
      "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"
    ],
    sports: [
      "https://www.bbc.com/sport/africa/rss.xml",
      "https://www.goal.com/rss"
    ]
  };

  let articles = [];
  for (const category in feedCategories) {
    for (const url of feedCategories[category]) {
      const feed = await fetchFeed(url);
      if (feed.items && feed.items.length > 0) {
        const sourceArticles = feed.items.map(item => ({
          ...item,
          source: feed.title || url,
          sourceUrl: url,
          category,
          needsTranslation: true
        }));
        articles = articles.concat(sourceArticles);
        console.log(`Added ${feed.items.length} articles from ${feed.title || url} (${category})`);
      }
    }
  }

  // Add scraped articles
  const [tanzaniaArticles, eastAfricaArticles, espnArticles] = await Promise.all([
    scrapeTanzaniaNews(),
    scrapeEastAfricaNews(),
    scrapeESPNNews()
  ]);
  
  articles = articles.concat(tanzaniaArticles, eastAfricaArticles, espnArticles);
  console.log(`Added ${tanzaniaArticles.length} Tanzanian articles, ${eastAfricaArticles.length} East African articles, ${espnArticles.length} ESPN articles`);

  // Filter last 48 hours
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  articles = articles.filter(a => a.pubDate && new Date(a.pubDate) > twoDaysAgo);

  // Sort newest first
  articles.sort((a,b) => new Date(b.pubDate) - new Date(a.pubDate));

  // Limit top 30
  articles = articles.slice(0,30);

  // Translate
  await Promise.all(
    articles.map(async a => {
      if (a.needsTranslation) {
        const cleanTitle = stripHTML(a.title || "");
        const cleanDesc = stripHTML(a.contentSnippet || a.content || a.summary || a.description || "");
        a.title_sw = await translateToSwahili(cleanTitle);
        a.description_sw = await translateToSwahili(cleanDesc.slice(0,200));
      } else {
        a.title_sw = a.title;
        a.description_sw = a.contentSnippet || a.description || "";
      }
      
      // Add image extraction logic if needed
      if (!a.image) {
        a.image = null;
      }
    })
  );

  return articles;
}

app.get("/", async (req,res) => {
  try {
    const articles = await getArticles();
    res.render("index", { articles });
  } catch (err) {
    console.error("Main route error:", err);
    res.status(500).send("Error loading news articles");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HabariHub running on port ${PORT}`));
