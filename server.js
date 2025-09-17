import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import translate from "@iamtraction/google-translate";

const app = express();
const parser = new Parser();

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
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000
    });
    return await parser.parseString(res.data);
  } catch (err) {
    console.error("Feed fetch error:", err.message, "| URL:", url);
    return { items: [] };
  }
}

// Fetch na process articles
async function getArticles() {
  // Define the list of RSS feed URLs
  const feedUrls = [
    "http://rss.cnn.com/rss/edition.rss", // CNN
    "https://feeds.bbci.co.uk/news/rss.xml", // BBC
    "https://www.cnbc.com/id/100003114/device/rss/rss.html", // CNBC
    "https://feeds.reuters.com/reuters/technologyNews?format=xml", // Reuters Technology
    "https://feeds.reuters.com/reuters/worldNews?format=xml" // Reuters World News
  ];

  let articles = [];

  // Fetch and parse each feed
  for (const url of feedUrls) {
    const feed = await fetchFeed(url);
    if (feed.items && feed.items.length > 0) {
      articles = articles.concat(feed.items);
    } else {
      console.warn("Feed empty or failed:", url);
    }
  }

  // Filter articles published in the last 24 hours
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  articles = articles.filter(article => {
    if (!article.pubDate) return false;
    const pubDate = new Date(article.pubDate);
    return pubDate > oneDayAgo;
  });

  // Limit to top 20 recent articles
  articles = articles.slice(0, 20);

  // Translate titles and descriptions
  await Promise.all(
    articles.map(async (article) => {
      const cleanTitle = stripHTML(article.title);
      const cleanDesc = stripHTML(
        article.contentSnippet || article.content || article.summary || article.title || ""
      );

      article.title_sw = await translateToSwahili(cleanTitle);
      article.description_sw = await translateToSwahili(cleanDesc);

      // Attach images if available
      if (article.enclosure && article.enclosure.url) {
        article.image = article.enclosure.url;
      } else if (article["media:content"] && article["media:content"].url) {
        article.image = article["media:content"].url;
      } else {
        article.image = null;
      }
    })
  );

  return articles;
}

// Route
app.get("/", async (req, res) => {
  const articles = await getArticles();
  res.render("index", { articles });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HabariHub running on port ${PORT}`));
