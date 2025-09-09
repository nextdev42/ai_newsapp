import express from "express";
import Parser from "rss-parser";
import translate from "translate";

const app = express();
const parser = new Parser();
app.set("view engine", "ejs");
app.use(express.static("public"));

// Configure Google Translate
translate.engine = "google";

// Translate text to Kiswahili
async function translateToSwahili(text) {
  if (!text || text.trim() === "") return "";
  try {
    const translated = await translate(text, "sw"); // to Swahili
    return translated;
  } catch (error) {
    console.error("Translation error:", error.message, "| Text:", text);
    return text;
  }
}

// Strip HTML tags
function stripHTML(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>?/gm, "");
}

// Fetch and translate articles
async function getArticles() {
  const cnnFeed = await parser.parseURL("http://rss.cnn.com/rss/cnn_topstories.rss");
  const aljazeeraFeed = await parser.parseURL("https://www.aljazeera.com/xml/rss/all.xml");

  let articles = [...cnnFeed.items, ...aljazeeraFeed.items].slice(0, 5);

  for (let article of articles) {
    const cleanTitle = stripHTML(article.title);
    const cleanDesc = stripHTML(
      article.contentSnippet || article.content || article.summary || article.title || ""
    );

    article.title_sw = await translateToSwahili(cleanTitle);
    article.description_sw = await translateToSwahili(cleanDesc);

    // Include image if available
    if (article.enclosure && article.enclosure.url) {
      article.image = article.enclosure.url;
    } else if (article["media:content"] && article["media:content"].url) {
      article.image = article["media:content"].url;
    } else {
      article.image = null;
    }
  }

  return articles;
}

app.get("/", async (req, res) => {
  const articles = await getArticles();
  res.render("index", { articles });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HabariHub running on port ${PORT}`));
