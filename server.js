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
    const translated = await translate(text, "sw"); // Swahili
    return translated;
  } catch (error) {
    console.error("Translation error:", error.message, "| Text:", text);
    return text;
  }
}

// Strip HTML
function stripHTML(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>?/gm, "");
}

// Fetch and translate articles from CNN + BBC
async function getArticles() {
  let articles = [];

  // CNN Top Stories
  try {
    const cnnFeed = await parser.parseURL("http://rss.cnn.com/rss/cnn_topstories.rss");
    articles = articles.concat(cnnFeed.items);
  } catch (err) {
    console.error("CNN feed error:", err.message);
  }

  // BBC Top Stories
  try {
    const bbcFeed = await parser.parseURL("http://feeds.bbci.co.uk/news/rss.xml");
    articles = articles.concat(bbcFeed.items);
  } catch (err) {
    console.error("BBC feed error:", err.message);
  }

  // Limit to top 10
  articles = articles.slice(0, 10);

  // Translate and attach images
  for (let article of articles) {
    const cleanTitle = stripHTML(article.title);
    const cleanDesc = stripHTML(
      article.contentSnippet || article.content || article.summary || article.title || ""
    );

    article.title_sw = await translateToSwahili(cleanTitle);
    article.description_sw = await translateToSwahili(cleanDesc);

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

// Route
app.get("/", async (req, res) => {
  const articles = await getArticles();
  res.render("index", { articles });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HabariHub running on port ${PORT}`));
