const express = require('express');
const Parser = require('rss-parser');
const translate = require('@vitalets/google-translate-api');

const app = express();
const parser = new Parser();
app.set('view engine', 'ejs');
app.use(express.static('public'));

// Function to translate text to Kiswahili
async function translateToSwahili(text) {
  if (!text || text.trim() === '') return '';

  try {
    const res = await translate(text, { from: 'en', to: 'sw' });
    return res.text || text;
  } catch (error) {
    console.error('Translation error:', error.message);
    return text; // fallback
  }
}

// Strip HTML tags
function stripHTML(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, '');
}

// Limit text length (optional)
function truncateText(text, maxLength = 500) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

// Fetch and translate articles
async function getArticles() {
  const cnnFeed = await parser.parseURL('http://rss.cnn.com/rss/edition.rss');
  const aljazeeraFeed = await parser.parseURL('https://www.aljazeera.com/xml/rss/all.xml');

  let articles = [...cnnFeed.items, ...aljazeeraFeed.items].slice(0, 5);

  // Translate articles in parallel
  await Promise.all(
    articles.map(async (article) => {
      const cleanTitle = truncateText(stripHTML(article.title));
      const cleanDesc = truncateText(stripHTML(article.contentSnippet || article.content || ''));

      article.title_sw = await translateToSwahili(cleanTitle);
      article.description_sw = await translateToSwahili(cleanDesc);
    })
  );

  return articles;
}

app.get('/', async (req, res) => {
  const articles = await getArticles();
  res.render('index', { articles });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HabariHub running on port ${PORT}`));
