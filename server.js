import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import * as cheerio from "cheerio";
import translate from "@iamtraction/google-translate";

const app = express();
app.set("view engine", "ejs");
app.use(express.static("public"));

const parser = new Parser();

// ---------------- Translation Cache ----------------
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
  } catch (err) {
    console.error("Translation error:", err.message);
    return text;
  }
}

function stripHTML(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>?/gm, "");
}

function isSwahili(text) {
  if (!text) return false;
  const swIndicators = ["ya","wa","za","ku","na","ni","kwa","haya","hii","hili","hivi","mimi","wewe","yeye","sisi","nyinyi","wao"];
  const words = text.toLowerCase().split(/\s+/);
  let count = 0;
  for (const word of words) {
    if (swIndicators.includes(word)) count++;
    if (count >= 2) return true;
  }
  return false;
}

// ---------------- RSS Feeds ----------------
const rssFeeds = [
  { url: "https://feeds.bbci.co.uk/news/rss.xml", category: "international", source: "BBC" },
  { url: "http://rss.cnn.com/rss/edition.rss", category: "international", source: "CNN" },
  { url: "https://feeds.reuters.com/reuters/topNews", category: "international", source: "Reuters" },
  { url: "https://www.msnbc.com/feeds/rss/top-stories.xml", category: "international", source: "MSNBC" },
];

// ---------------- Mwananchi Scraper ----------------
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
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
          category: "tanzania",
          source: "Mwananchi",
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

// ---------------- Fetch RSS ----------------
async function fetchRSS() {
  const articles = [];
  for (const feed of rssFeeds) {
    try {
      const parsed = await parser.parseURL(feed.url);
      parsed.items?.forEach(item => {
        articles.push({
          title: item.title || "No title",
          link: item.link,
          description: item.contentSnippet || item.content || "No description",
          image: item.enclosure?.url || "/default-news.jpg",
          category: feed.category,
          source: feed.source,
          pubDate: item.pubDate || new Date().toISOString(),
          needsTranslation: !isSwahili(item.title)
        });
      });
    } catch (err) {
      console.error(`RSS fetch error: ${err.message} | URL: ${feed.url}`);
    }
  }
  return articles;
}

// ---------------- Main Articles ----------------
async function getArticles() {
  const rssArticles = await fetchRSS();
  const mwananchiArticles = await scrapeMwananchi();

  let allArticles = [...rssArticles, ...mwananchiArticles];
  allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // Translate where needed
  await Promise.all(allArticles.map(async a => {
    if (a.needsTranslation) {
      a.title_sw = await translateToSwahili(stripHTML(a.title));
      a.description_sw = await translateToSwahili(stripHTML(a.description).slice(0, 200));
    } else {
      a.title_sw = a.title;
      a.description_sw = a.description;
    }
  }));

  return allArticles.slice(0, 30);
}

// ---------------- Express ----------------
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
