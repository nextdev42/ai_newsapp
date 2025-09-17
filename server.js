// server.js
import express from "express";
import axios from "axios";
import cheerio from "cheerio";
import OpenAI from "openai";

const app = express();
const PORT = 3000;

// ==== OpenAI Config ====
const openai = new OpenAI.OpenAI({
  apiKey: "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",
});

// ==== View Engine ====
app.set("view engine", "ejs");
app.use(express.static("public"));

// ==== Target site (Reuters World News) ====
const TARGET_URL = "https://www.reuters.com/world/";

// Scraper function
async function scrapeNews() {
  try {
    const { data } = await axios.get(TARGET_URL);
    const $ = cheerio.load(data);

    let news = [];

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

    return news.slice(0, 15); // limit top 15
  } catch (err) {
    console.error("Scraping error:", err.message);
    return [];
  }
}

// Translation helper
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
    console.error("Translation error:", err.message);
    return text;
  }
}

// ==== Routes ====

// Homepage => Swahili news
app.get("/", async (req, res) => {
  const news = await scrapeNews();
  const translatedNews = [];

  for (let item of news) {
    const swTitle = await translateText(item.title, "Swahili");
    translatedNews.push({
      original: item.title,
      translated: swTitle,
      link: item.link,
    });
  }

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
  const translatedNews = [];

  for (let item of news) {
    const swTitle = await translateText(item.title, "Swahili");
    translatedNews.push({
      original: item.title,
      translated: swTitle,
      link: item.link,
    });
  }

  res.json(translatedNews);
});

app.listen(PORT, () => {
  console.log(`✅ HabariHub running on http://localhost:${PORT}`);
});
