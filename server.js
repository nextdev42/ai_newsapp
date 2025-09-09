import express from "express";
import Parser from "rss-parser";
import translate from "translate";

const app = express();
const parser = new Parser();
app.set("view engine", "ejs");
app.use(express.static("public"));

// Configure translation engine
translate.engine = "google"; // no API key needed

// Translate text to Kiswahili
async function translateToSwahili(text) {
  if (!text || text.trim() === "") return "";
  try {
    const translated = await translate(text, "sw"); // to Swahili
    return translated;
  } catch (error) {
    console.error("Translation error:", error.message, "| Text:", text);
    return text; // fallback
  }
}

// Strip HTML tags
function stripHTML(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>?/gm, "");
}

// Fetch and translate articles
async function getArticles() {
  const cnnFeed = await parser.parseURL("http://rss.cnn.com/rss/edition.rss");
  const aljazeeraFeed = await parser.parseURL("https://www.aljazeera.com/xml/rss/all.xml");

  let articles = [...cnnFeed.items, ...aljazeeraFeed.items].slice(0, 5);

  for (let article of articles) {
    const cleanTitle = stripHTML(article.title);
    const cleanDesc = stripHTML(article.contentSnippet || article.content || article.summary || article.title || "");

    article.title_sw = await translateToSwahili(cleanTitle);
    article.description_sw = await translateToSwahili(cleanDesc);

    // Extract image if available
    article.image =
      article.enclosure?.url || 
      article["media:content"]?.url || 
      article["media:thumbnail"]?.url || 
      null;
  }

  return articles;
}

app.get("/", async (req, res) => {
  const articles = await getArticles();
  res.render("index", { articles });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HabariHub running on port ${PORT}`));
