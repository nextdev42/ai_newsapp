import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import translate from "@iamtraction/google-translate";
import * as cheerio from "cheerio";

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
    console.error("Translation error:", err.message, "| Text:", text);
    return text;
  }
}

// ---------------- Swahili Detection ----------------
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

// ---------------- RSS Parser ----------------
const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["description", "description"],
      ["content:encoded", "contentEncoded"]
    ]
  }
});

async function fetchFeed(url) {
  try {
    const res = await axios.get(url, { timeout: 20000 });
    return await parser.parseString(res.data);
  } catch (err) {
    console.error("Feed fetch error:", err.message, "| URL:", url);
    return { items: [], title: url };
  }
}

function extractImageFromItem(item) {
  let imgs = [];
  if (item.enclosure?.url) imgs.push(item.enclosure.url);
  if (Array.isArray(item.mediaContent)) item.mediaContent.forEach(m => m.$?.url && imgs.push(m.$.url));
  if (Array.isArray(item.mediaThumbnail)) item.mediaThumbnail.forEach(m => m.$?.url && imgs.push(m.$.url));
  const contentFields = [item.content, item.contentEncoded, item.description, item.summary].filter(Boolean);
  for (const c of contentFields) {
    const match = c.match(/<img[^>]+(src|data-src)="([^">]+)"/i);
    if (match && match[2]) imgs.push(match[2]);
  }
  return imgs.find(src => src.startsWith("http")) || "/default-news.jpg";
}

// ---------------- Scrapers for Non-RSS ----------------
async function scrapeRFI() {
  try {
    const res = await axios.get("https://www.rfi.fr/sw/");
    const $ = cheerio.load(res.data);
    const articles = [];
    $("article a").each((i, el) => {
      const link = $(el).attr("href");
      const title = $(el).text().trim();
      if (link && title) {
        articles.push({
          title,
          link: link.startsWith("http") ? link : `https://www.rfi.fr${link}`,
          contentSnippet: "",
          pubDate: new Date().toISOString(),
          source: "RFI Swahili",
          category: "international",
          needsTranslation: false,
          image: "/default-news.jpg"
        });
      }
    });
    return articles.slice(0, 10);
  } catch (err) {
    console.error("RFI scraping error:", err.message);
    return [];
  }
}

async function scrapeBBCSwahili() {
  try {
    const res = await axios.get("https://www.bbc.com/swahili");
    const $ = cheerio.load(res.data);
    const articles = [];
    $("a.gs-c-promo-heading").each((i, el) => {
      const link = $(el).attr("href");
      const title = $(el).text().trim();
      if (link && title) {
        articles.push({
          title,
          link: link.startsWith("http") ? link : `https://www.bbc.com${link}`,
          contentSnippet: "",
          pubDate: new Date().toISOString(),
          source: "BBC Swahili",
          category: "international",
          needsTranslation: false,
          image: "/default-news.jpg"
        });
      }
    });
    return articles.slice(0, 10);
  } catch (err) {
    console.error("BBC Swahili scraping error:", err.message);
    return [];
  }
}

// ---------------- Main Article Fetch ----------------
async function getArticles() {
  const feeds = {
    international: [
      "https://feeds.bbci.co.uk/news/rss.xml",
      "http://rss.cnn.com/rss/edition.rss",
      //"https://feeds.reuters.com/reuters/topNews",
      "https://parstoday.ir/sw/rss",
      "https://www.voaswahili.com/api/z-_ktl-vomx-tperr-r",
      "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
      "https://www.msnbc.com/feeds/latest"
    ],
    sports: [
      "https://www.bbc.com/sport/africa/rss.xml",
      "https://www.espn.com/espn/rss/news"
    ]
  };

  let articles = [];

  // Fetch RSS feeds
  for (const category in feeds) {
    for (const url of feeds[category]) {
      const feed = await fetchFeed(url);
      if (feed.items?.length > 0) {
        articles = articles.concat(feed.items.map(item => ({
          title: item.title || "",
          link: item.link || url,
          contentSnippet: item.contentSnippet || item.description || "",
          pubDate: item.pubDate || new Date().toISOString(),
          source: feed.title || url,
          category,
          needsTranslation: !isSwahili(item.title),
          image: extractImageFromItem(item)
        })));
      }
    }
  }

  // Scrape RFI and BBC Swahili
  const rfiArticles = await scrapeRFI();
  const bbcSwArticles = await scrapeBBCSwahili();
  articles = articles.concat(rfiArticles, bbcSwArticles);

  // Sort by date, latest first
  articles = articles.filter(a => a.pubDate)
                     .sort((a,b) => new Date(b.pubDate) - new Date(a.pubDate))
                     .slice(0, 50);

  // Translate if needed
  await Promise.all(
    articles.map(async a => {
      if (a.needsTranslation) {
        a.title_sw = await translateToSwahili(a.title);
        a.description_sw = await translateToSwahili(a.contentSnippet || a.description || "");
      } else {
        a.title_sw = a.title;
        a.description_sw = a.contentSnippet || a.description || "";
      }
    })
  );

  return articles;
}

// ---------------- Express ----------------
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
