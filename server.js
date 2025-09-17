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

// Fetch na process articles
async function getArticles() {
  // Categorize feeds by type with working URLs
  const feedCategories = {
    international: [
      "https://feeds.bbci.co.uk/news/rss.xml", // BBC
      "http://rss.cnn.com/rss/edition.rss", // CNN
      "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" // New York Times
    ],
    tanzania: [
      "https://www.thecitizen.co.tz/rss", // The Citizen Tanzania
      "https://www.ippmedia.com/rss", // IPP Media Tanzania
      "https://www.mwananchi.co.tz/rss" // Mwananchi Newspaper
    ],
    eastAfrica: [
      "https://nation.africa/kenya.rss", // Daily Nation Kenya
      "https://www.monitor.co.ug/uganda.rss", // Daily Monitor Uganda
      "https://www.theeastafrican.co.ke/ke.rss" // The East African
    ],
    sports: [
      "https://www.bbc.com/sport/africa/rss.xml", // BBC Sport Africa
      "https://www.espn.com/espn/rss/news", // ESPN
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

  // If we don't have enough articles, add some fallback feeds
  if (articles.length < 10) {
    console.log("Not enough articles, adding fallback feeds...");
    const fallbackFeeds = [
      "https://www.aljazeera.com/xml/rss/all.xml",
      "https://feeds.skynews.com/feeds/rss/world.xml",
      "https://www.dw.com/rss/en-world-01/rdf"
    ];
    
    for (const url of fallbackFeeds) {
      const feed = await fetchFeed(url);
      if (feed.items && feed.items.length > 0) {
        const sourceArticles = feed.items.map(item => {
          return {
            ...item,
            source: feed.title || url,
            sourceUrl: url,
            category: "international"
          };
        });
        articles = articles.concat(sourceArticles);
        console.log(`Added ${feed.items.length} fallback articles from ${feed.title || url}`);
      }
    }
  }

  // Filter articles published in the last 48 hours (more lenient for East African sources)
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

      // Attach images if available
      if (article.enclosure && article.enclosure.url) {
        article.image = article.enclosure.url;
      } else if (article.mediaContent && article.mediaContent.$.url) {
        article.image = article.mediaContent.$.url;
      } else if (article.mediaThumbnail && article.mediaThumbnail.$.url) {
        article.image = article.mediaThumbnail.$.url;
      } else if (article.content && article.content.includes("<img")) {
        // Try to extract image from content
        const imgMatch = article.content.match(/<img[^>]+src="([^">]+)"/);
        if (imgMatch && imgMatch[1]) {
          article.image = imgMatch[1];
        } else {
          article.image = null;
        }
      } else if (article.contentEncoded && article.contentEncoded.includes("<img")) {
        // Try to extract image from encoded content
        const imgMatch = article.contentEncoded.match(/<img[^>]+src="([^">]+)"/);
        if (imgMatch && imgMatch[1]) {
          article.image = imgMatch[1];
        } else {
          article.image = null;
        }
      } else {
        article.image = null;
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
