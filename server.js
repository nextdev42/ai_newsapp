import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import * as cheerio from "cheerio";
import translate from "@iamtraction/google-translate";
import fs from "fs";

const app = express();
const parser = new Parser();

app.set("view engine", "ejs");
app.use(express.static("public"));

// ---------------- Translation Cache ----------------
const translationCache = {};
const CACHE_EXPIRY = 30 * 60 * 1000; // 30 min

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
const feedUrls = [
  "https://feeds.bbci.co.uk/news/rss.xml",
  "http://rss.cnn.com/rss/edition.rss",
 // "https://feeds.reuters.com/reuters/topNews",
  "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
  "https://www.msnbc.com/feeds/latest"
];

async function fetchRSSFeed(url) {
  try {
    const feed = await parser.parseURL(url);
    return feed.items.map(item => ({
      title: item.title || "No title",
      link: item.link,
      description: item.contentSnippet || item.content || "No description",
      pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
      source: feed.title || url,
      image: item.enclosure?.url || null,
      needsTranslation: true
    }));
  } catch (err) {
    console.error(`RSS fetch error for ${url}:`, err.message);
    return [];
  }
}

// ---------------- Mwananchi Scraper ----------------
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.google.com/",
  "Connection": "keep-alive"
};

async function scrapeMwananchi() {
  try {
    const { data } = await axios.get("https://www.mwananchi.co.tz/mw", { headers, timeout: 20000 });
    const $ = cheerio.load(data);
    const articles = [];

    $(".article-item, .news-item").each((i, el) => {
      const title = $(el).find(".title").text().trim();
      const link = $(el).find("a").attr("href");
      const description = $(el).find(".summary, p").first().text().trim();
      let image = $(el).find("img").attr("src");
      if (image && !image.startsWith("http")) image = `https://www.mwananchi.co.tz${image}`;

      if (title && link) {
        articles.push({
          title,
          link: link.startsWith("http") ? link : `https://www.mwananchi.co.tz${link}`,
          description: description || "Habari kutoka Mwananchi",
          image: image || "/default-news.jpg",
          needsTranslation: false // Already Swahili
        });
      }
    });

    return articles.slice(0, 20);
  } catch (err) {
    console.error("Mwananchi scraping error:", err.message);
    return [];
  }
}

// ---------------- Main Route ----------------
app.get("/", async (req, res) => {
  try {
    // Fetch RSS feeds
    const rssPromises = feedUrls.map(fetchRSSFeed);
    const rssArticles = (await Promise.all(rssPromises)).flat();

    // Fetch Mwananchi
    const mwananchiArticles = await scrapeMwananchi();

    // Merge all articles
    let articles = rssArticles.concat(mwananchiArticles);

    // Translate only where needed
    await Promise.all(
      articles.map(async (a) => {
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
    articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    // Limit to latest 30 articles
    articles = articles.slice(0, 30);

    // Ensure fallback image
    articles.forEach(a => {
      if (!a.image) a.image = "/default-news.jpg";
    });

    res.render("index", { articles });
  } catch (err) {
    console.error("Main route error:", err);
    res.status(500).send("Error loading news articles");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HabariHub running on port ${PORT}`));
