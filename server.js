import express from "express";
import axios from "axios";
import translate from "@iamtraction/google-translate";
import * as cheerio from "cheerio";

const app = express();
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

// ---------------- Helper to scrape articles ----------------
async function scrapeSite(url, articleSelector, titleSelector, linkSelector, descSelector, imgSelector, siteName, category) {
  try {
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 15000 });
    const $ = cheerio.load(data);
    const articles = [];
    $(articleSelector).each((i, el) => {
      const title = $(el).find(titleSelector).first().text().trim();
      const link = $(el).find(linkSelector).first().attr("href");
      if (!title || !link || title.length < 10) return;
      const fullUrl = link.startsWith("http") ? link : `${url}${link.startsWith("/") ? "" : "/"}${link}`;
      let description = $(el).find(descSelector).first().text().trim() || `Habari kutoka ${siteName}`;
      let image = $(el).find(imgSelector).first().attr("src") || $(el).find(imgSelector).first().attr("data-src");
      if (image && !image.startsWith("http")) image = `${url}${image.startsWith("/") ? "" : "/"}${image}`;
      articles.push({
        title,
        link: fullUrl,
        contentSnippet: description,
        pubDate: new Date().toISOString(),
        source: siteName,
        category,
        needsTranslation: !isSwahili(title),
        image: image || null
      });
    });
    return articles.slice(0, 5);
  } catch (err) {
    console.error(`${siteName} scraping error:`, err.message);
    return [];
  }
}

// ---------------- All Scrapers ----------------
async function scrapeAllNews() {
  const allArticles = await Promise.all([
    scrapeSite("https://www.thecitizen.co.tz", ".article-item, .news-item", "h2, h3, .title", "a", "p, .summary", "img", "The Citizen Tanzania", "tanzania"),
    scrapeSite("https://www.theeastafrican.co.ke", ".story, .article", "h1, h2, h3, .title", "a", "p, .summary", "img", "The East African", "eastAfrica"),
    scrapeSite("https://edition.cnn.com/world", ".cd__content", ".cd__headline-text", "a", ".cd__description", "img", "CNN", "international"),
    scrapeSite("https://www.reuters.com/world/", ".story-content, .story", "h3, h2", "a", "p", "img", "Reuters", "international"),
    scrapeSite("https://www.bbc.com/news", ".gs-c-promo", "h3", "a", "p", "img", "BBC", "international")
  ]);

  let articles = allArticles.flat();

  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 48*60*60*1000);
  articles = articles.filter(a => a.pubDate && new Date(a.pubDate) > twoDaysAgo);

  articles.sort((a,b) => new Date(b.pubDate) - new Date(a.pubDate));
  articles = articles.slice(0,30);
  articles.forEach(a => { if (!a.image) a.image = "/default-news.jpg"; });

  await Promise.all(articles.map(async a => {
    if (a.needsTranslation) {
      const cleanTitle = stripHTML(a.title || "");
      const cleanDesc = stripHTML(a.contentSnippet || "");
      a.title_sw = await translateToSwahili(cleanTitle);
      a.description_sw = await translateToSwahili(cleanDesc.slice(0,200) || "Hakuna maelezo");
    } else {
      a.title_sw = a.title;
      a.description_sw = a.contentSnippet || "Hakuna maelezo";
    }
  }));

  return articles;
}

// ---------------- Express ----------------
app.get("/", async (req,res) => {
  try {
    const articles = await scrapeAllNews();
    res.render("index", { articles });
  } catch (err) {
    console.error("Main route error:", err);
    res.status(500).send("Error loading news articles");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HabariHub running on port ${PORT}`));
