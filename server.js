import express from "express";
import Parser from "rss-parser";
import fs from "fs/promises";
import path from "path";
import translate from "@iamtraction/google-translate";

const app = express();
app.set("view engine", "ejs");
app.use(express.static("public"));

// ---------------- Translation Cache ----------------
const translationCache = {};
const CACHE_EXPIRY = 30 * 60 * 1000; // 30 minutes

async function translateToSwahili(text) {
  if (!text || text.trim() === "") return "Hakuna maelezo";
  const now = Date.now();
  if (translationCache[text] && now - translationCache[text].timestamp < CACHE_EXPIRY) {
    return translationCache[text].translation;
  }
  try {
    const cleanText = text.replace(/[^\w\s.,!?;:'"-]/gi, '').trim();
    if (!cleanText) return "Hakuna maelezo";
    const res = await translate(cleanText, { to: "sw" });
    const translation = res.text;
    translationCache[text] = { translation, timestamp: now };
    return translation;
  } catch (err) {
    console.error("Translation error:", err.message);
    return text;
  }
}

// ---------------- RSS Feeds ----------------
const rssFeeds = [
//  { url: "http://rss.cnn.com/rss/edition.rss", category: "international", source: "CNN" },
  { url: "https://feeds.bbci.co.uk/news/rss.xml", category: "international", source: "BBC" },
//  { url: "https://feeds.reuters.com/reuters/topNews", category: "international", source: "Reuters" }
];

const parser = new Parser();

async function fetchRSSArticles() {
  const articles = [];
  for (const feed of rssFeeds) {
    try {
      const rss = await parser.parseURL(feed.url);
      rss.items.forEach(item => {
        articles.push({
          title: item.title || "Hakuna Kichwa",
          description: item.contentSnippet || item.content || "Hakuna Maelezo",
          link: item.link,
          pubDate: item.pubDate,
          source: feed.source,
          category: feed.category,
          image: item.enclosure?.url || "/default-news.jpg",
          needsTranslation: true
        });
      });
    } catch (err) {
      console.error(`${feed.source} RSS error:`, err.message);
    }
  }
  return articles;
}

// ---------------- Scrapy JSON ----------------
async function fetchMwananchiArticles() {
  try {
    const filePath = path.join(process.cwd(), "mwananchi.json");
    const data = await fs.readFile(filePath, "utf-8");
    const articles = JSON.parse(data);

    // Assign category and source
    return articles.map(a => ({
      title: a.title || "Hakuna Kichwa",
      description: a.description || "Hakuna Maelezo",
      link: a.link,
      pubDate: a.pubDate || null,
      source: "Mwananchi",
      category: "tanzania",
      image: a.image || "/default-news.jpg",
      needsTranslation: false // Mwananchi already Swahili
    }));
  } catch (err) {
    console.error("Mwananchi JSON error:", err.message);
    return [];
  }
}

// ---------------- Combine All Articles ----------------
async function getAllArticles() {
  const [rssArticles, mwananchiArticles] = await Promise.all([
    fetchRSSArticles(),
    fetchMwananchiArticles()
  ]);

  const allArticles = [...mwananchiArticles, ...rssArticles];

  // Translate RSS articles to Swahili
  await Promise.all(
    allArticles.map(async a => {
      if (a.needsTranslation) {
        a.title_sw = await translateToSwahili(a.title);
        a.description_sw = await translateToSwahili(a.description);
      } else {
        a.title_sw = a.title;
        a.description_sw = a.description;
      }
    })
  );

  // Sort by date (newest first)
  allArticles.sort((a, b) => {
    const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return dateB - dateA;
  });

  return allArticles;
}

// ---------------- Express ----------------
app.get("/", async (req, res) => {
  try {
    const articles = await getAllArticles();
    res.render("index", { articles });
  } catch (err) {
    console.error("Main route error:", err);
    res.status(500).send("Error loading news articles");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HabariHub running on port ${PORT}`));
