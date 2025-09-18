import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import translate from "@iamtraction/google-translate";

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

// ---------------- Scraper ----------------
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
          needsTranslation: false // Mwananchi is already Swahili
        });
      }
    });

    return articles.slice(0, 20); // return latest 20 articles
  } catch (err) {
    console.error("Mwananchi scraping error:", err.message);
    return [];
  }
}

// ---------------- Express ----------------
app.get("/", async (req, res) => {
  try {
    const articles = await scrapeMwananchi();

    // Optionally translate title/description if needed
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

    res.render("index", { articles });
  } catch (err) {
    console.error("Main route error:", err);
    res.status(500).send("Error loading news articles");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HabariHub running on port ${PORT}`));
