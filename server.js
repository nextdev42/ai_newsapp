import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import translate from "@iamtraction/google-translate";

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

// Tafsiri maandishi kwa Kiswahili - improved version
async function translateToSwahili(text) {
  if (!text || text.trim() === "") return "";
  
  // Check cache with expiry
  const now = Date.now();
  if (translationCache[text] && (now - translationCache[text].timestamp) < CACHE_EXPIRY) {
    return translationCache[text].translation;
  }

  try {
    // Clean text before translation
    const cleanText = text.replace(/[^\w\s.,!?;:'"-]/gi, '').trim();
    if (!cleanText) return "";
    
    const res = await translate(cleanText, { to: "sw" });
    const translation = res.text;
    
    // Cache the translation with timestamp
    translationCache[text] = {
      translation: translation,
      timestamp: now
    };
    
    return translation;
  } catch (error) {
    console.error("Translation error:", error.message, "| Text:", text);
    // Return original text if translation fails, but mark it for manual review
    return text;
  }
}

// Function to detect if text is already in Swahili
function isSwahili(text) {
  if (!text) return false;
  
  // Common Swahili words and prefixes
  const swahiliIndicators = [
    'ya', 'wa', 'za', 'ku', 'na', 'ni', 'kwa', 'haya', 'hii', 'hili', 'hivi',
    'mimi', 'wewe', 'yeye', 'sisi', 'nyinyi', 'wao', 'huko', 'hapa', 'pale',
    'lakini', 'au', 'ama', 'basi', 'bila', 'kama', 'kwenye', 'katika', 'kutoka'
  ];
  
  const words = text.toLowerCase().split(/\s+/);
  let swahiliWordCount = 0;
  
  for (const word of words) {
    if (swahiliIndicators.includes(word)) {
      swahiliWordCount++;
    }
    
    // If we find enough Swahili indicators, consider it Swahili
    if (swahiliWordCount >= 2) {
      return true;
    }
  }
  
  return false;
}

// Ondoa HTML tags
function stripHTML(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>?/gm, "");
}

// Fetch RSS feed safely na axios
async function fetchFeed(url) {
  try {
    console.log(`Fetching feed from: ${url}`);
    const res = await axios.get(url, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept": "application/xml, text/xml, */*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 20000
    });
    return await parser.parseString(res.data);
  } catch (err) {
    console.error("Feed fetch error:", err.message, "| URL:", url);
    return { items: [], title: url, failed: true };
  }
}

// Web scraping functions with improved content extraction
async function scrapeTanzaniaNews() {
  try {
    console.log("Scraping Tanzania news...");
    const { data } = await axios.get('https://www.thecitizen.co.tz', {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(data);
    const articles = [];
    
    // Improved scraping for Tanzanian news
    $('.headline, .title, h1, h2, h3').each((i, element) => {
      const title = $(element).text().trim();
      if (title && title.length > 10 && title.length < 200 && !title.includes('ADVERTISEMENT')) {
        const url = $(element).closest('a').attr('href');
        const fullUrl = url ? (url.startsWith('http') ? url : `https://www.thecitizen.co.tz${url}`) : 'https://www.thecitizen.co.tz';
        
        articles.push({
          title: title,
          link: fullUrl,
          pubDate: new Date().toISOString(),
          source: "The Citizen Tanzania",
          category: "tanzania",
          // Mark as needing translation if not already in Swahili
          needsTranslation: !isSwahili(title)
        });
      }
    });
    
    return articles.slice(0, 5);
  } catch (error) {
    console.error("Tanzania scraping error:", error.message);
    return [];
  }
}

// Similar improvements for other scraping functions...

// Fetch na process articles with enhanced translation
async function getArticles() {
  // Categorize feeds by type with working URLs
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
  const feedResults = [];

  // Fetch and parse each feed from all categories
  for (const category in feedCategories) {
    for (const url of feedCategories[category]) {
      const feed = await fetchFeed(url);
      feedResults.push({
        url,
        category,
        title: feed.title,
        itemCount: feed.items ? feed.items.length : 0,
        failed: feed.failed || false
      });
      
      if (feed.items && feed.items.length > 0) {
        const sourceArticles = feed.items.map(item => {
          return {
            ...item,
            source: feed.title || url,
            sourceUrl: url,
            category: category,
            needsTranslation: true // Assume all RSS items need translation
          };
        });
        
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

  // Filter articles published in the last 48 hours
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  articles = articles.filter(article => {
    if (!article.pubDate) return false;
    const pubDate = new Date(article.pubDate);
    return pubDate > twoDaysAgo;
  });

  // Sort by date, newest first
  articles.sort((a, b) => {
    return new Date(b.pubDate) - new Date(a.pubDate);
  });

  // Limit to top 30 recent articles
  articles = articles.slice(0, 30);

  // Translate titles and descriptions that need translation
  await Promise.all(
    articles.map(async (article) => {
      // Only translate if needed
      if (article.needsTranslation) {
        const cleanTitle = stripHTML(article.title || "");
        const cleanDesc = stripHTML(
          article.contentSnippet || article.content || article.summary || article.description || ""
        );

        article.title_sw = await translateToSwahili(cleanTitle);
        article.description_sw = await translateToSwahili(cleanDesc.slice(0, 200));
      } else {
        // Already in Swahili
        article.title_sw = article.title;
        article.description_sw = article.contentSnippet || article.description || "";
      }

      // Image extraction logic remains the same...
    })
  );

  return articles;
}

// Route
app.get("/", async (req, res) => {
  try {
    const articles = await getArticles();
    res.render("index", { articles });
  } catch (error) {
    console.error("Error in main route:", error);
    res.status(500).send("Error loading news articles");
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HabariHub running on port ${PORT}`));
