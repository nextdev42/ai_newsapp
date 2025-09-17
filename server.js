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
  console.log("Extracting image for item:", item.title);
  
  // Check enclosure (common in RSS feeds)
  if (item.enclosure && item.enclosure.url) {
    console.log("Found image in enclosure:", item.enclosure.url);
    return item.enclosure.url;
  }
  
  // Check media content
  if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url) {
    console.log("Found image in mediaContent:", item.mediaContent.$.url);
    return item.mediaContent.$.url;
  }
  
  // Check media thumbnail
  if (item.mediaThumbnail && item.mediaThumbnail.$ && item.mediaThumbnail.$.url) {
    console.log("Found image in mediaThumbnail:", item.mediaThumbnail.$.url);
    return item.mediaThumbnail.$.url;
  }
  
  // Check content for images
  if (item.content) {
    const imgMatch = item.content.match(/<img[^>]+src="([^">]+)"/);
    if (imgMatch && imgMatch[1]) {
      console.log("Found image in content:", imgMatch[1]);
      return imgMatch[1];
    }
  }
  
  // Check content encoded for images
  if (item.contentEncoded) {
    const imgMatch = item.contentEncoded.match(/<img[^>]+src="([^">]+)"/);
    if (imgMatch && imgMatch[1]) {
      console.log("Found image in contentEncoded:", imgMatch[1]);
      return imgMatch[1];
    }
  }
  
  // Check description for images
  if (item.description) {
    const imgMatch = item.description.match(/<img[^>]+src="([^">]+)"/);
    if (imgMatch && imgMatch[1]) {
      console.log("Found image in description:", imgMatch[1]);
      return imgMatch[1];
    }
  }
  
  console.log("No image found for item");
  return null;
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
    
    // Look for article containers with more specific selectors
    $('.article, .news-item, .post, .story').each((i, el) => {
      const titleElement = $(el).find('h1, h2, h3, .title, .headline').first();
      const title = titleElement.text().trim();
      
      if (title && title.length > 10 && title.length < 200 && 
          !title.includes('ADVERTISEMENT') && !title.match(/^\d+$/)) {
        
        // Try to find a link
        let url = $(el).find('a').first().attr('href');
        const fullUrl = url ? 
          (url.startsWith('http') ? url : `https://www.thecitizen.co.tz${url.startsWith('/') ? url : '/' + url}`) : 
          'https://www.thecitizen.co.tz';
        
        // Try to find a description/summary - more thorough approach
        let description = $(el).find('p, .summary, .excerpt, .description').first().text().trim();
        if (!description || description.length < 20) {
          // Try to get the first paragraph that's not too short
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
        
        // Try to find an image - more thorough approach
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
    
    // If we didn't find articles using containers, try a different approach
    if (articles.length === 0) {
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        const title = $(el).text().trim();
        
        if (href && (href.includes('/news/') || href.includes('/article/')) && 
            title && title.length > 10 && title.length < 200) {
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
    
    // Try multiple approaches to find articles
    $('.story, .article, .news-item, a[href*="/news/"]').each((i, el) => {
      const title = $(el).text().trim();
      
      if (title && title.length > 10 && title.length < 200 && 
          !title.includes('ADVERTISEMENT') && !title.match(/^\d+$/)) {
        
        let url = $(el).attr('href') || $(el).find('a').attr('href');
        const fullUrl = url ? 
          (url.startsWith('http') ? url : `https://www.theeastafrican.co.ke${url.startsWith('/') ? url : '/' + url}`) : 
          'https://www.theeastafrican.co.ke';
        
        // Try to find a description
        let description = $(el).find('p').first().text().trim();
        if (!description || description.length < 20) {
          // Try to get the first paragraph that's not too short
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
        let image = $(el).find('img').attr('src');
        if (image && !image.startsWith('http')) {
          image = `https://www.theeastafrican.co.ke${image.startsWith('/') ? image : '/' + image}`;
        }
        
        // If no image found, try data-src or other attributes
        if (!image) {
          image = $(el).find('img').attr('data-src');
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
    
    // If still no articles, try a more direct approach
    if (articles.length === 0) {
      $('h1, h2, h3').each((i, el) => {
        const title = $(el).text().trim();
        if (title && title.length > 10 && title.length < 200) {
          const parent = $(el).parent();
          let url = parent.is('a') ? parent.attr('href') : parent.find('a').attr('href');
          const fullUrl = url ? 
            (url.startsWith('http') ? url : `https://www.theeastafrican.co.ke${url.startsWith('/') ? url : '/' + url}`) : 
            'https://www.theeastafrican.co.ke';
          
          articles.push({
            title,
            link: fullUrl,
            contentSnippet: "Habari za Afrika Mashariki",
            pubDate: new Date().toISOString(),
            source: "The East African",
            category: "eastAfrica",
            needsTranslation: !isSwahili(title),
            image: null
          });
        }
      });
    }
    
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
    
    // Look for sports news items
    $('.contentItem, .story, a[href*="/story/"]').each((i, el) => {
      const title = $(el).text().trim();
      
      if (title && title.length > 10 && title.length < 200 && 
          (title.toLowerCase().includes('sport') || title.toLowerCase().includes('game') || 
           title.toLowerCase().includes('player') || title.toLowerCase().includes('team'))) {
        
        let url = $(el).attr('href');
        const fullUrl = url ? 
          (url.startsWith('http') ? url : `https://www.espn.com${url.startsWith('/') ? url : '/' + url}`) : 
          'https://www.espn.com';
        
        // Try to find a description
        let description = $(el).find('p').first().text().trim();
        if (!description || description.length < 20) {
          // Try to get the first paragraph that's not too short
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
        let image = $(el).find('img').attr('src');
        if (image && !image.startsWith('http')) {
          image = `https://www.espn.com${image.startsWith('/') ? image : '/' + image}`;
        }
        
        // If no image found, try data-src or other attributes
        if (!image) {
          image = $(el).find('img').attr('data-src');
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
      
      // Log image information for debugging
      if (a.image) {
        console.log(`Image found for "${a.title}": ${a.image}`);
      } else {
        console.log(`No image found for "${a.title}"`);
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
