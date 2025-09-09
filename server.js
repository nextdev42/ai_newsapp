import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import translate from "translate";

const app = express();
const parser = new Parser();

app.set("view engine", "ejs");
app.use(express.static("public"));

// Configure Google Translate
translate.engine = "google";

// Simple in-memory cache for translations
const translationCache = {};

// Translate text to Swahili with caching
import translate from '@iamtraction/google-translate';

// Tafsiri maandishi kwa Kiswahili
async function translateToSwahili(text) {
  if (!text || text.trim() === '') return '';
  try {
    const res = await translate(text, { to: 'sw' });
    return res.text;
  } catch (error) {
    console.error('Translation error:', error.message, '| Text:', text);
    return text;
  }
}


// Strip HTML tags
function stripHTML(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>?/gm, "");
}

// Fetch RSS feed safely with axios
async function fetchFeed(url) {
  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000
    });
    return await parser.parseString(res.data);
  } catch (err) {
    console.error("Feed fetch error:", err.message, "| URL:", url);
    return { items: [] };
  }
}

// Fetch and process articles from CNN + BBC
async function getArticles() {
  const cnnFeed = await fetchFeed("http://rss.cnn.com/rss/cnn_topstories.rss");
  const bbcFeed = await fetchFeed("https://feeds.bbci.co.uk/news/rss.xml");

  let articles = [...cnnFeed.items, ...bbcFeed.items];

  // Limit to top 20 articles
  articles = articles.slice(0, 20);

  await Promise.all(
    articles.map(async (article) => {
      const cleanTitle = stripHTML(article.title);
      const cleanDesc = stripHTML(
        article.contentSnippet || article.content || article.summary || article.title || ""
      );

      article.title_sw = await translateToSwahili(cleanTitle);
      article.description_sw = await translateToSwahili(cleanDesc);

      // Attach images if available
      if (article.enclosure && article.enclosure.url) {
        article.image = article.enclosure.url;
      } else if (article["media:content"] && article["media:content"].url) {
        article.image = article["media:content"].url;
      } else {
        article.image = null;
      }
    })
  );

  return articles;
}

// Main route
app.get("/", async (req, res) => {
  const articles = await getArticles();
  res.render("index", { articles });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HabariHub running on port ${PORT}`));
