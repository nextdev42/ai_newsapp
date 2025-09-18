import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import translate from "@iamtraction/google-translate";
import * as cheerio from "cheerio";

const app = express();
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

app.set("view engine", "ejs");
app.use(express.static("public"));

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
    console.error("Translation error:", err.message, "| Text:", text);
    return text;
  }
}

function isSwahili(text) {
  if (!text) return false;
  const swahiliIndicators = ["ya","wa","za","ku","na","ni","kwa","haya","hii","hili","hivi","mimi","wewe","yeye","sisi","nyinyi","wao","huko","hapa","pale","lakini","au","ama","basi","bila","kama","kwenye","katika","kutoka"];
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

// ---------------- Feed Fetching ----------------
async function fetchFeed(url) {
  try {
    console.log(`Fetching feed from: ${url}`);
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
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

function extractImageFromItem(item) {
  let imageSources = [];
  if (item.enclosure?.url) imageSources.push(item.enclosure.url);
  if (Array.isArray(item.mediaContent)) item.mediaContent.forEach(m => { if (m.$?.url) imageSources.push(m.$.url); });
  if (Array.isArray(item.mediaThumbnail)) item.mediaThumbnail.forEach(m => { if (m.$?.url) imageSources.push(m.$.url); });

  const contentFields = [item.content, item.contentEncoded, item.description, item.summary].filter(Boolean);
  for (const content of contentFields) {
    const imgMatch = content.match(/<img[^>]+(src|data-src)="([^">]+)"/i);
    if (imgMatch && imgMatch[2]) imageSources.push(imgMatch[2]);
  }
  const validImage = imageSources.find(src => src.startsWith("http") && (/\.(jpg|jpeg|png|gif|webp)/i.test(src) || src.includes("image")));
  return validImage || null;
}

// ---------------- Scrapers ----------------
async function scrapeTanzaniaNews() {
  try {
    const { data } = await axios.get("https://www.thecitizen.co.tz", { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 15000 });
    const $ = cheerio.load(data);
    const articles = [];
    $(".article-item, .news-item, .post-item, .story-item").each((i, el) => {
      const title = $(el).find("h2, h3, .title, .headline").first().text().trim();
      const link = $(el).find("a").first().attr("href");
      if (title && link && title.length > 10) {
        const fullUrl = link.startsWith("http") ? link : `https://www.thecitizen.co.tz${link.startsWith("/") ? link : "/" + link}`;
        let description = $(el).find("p, .summary, .excerpt, .description").first().text().trim() || "Habari za Tanzania kutoka The Citizen";
        let image = $(el).find("img").first().attr("src") || $(el).find("img").first().attr("data-src");
        if (image && !image.startsWith("http")) image = `https://www.thecitizen.co.tz${image.startsWith("/") ? image : "/" + image}`;
        articles.push({ title, link: fullUrl, contentSnippet: description, pubDate: new Date().toISOString(), source: "The Citizen Tanzania", category: "tanzania", needsTranslation: !isSwahili(title), image: image || null });
      }
    });
    return articles.slice(0, 5);
  } catch (err) {
    console.error("Tanzania scraping error:", err.message);
    return [];
  }
}

async function scrapeEastAfricaNews() {
  try {
    const { data } = await axios.get("https://www.theeastafrican.co.ke", { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 15000 });
    const $ = cheerio.load(data);
    const articles = [];
    $(".story, .article, .news-item, .headline").each((i, el) => {
      const title = $(el).find("h1, h2, h3, .title").first().text().trim();
      const link = $(el).find("a").first().attr("href");
      if (title && link && title.length > 10) {
        const fullUrl = link.startsWith("http") ? link : `https://www.theeastafrican.co.ke${link.startsWith("/") ? link : "/" + link}`;
        let description = $(el).find("p, .summary").first().text().trim() || "Habari za Afrika Mashariki kutoka The East African";
        let image = $(el).find("img").first().attr("src") || $(el).find("img").first().attr("data-src");
        if (image && !image.startsWith("http")) image = `https://www.theeastafrican.co.ke${image.startsWith("/") ? image : "/" + image}`;
        articles.push({ title, link: fullUrl, contentSnippet: description, pubDate: new Date().toISOString(), source: "The East African", category: "eastAfrica", needsTranslation: !isSwahili(title), image: image || null });
      }
    });
    return articles.slice(0, 5);
  } catch (err) {
    console.error("East Africa scraping error:", err.message);
    return [];
  }
}

// ---------------- Main Fetch ----------------
async function getArticles() {
  const feedCategories = {
    international: ["https://feeds.bbci.co.uk/news/rss.xml","http://rss.cnn.com/rss/edition.rss","https://feeds.reuters.com/reuters/topNews"],
    sports: ["https://www.bbc.com/sport/africa/rss.xml","https://www.goal.com/rss"]
  };
  let articles = [];
  for (const category in feedCategories) {
    for (const url of feedCategories[category]) {
      const feed = await fetchFeed(url);
      if (feed.items?.length > 0) {
        articles = articles.concat(feed.items.map(item => ({...item, source: feed.title || url, sourceUrl: url, category, needsTranslation: true, image: extractImageFromItem(item)})));
      }
    }
  }
  const [tanzania, eastAfrica] = await Promise.all([scrapeTanzaniaNews(), scrapeEastAfricaNews()]);
  articles = articles.concat(tanzania, eastAfrica);

  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 48*60*60*1000);
  articles = articles.filter(a => a.pubDate && new Date(a.pubDate) > twoDaysAgo);

  articles.sort((a,b) => new Date(b.pubDate) - new Date(a.pubDate));
  articles = articles.slice(0,30);
  articles.forEach(a => { if (!a.image) a.image = "/default-news.jpg"; });

  await Promise.all(articles.map(async a => {
    if (a.needsTranslation) {
      const cleanTitle = stripHTML(a.title || "");
      const cleanDesc = stripHTML(a.contentSnippet || a.content || a.summary || a.description || "");
      a.title_sw = await translateToSwahili(cleanTitle);
      a.description_sw = await translateToSwahili(cleanDesc.slice(0,200) || "Hakuna maelezo");
    } else {
      a.title_sw = a.title;
      a.description_sw = a.contentSnippet || a.description || "Hakuna maelezo";
    }
  }));

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
