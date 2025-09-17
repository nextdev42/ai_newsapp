import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import translate from "@iamtraction/google-translate";
import * as cheerio from "cheerio"; // Import cheerio

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

// Simple in-memory cache for translations
const translationCache = {};

// Tafsiri maandishi kwa Kiswahili
async function translateToSwahili(text) {
  if (!text || text.trim() === "") return "";
  if (translationCache[text]) return translationCache[text];

  try {
    const res = await translate(text, { to: "sw" });
    translationCache[text] = res.text;
    return res.text;
  } catch (error) {
    console.error("Translation error:", error.message, "| Text:", text);
    return text;
  }
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

// Web scraping functions
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
    
    // Scrape headlines from The Citizen Tanzania
    $('.headline, h1, h2, h3').each((i, element) => {
      const title = $(element).text().trim();
      if (title && title.length > 20 && title.length < 200) {
        const url = $(element).closest('a').attr('href');
        articles.push({
          title: title,
          link: url ? (url.startsWith('http') ? url : `https://www.thecitizen.co.tz${url}`) : 'https://www.thecitizen.co.tz',
          pubDate: new Date().toISOString(),
          source: "The Citizen Tanzania",
          category: "tanzania"
        });
      }
    });
    
    return articles.slice(0, 5); // Return top 5 articles
  } catch (error) {
    console.error("Tanzania scraping error:", error.message);
    return [];
  }
}

async function scrapeEastAfricaNews() {
  try {
    console.log("Scraping East Africa news...");
    const { data } = await axios.get('https://www.theeastafrican.co.ke', {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(data);
    const articles = [];
    
    // Scrape headlines from The East African
    $('.headline, h1, h2, h3').each((i, element) => {
      const title = $(element).text().trim();
      if (title && title.length > 20 && title.length < 200) {
        const url = $(element).closest('a').attr('href');
        articles.push({
          title: title,
          link: url ? (url.startsWith('http') ? url : `https://www.theeastafrican.co.ke${url}`) : 'https://www.theeastafrican.co.ke',
          pubDate: new Date().toISOString(),
          source: "The East African",
          category: "eastAfrica"
        });
      }
    });
    
    return articles.slice(0, 5); // Return top 5 articles
  } catch (error) {
    console.error("East Africa scraping error:", error.message);
    return [];
  }
}

async function scrapeESPNNews() {
  try {
    console.log("Scraping ESPN news...");
    const { data } = await axios.get('https://www.espn.com', {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(data);
    const articles = [];
    
    // Scrape headlines from ESPN
    $('.headline, h1, h2, h3').each((i, element) => {
      const title = $(element).text().trim();
      if (title && title.length > 20 && title.length < 200 && 
          (title.toLowerCase().includes('sport') || title.toLowerCase().includes('game') || 
           title.toLowerCase().includes('player') || title.toLowerCase().includes('team'))) {
        const url = $(element).closest('a').attr('href');
        articles.push({
          title: title,
          link: url ? (url.startsWith('http') ? url : `https://www.espn.com${url}`) : 'https://www.espn.com',
          pubDate: new Date().toISOString(),
          source: "ESPN",
          category: "sports"
        });
      }
    });
    
    return articles.slice(0, 5); // Return top 5 articles
  } catch (error) {
    console.error("ESPN scraping error:", error.message);
    return [];
  }
}

// Fetch na process articles
async function getArticles() {
  // Categorize feeds by type with working URLs
  const feedCategories = {
    international: [
      "https://feeds.bbci.co.uk/news/rss.xml", // BBC
      "http://rss.cnn.com/rss/edition.rss", // CNN
      "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" // New York Times
    ],
    sports: [
      "https://www.bbc.com/sport/africa/rss.xml", // BBC Sport Africa
      "https://www.goal.com/rss" // Goal.com
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
        // Add source information and category to each article
        const sourceArticles = feed.items.map(item => {
          return {
            ...item,
            source: feed.title || url,
            sourceUrl: url,
            category: category
          };
        });
        
        articles = articles.concat(sourceArticles);
        console.log(`Added ${feed.items.length} articles from ${feed.title || url} (${category})`);
      } else {
        console.warn(`No items found in feed: ${url}`);
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

  // Filter articles published in the last 48 hours (more lenient for scraped content)
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  articles = articles.filter(article => {
    if (!article.pubDate) return false;
    const pubDate = new Date(article.pubDate);
    return pubDate > twoDaysAgo;
  });

  console.log(`Found ${articles.length} articles from last 48 hours`);

  // Group articles by category for debugging
  const articlesByCategory = {};
  articles.forEach(article => {
    const category = article.category;
    if (!articlesByCategory[category]) articlesByCategory[category] = 0;
    articlesByCategory[category]++;
  });
  console.log("Articles by category:", articlesByCategory);

  // Sort by date, newest first
  articles.sort((a, b) => {
    return new Date(b.pubDate) - new Date(a.pubDate);
  });

  // Limit to top 30 recent articles
  articles = articles.slice(0, 30);

  // Translate titles and descriptions
  await Promise.all(
    articles.map(async (article) => {
      const cleanTitle = stripHTML(article.title || "");
      const cleanDesc = stripHTML(
        article.contentSnippet || article.content || article.summary || article.description || ""
      );

      article.title_sw = await translateToSwahili(cleanTitle);
      article.description_sw = await translateToSwahili(cleanDesc.slice(0, 200)); // Limit description length

      // For scraped articles without images, try to find one
      if (!article.image) {
        // Try to extract image from content if available
        if (article.content && article.content.includes("<img")) {
          const imgMatch = article.content.match(/<img[^>]+src="([^">]+)"/);
          if (imgMatch && imgMatch[1]) {
            article.image = imgMatch[1];
          }
        } else if (article.contentEncoded && article.contentEncoded.includes("<img")) {
          const imgMatch = article.contentEncoded.match(/<img[^>]+src="([^">]+)"/);
          if (imgMatch && imgMatch[1]) {
            article.image = imgMatch[1];
          }
        } else {
          article.image = null;
        }
      }
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
