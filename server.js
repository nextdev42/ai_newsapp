import express from "express";
import axios from "axios";
import { load } from "cheerio";
import OpenAI from "openai";
import winston from "winston";
import path from "path";

// ===== Winston Logger Setup =====
const logDir = "logs";
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(
      (info) => `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(logDir, "habarihub.log") })
  ],
});

// ===== Express + OpenAI Setup =====
const app = express();
const PORT = 3000;

const openai = new OpenAI.OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===== View Engine =====
app.set("view engine", "ejs");
app.use(express.static("public"));

// ===== Target Site =====
const TARGET_URL = "https://www.reuters.com/world/";

// ===== Scraper =====
async function scrapeNews() {
  try {
    const { data } = await axios.get(TARGET_URL);
    const $ = load(data);

    const news = [];

    $("article.story-card, div.story-content, div.media-story-card__body").each((i, el) => {
      const title = $(el).find("h2, h3").text().trim();
      const link = $(el).find("a").attr("href");

      if (title && link) {
        news.push({
          title,
          link: link.startsWith("http") ? link : `https://www.reuters.com${link}`,
        });
      }
    });

    return news.slice(0, 15);
  } catch (err) {
    logger.error(`Scraping error: ${err.message}`);
    return [];
  }
}

// ===== Translator =====
async function translateText(text, targetLang = "sw") {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You are a translator that translates text into ${targetLang}.` },
        { role: "user", content: text },
      ],
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    logger.error(`Translation error: ${err.message} | Text: ${text}`);
    return text; // fallback
  }
}

// ===== Routes =====

// Homepage => Swahili news
app.get("/", async (req, res) => {
  const news = await scrapeNews();

  // Translate in parallel for speed
  const translatedNews = await Promise.all(
    news.map(async (item) => ({
      original: item.title,
      translated: await translateText(item.title, "Swahili"),
      link: item.link,
    }))
  );

  res.render("index", { articles: translatedNews });
});

// Raw JSON (English)
app.get("/news", async (req, res) => {
  const news = await scrapeNews();
  res.json(news);
});

// Raw JSON (Swahili)
app.get("/news/sw", async (req, res) => {
  const news = await scrapeNews();
  const translatedNews = await Promise.all(
    news.map(async (item) => ({
      original: item.title,
      translated: await translateText(item.title, "Swahili"),
      link: item.link,
    }))
  );
  res.json(translatedNews);
});

  app.get("/check-key", (req, res) => {
  if (process.env.OPENAI_API_KEY) {
    res.send("✅ OPENAI_API_KEY is set");
  } else {
    res.status(500).send("❌ OPENAI_API_KEY is missing");
  }
});
app.get("/test-translate", async (req, res) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "Translate to Swahili" },
        { role: "user", content: "Hello world" }
      ]
    });
    res.send(response.choices[0].message.content);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});
// Start server
app.listen(PORT, () => {
  logger.info(`HabariHub running on http://localhost:${PORT}`);
});
