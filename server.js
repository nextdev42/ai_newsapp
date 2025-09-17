import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import translate from "@iamtraction/google-translate";
import * as cheerio from "cheerio";

const app = express();
const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
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
  if (!text || text.trim() === "") return "Hakuna maelezo";
  
  const now = Date.now();
  if (translationCache[text] && (now - translationCache[text].timestamp) < CACHE_EXPIRY) {
    return translationCache[text].translation;
  }

  try {
    const cleanText = text.replace(/[^\w\s.,!?;:'"-]/gi, '').trim();
    if (!cleanText) return "Hakuna maelezo";
    
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

// Enhanced fetchFeed with better error handling
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

// Enhanced image extraction for RSS items
function extractImageFromItem(item) {
  let imageSources = [];

  // Handle RSS parser custom fields
  if (item.enclosure?.url) imageSources.push(item.enclosure.url);

  if (Array.isArray(item.mediaContent)) {
    item.mediaContent.forEach(m => {
      if (m.$?.url) imageSources.push(m.$.url);
    });
  }

  if (Array.isArray(item.mediaThumbnail)) {
    item.mediaThumbnail.forEach(m => {
      if (m.$?.url) imageSources.push(m.$.url);
    });
  }

  // Check standard fields
  if (item["media:content"]?.$?.url) imageSources.push(item["media:content"].$.url);
  if (item["media:thumbnail"]?.$?.url) imageSources.push(item["media:thumbnail"].$.url);

  // Parse HTML content for images
  const contentFields = [item.content, item.contentEncoded, item.description, item.summary].filter(Boolean);
  for (const content of contentFields) {
    const imgMatch = content.match(/<img[^>]+(src|data-src)="([^">]+)"/i);
    if (imgMatch && imgMatch[2]) {
      imageSources.push(imgMatch[2]);
    }
  }

  // Pick the first valid one
  const validImage = imageSources.find(src =>
    src.startsWith("http") && (/\.(jpg|jpeg|png|gif|webp)/i.test(src) || src.includes("image"))
  );

  return validImage || null;
}

// Enhanced Tanzania news scraping with detailed content extraction
async function scrapeTanzaniaNews() {
  try {
    console.log("Scraping Tanzania news from The Citizen...");
    const { data } = await axios.get('https://www.thecitizen.co.tz', {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(data);
    const articles = [];
    
    // More specific selectors for The Citizen
    $('.article-item, .news-item, .post-item, .story-item').each((i, el) => {
      const title = $(el).find('h2, h3, .title, .headline').first().text().trim();
      const link = $(el).find('a').first().attr('href');
      
      if (title && link && title.length > 10 && title.length < 200) {
        const fullUrl = link.startsWith('http') ? link : `https://www.thecitizen.co.tz${link.startsWith('/') ? link : '/' + link}`;
        
        // Try to find a description
        let description = $(el).find('p, .summary, .excerpt, .description').first().text().trim();
        if (!description || description.length < 20) {
          $(el).find('p').each((i, p) => {
            const text = $(p).text().trim();
            if (text.length > 50 && !description) {
              description = text;
            }
          });
        }
        
        // Fallback description
        if (!description || description.length < 20) {
          description = "Habari za Tanzania kutoka The Citizen";
        }
        
        // Try to find an image
        let image = $(el).find('img').first().attr('src');
        if (image && !image.startsWith('http')) {
          image = `https://www.thecitizen.co.tz${image.startsWith('/') ? image : '/' + image}`;
        }
        
        // If no image found, try data-src or other attributes
        if (!image) {
          image = $(el).find('img').first().attr('data-src');
          if (image && !image.startsWith('http')) {
            image = `https://www.thecitizen.co.tz${image.startsWith('/') ? image : '/' + image}`;
          }
        }
        
        articles.push({
          title,
          link: fullUrl,
          contentSnippet: description,
          pubDate: new Date().toISOString(),
          source: "The Citizen Tanzania",
          category: "tanzania",
          needsTranslation: !isSwahili(title),
          image: image || null
        });
      }
    });
    
    // If we didn't find enough articles, try alternative selectors
    if (articles.length < 3) {
      $('a[href*="/news/"], a[href*="/article/"]').each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr('href');
        
        if (title && href && title.length > 10 && title.length < 200 && 
            !title.includes('ADVERTISEMENT')) {
          const fullUrl = href.startsWith('http') ? href : `https://www.thecitizen.co.tz${href.startsWith('/') ? href : '/' + href}`;
          
          articles.push({
            title,
            link: fullUrl,
            contentSnippet: "Habari za Tanzania kutoka The Citizen",
            pubDate: new Date().toISOString(),
            source: "The Citizen Tanzania",
            category: "tanzania",
            needsTranslation: !isSwahili(title),
            image: null
          });
        }
      });
    }
    
    // Remove duplicates by title
    const uniqueArticles = articles.filter((article, index, self) =>
      index === self.findIndex(a => a.title === article.title)
    );
    
    console.log(`Found ${uniqueArticles.length} Tanzanian articles`);
    return uniqueArticles.slice(0, 5);
  } catch (err) {
    console.error("Tanzania scraping error:", err.message);
    return [];
  }
}

// Enhanced East Africa news scraping
async function scrapeEastAfricaNews() {
  try {
    console.log("Scraping East Africa news from The East African...");
    const { data } = await axios.get('https://www.theeastafrican.co.ke', {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(data);
    const articles = [];
    
    // More specific selectors for The East African
    $('.story, .article, .news-item, .headline').each((i, el) => {
      const title = $(el).find('h1, h2, h3, .title').first().text().trim();
      const link = $(el).find('a').first().attr('href');
      
      if (title && link && title.length > 10 && title.length < 200) {
        const fullUrl = link.startsWith('http') ? link : `https://www.theeastafrican.co.ke${link.startsWith('/') ? link : '/' + link}`;
        
        // Try to find a description
        let description = $(el).find('p, .summary').first().text().trim();
        if (!description || description.length < 20) {
          $(el).find('p').each((i, p) => {
            const text = $(p).text().trim();
            if (text.length > 50 && !description) {
              description = text;
            }
          });
        }
        
        if (!description || description.length < 20) {
          description = "Habari za Afrika Mashariki kutoka The East African";
        }
        
        // Try to find an image
        let image = $(el).find('img').first().attr('src');
        if (image && !image.startsWith('http')) {
          image = `https://www.theeastafrican.co.ke${image.startsWith('/') ? image : '/' + image}`;
        }
        
        // If no image found, try data-src or other attributes
        if (!image) {
          image = $(el).find('img').first().attr('data-src');
          if (image && !image.startsWith('http')) {
            image = `https://www.theeastafrican.co.ke${image.startsWith('/') ? image : '/' + image}`;
          }
        }
        
        articles.push({
          title,
          link: fullUrl,
          contentSnippet: description,
          pubDate: new Date().toISOString(),
          source: "The East African",
          category: "eastAfrica",
          needsTranslation: !isSwahili(title),
          image: image || null
        });
      }
    });
    
    const uniqueArticles = articles.filter((article, index, self) =>
      index === self.findIndex(a => a.title === article.title)
    );
    
    console.log(`Found ${uniqueArticles.length} East African articles`);
    return uniqueArticles.slice(0, 5);
  } catch (err) {
    console.error("East Africa scraping error:", err.message);
    
    // Fallback to RSS if scraping fails
    try {
      console.log("Trying RSS fallback for East Africa news...");
      const feed = await fetchFeed("https://www.theeastafrican.co.ke/rss");
      if (feed.items && feed.items.length > 0) {
        const articles = feed.items.slice(0, 5).map(item => ({
          ...item,
          source: "The East African (RSS)",
          category: "eastAfrica",
          needsTranslation: true,
          image: extractImageFromItem(item)
        }));
        console.log(`Found ${articles.length} East African articles from RSS`);
        return articles;
      }
    } catch (rssError) {
      console.error("RSS fallback also failed:", rssError.message);
    }
    
    return [];
  }
}

// Enhanced ESPN news scraping
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
    
    // More specific selectors for ESPN
    $('.contentItem__contentWrapper, .Story__Story__content, .headlineStack__listItem').each((i, el) => {
      const title = $(el).find('h1, h2, h3, .contentItem__title, .Story__Headline').first().text().trim();
      const link = $(el).find('a').first().attr('href');
      
      if (title && link && title.length > 10 && title.length < 200 && 
          (title.toLowerCase().includes('sport') || title.toLowerCase().includes('game') || 
           title.toLowerCase().includes('player') || title.toLowerCase().includes('team'))) {
        
        const fullUrl = link.startsWith('http') ? link : `https://www.espn.com${link.startsWith('/') ? link : '/' + link}`;
        
        // Try to find a description
        let description = $(el).find('p, .contentItem__subhead').first().text().trim();
        if (!description || description.length < 20) {
          $(el).find('p').each((i, p) => {
            const text = $(p).text().trim();
            if (text.length > 50 && !description) {
              description = text;
            }
          });
        }
        
        if (!description || description.length < 20) {
          description = "Habari za michezo kutoka ESPN";
        }
        
        // Try to find an image
        let image = $(el).find('img').first().attr('src');
        if (image && !image.startsWith('http')) {
          image = `https://www.espn.com${image.startsWith('/') ? image : '/' + image}`;
        }
        
        // If no image found, try data-src or other attributes
        if (!image) {
          image = $(el).find('img').first().attr('data-src');
          if (image && !image.startsWith('http')) {
            image = `https://www.espn.com${image.startsWith('/') ? image : '/' + image}`;
          }
        }
        
        articles.push({
          title,
          link: fullUrl,
          contentSnippet: description,
          pubDate: new Date().toISOString(),
          source: "ESPN",
          category: "sports",
          needsTranslation: true,
          image: image || null
        });
      }
    });
    
    const uniqueArticles = articles.filter((article, index, self) =>
      index === self.findIndex(a => a.title === article.title)
    );
    
    console.log(`Found ${uniqueArticles.length} ESPN articles`);
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
    ],
    eastAfrica: [
      "https://www.nation.co.ke/rss",
      "https://www.monitor.co.ug/uganda/rss"
    ]
  };

  let articles = [];
  
  // Process RSS feeds
  for (const category in feedCategories) {
    for (const url of feedCategories[category]) {
      const feed = await fetchFeed(url);
      if (feed.items && feed.items.length > 0) {
        const sourceArticles = feed.items.map(item => ({
          ...item,
          source: feed.title || url,
          sourceUrl: url,
          category,
          needsTranslation: true,
          image: extractImageFromItem(item)
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
  console.log(`Total articles: ${articles.length} (${tanzaniaArticles.length} Tanzanian, ${eastAfricaArticles.length} East African, ${espnArticles.length} ESPN)`);

  // Filter last 48 hours
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  articles = articles.filter(a => a.pubDate && new Date(a.pubDate) > twoDaysAgo);

  console.log(`Articles after time filter: ${articles.length}`);

  // Sort newest first
  articles.sort((a,b) => new Date(b.pubDate) - new Date(a.pubDate));

  // Limit top 30
  articles = articles.slice(0,30);

  console.log(`Final articles count: ${articles.length}`);

  // Add default image for articles without images
  articles.forEach(article => {
    if (!article.image) {
      article.image = "/default-news.jpg"; // Make sure to add this image to your public folder
    }
  });

  // Translate
  await Promise.all(
    articles.map(async a => {
      if (a.needsTranslation) {
        const cleanTitle = stripHTML(a.title || "");
        const cleanDesc = stripHTML(a.contentSnippet || a.content || a.summary || a.description || "");
        a.title_sw = await translateToSwahili(cleanTitle);
        a.description_sw = await translateToSwahili(cleanDesc.slice(0,200) || "Hakuna maelezo");
      } else {
        a.title_sw = a.title;
        a.description_sw = a.contentSnippet || a.description || "Hakuna maelezo";
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
