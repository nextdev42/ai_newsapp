import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import translate from "@iamtraction/google-translate";

const app = express();
// Configure parser to handle media content
const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail']
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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/xml"
      },
      timeout: 15000
    });
    return await parser.parseString(res.data);
  } catch (err) {
    console.error("Feed fetch error:", err.message, "| URL:", url);
    return { items: [], title: url, failed: true };
  }
}

// Fetch na process articles
async function getArticles() {
  // Updated list of RSS feed URLs with working ones
  const feedUrls = [
    "https://feeds.bbci.co.uk/news/rss.xml", // BBC
    "http://rss.cnn.com/rss/edition.rss", // CNN
    "https://www.cnbc.com/id/10000664/device/rss/rss.html", // Updated CNBC URL
    "https://feeds.reuters.com/reuters/topNews", // Reuters Top News
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" // New York Times as alternative
  ];

  let articles = [];
  const feedResults = [];

  // Fetch and parse each feed
  for (const url of feedUrls) {
    const feed = await fetchFeed(url);
    feedResults.push({
      url,
      title: feed.title,
      itemCount: feed.items ? feed.items.length : 0,
      failed: feed.failed || false
    });
    
    if (feed.items && feed.items.length > 0) {
      // Add source information to each article
      const sourceArticles = feed.items.map(item => {
        return {
          ...item,
          source: feed.title || url,
          sourceUrl: url
        };
      });
      
      articles = articles.concat(sourceArticles);
      console.log(`Added ${feed.items.length} articles from ${feed.title || url}`);
    } else {
      console.warn(`No items found in feed: ${url}`);
    }
  }

  // Debug: Show what feeds we got
  console.log("Feed results:", feedResults);

  // Filter articles published in the last 24 hours
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  articles = articles.filter(article => {
    if (!article.pubDate) return false;
    const pubDate = new Date(article.pubDate);
    return pubDate > oneDayAgo;
  });

  console.log(`Found ${articles.length} articles from last 24 hours`);

  // Group articles by source for debugging
  const articlesBySource = {};
  articles.forEach(article => {
    const source = article.source;
    if (!articlesBySource[source]) articlesBySource[source] = 0;
    articlesBySource[source]++;
  });
  console.log("Articles by source:", articlesBySource);

  // Sort by date, newest first
  articles.sort((a, b) => {
    return new Date(b.pubDate) - new Date(a.pubDate);
  });

  // Limit to top 20 recent articles
  articles = articles.slice(0, 20);

  // Translate titles and descriptions
  await Promise.all(
    articles.map(async (article) => {
      const cleanTitle = stripHTML(article.title || "");
      const cleanDesc = stripHTML(
        article.contentSnippet || article.content || article.summary || ""
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
