const express = require('express');
const Parser = require('rss-parser');
const axios = require('axios');

const app = express();
const parser = new Parser();
app.set('view engine', 'ejs');
app.use(express.static('public'));

// Function to translate text to Kiswahili using LibreTranslate
async function translateToSwahili(text) {
  try {
    const response = await axios.post('https://libretranslate.com/translate', {
      q: text,
      source: 'en',
      target: 'sw',
      format: 'text'
    }, {
      headers: { 'accept': 'application/json' }
    });
    return response.data.translatedText;
  } catch (error) {
    console.error('Translation error:', error.message);
    return text; // Return original if translation fails
  }
}

// Function to get RSS feeds and translate titles/descriptions
async function getArticles() {
  const cnnFeed = await parser.parseURL('http://rss.cnn.com/rss/edition.rss');
  const aljazeeraFeed = await parser.parseURL('https://www.aljazeera.com/xml/rss/all.xml');

  let articles = [...cnnFeed.items, ...aljazeeraFeed.items];

  // Take top 5 articles for prototype
  articles = articles.slice(0, 5);

  // Translate articles to Kiswahili
  for (let article of articles) {
    article.title_sw = await translateToSwahili(article.title);
    article.description_sw = await translateToSwahili(article.contentSnippet || article.content || '');
  }

  return articles;
}

app.get('/', async (req, res) => {
  const articles = await getArticles();
  res.render('index', { articles });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HabariHub server running on port ${PORT}`));
