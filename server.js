import express from "express";
import fs from "fs";
import Parser from "rss-parser";
import axios from "axios";
import translate from "@iamtraction/google-translate";
import { exec } from "child_process";

const app = express();
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

// ---------------- RSS Feed Fetching ----------------
const parser = new Parser();

async function fetchFeed(url, category) {
  try {
    const feed = await parser.parseURL(url);
    return feed.items.map(item => ({
      title: item.title || "Hakuna kichwa",
      description: item.contentSnippet || item.summary || "Hakuna maelezo",
      link: item.link,
      pubDate: item.pubDate || new Date().toISOString(),
      image: item.enclosure?.url || "/default-news.jpg",
      source: feed.title || url,
      category,
      needsTranslation: true
    }));
  } catch (err) {
    console.error("RSS fetch error:", err.message, "| URL:", url);
    return [];
  }
}

// ---------------- Mwananchi JSON ----------------
let mwananchiArticles = [];
const MW_JSON = "./mwananchi.json";

async function loadMwananchi() {
  if (!fs.existsSync(MW_JSON)) {
    console.log("Mwananchi JSON missing, running spider...");
    exec("cd habarihub && scrapy crawl mwananchi -o ../mwananchi.json -t json", (err, stdout, stderr) => {
      if (err) console.error("Error generating Mwananchi JSON:", err);
      else console.log("Mwananchi JSON generated.");
    });
    return [];
  }

  try {
    const data = fs.readFileSync(MW_JSON, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.warn("Mwananchi JSON not found or invalid, using empty array.");
    return [];
  }
}

// ---------------- Main ----------------
async function getArticles() {
  const rssFeeds = [
    { url: "https://feeds.bbci.co.uk/news/rss.xml", category: "international" },
    { url: "http://rss.cnn.com/rss/edition.rss", category: "international" },
   // { url: "https://feeds.reuters.com/reuters/topNews", category: "international" },
    { url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", category: "international" },
    { url: "https://www.msnbc.com/feeds/rss", category: "international" }
  ];

  // Fetch RSS articles
  let articles = [];
  for (const feed of rssFeeds) {
    const feedArticles = await fetchFeed(feed.url, feed.category);
    articles = articles.concat(feedArticles);
  }

  // Load Mwananchi articles
  const mwananchi = await loadMwananchi();
  articles = articles.concat(mwananchi.map(a => ({
    ...a,
    needsTranslation: false
  })));

  // Sort by date
  articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // Limit to latest 30 articles
  articles = articles.slice(0, 30);

  // Translate if needed
  await Promise.all(
    articles.map(async a => {
      if (a.needsTranslation) {
        a.title_sw = await translateToSwahili(a.title);
        a.description_sw = await translateToSwahili(a.description.slice(0, 200));
      } else {
        a.title_sw = a.title;
        a.description_sw = a.description;
      }
    })
  );

  return articles;
}

// ---------------- Express Route ----------------
app.get("/", async (req, res) => {
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
