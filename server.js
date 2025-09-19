import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import translate from "@iamtraction/google-translate";
import * as cheerio from "cheerio";

const app = express();
app.set("view engine", "ejs");
app.use(express.static("public"));

// ---------------- Configuration ----------------
const PORT = process.env.PORT || 3000;
const CACHE_EXPIRY = 30 * 60 * 1000; // 30 min
const REQUEST_TIMEOUT = 20000;
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0"
];

// ---------------- Translation Cache ----------------
const translationCache = {};

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
        console.error("Translation error:", err.message, "| Text:", text);
        return text;
    }
}

// ---------------- Swahili Detection ----------------
function isSwahili(text) {
    if (!text) return false;
    
    const swIndicators = ["ya", "wa", "za", "ku", "na", "ni", "kwa", "haya", "hii", "hili", 
                         "hivi", "mimi", "wewe", "yeye", "sisi", "nyinyi", "wao", "katika",
                         "lakini", "hata", "kama", "baada", "kabla", "bado", "sana", "pia"];
    
    const words = text.toLowerCase().split(/\s+/);
    let count = 0;
    
    for (const word of words) {
        if (swIndicators.includes(word)) count++;
        if (count >= 3) return true;
    }
    
    return false;
}

// ---------------- HTTP Request Utility ----------------
async function makeRequest(url, options = {}) {
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    
    const defaultOptions = {
        timeout: REQUEST_TIMEOUT,
        headers: {
            "User-Agent": userAgent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Referer": "https://www.google.com/",
        }
    };
    
    const finalOptions = { ...defaultOptions, ...options };
    
    try {
        const response = await axios.get(url, finalOptions);
        return response;
    } catch (error) {
        console.error(`Request failed for ${url}:`, error.message);
        
        // Retry with different user agent if 403
        if (error.response && error.response.status === 403) {
            console.log("Retrying with different user agent...");
            finalOptions.headers["User-Agent"] = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
            
            try {
                const retryResponse = await axios.get(url, finalOptions);
                return retryResponse;
            } catch (retryError) {
                console.error(`Retry also failed for ${url}:`, retryError.message);
                throw retryError;
            }
        }
        
        throw error;
    }
}

// ---------------- RSS Parser ----------------
const parser = new Parser({
    timeout: REQUEST_TIMEOUT,
    customFields: {
        item: [
            ["media:content", "mediaContent", { keepArray: true }],
            ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
            ["description", "description"],
            ["content:encoded", "contentEncoded"]
        ]
    }
});

async function fetchFeed(url) {
    try {
        const res = await makeRequest(url);
        return await parser.parseString(res.data);
    } catch (err) {
        console.error("Feed fetch error:", err.message, "| URL:", url);
        return { items: [], title: url, error: err.message };
    }
}

// ---------------- Image Extraction ----------------
function extractImageFromItem(item) {
    let imgs = [];
    
    if (item.enclosure?.url) imgs.push(item.enclosure.url);
    if (Array.isArray(item.mediaContent)) {
        item.mediaContent.forEach(m => m.$?.url && imgs.push(m.$.url));
    }
    if (Array.isArray(item.mediaThumbnail)) {
        item.mediaThumbnail.forEach(m => m.$?.url && imgs.push(m.$.url));
    }
    
    const contentFields = [
        item.content, 
        item.contentEncoded, 
        item.description, 
        item.summary
    ].filter(Boolean);
    
    for (const c of contentFields) {
        try {
            const $ = cheerio.load(c);
            $('img').each((i, el) => {
                const src = $(el).attr('src') || $(el).attr('data-src');
                if (src && src.startsWith('http')) {
                    imgs.push(src);
                }
            });
        } catch (e) {
            // Fallback to regex if cheerio fails
            const matches = c.match(/<img[^>]+(src|data-src)="([^">]+)"/gi) || [];
            matches.forEach(match => {
                const srcMatch = match.match(/(src|data-src)="([^"]+)"/i);
                if (srcMatch && srcMatch[2] && srcMatch[2].startsWith('http')) {
                    imgs.push(srcMatch[2]);
                }
            });
        }
    }
    
    return imgs.find(src => src.startsWith("http")) || "/default-news.jpg";
}

// ---------------- Cheerio Scrapers ----------------
async function scrapeRFI() {
    try {
        const res = await makeRequest("https://www.rfi.fr/sw/");
        const $ = cheerio.load(res.data);
        const articles = [];
        
        $("article").each((i, el) => {
            const $el = $(el);
            const link = $el.find('a').attr('href');
            const title = $el.find('h2, h3, h4').text().trim() || $el.text().trim();
            
            if (link && title) {
                const img = $el.find('img').attr('src') || "/default-news.jpg";
                articles.push({
                    title,
                    link: link.startsWith("http") ? link : `https://www.rfi.fr${link}`,
                    contentSnippet: $el.find('p').text().trim() || "",
                    pubDate: new Date().toISOString(),
                    source: "RFI Swahili",
                    category: "international",
                    needsTranslation: false,
                    image: img.startsWith("http") ? img : `https://www.rfi.fr${img}`
                });
            }
        });
        
        return articles.slice(0, 10);
    } catch (err) {
        console.error("RFI scraping error:", err.message);
        return [];
    }
}

async function scrapeBBCSwahili() {
    try {
        const res = await makeRequest("https://www.bbc.com/swahili");
        const $ = cheerio.load(res.data);
        const articles = [];
        
        $('[data-testid="hard-news-unit"], .gs-c-promo').each((i, el) => {
            const $el = $(el);
            const link = $el.find('a').attr('href');
            const title = $el.find('h2, h3, h4, p').first().text().trim();
            
            if (link && title) {
                const img = $el.find('img').attr('src') || "/default-news.jpg";
                articles.push({
                    title,
                    link: link.startsWith("http") ? link : `https://www.bbc.com${link}`,
                    contentSnippet: $el.find('p').text().trim() || "",
                    pubDate: new Date().toISOString(),
                    source: "BBC Swahili",
                    category: "international",
                    needsTranslation: false,
                    image: img.startsWith("http") ? img : `https://www.bbc.com${img}`
                });
            }
        });
        
        return articles.slice(0, 10);
    } catch (err) {
        console.error("BBC Swahili scraping error:", err.message);
        return [];
    }
}

// ---------------- Article Processing ----------------
async function processFeedItems(feed, category, url) {
    if (!feed.items || feed.items.length === 0) return [];
    
    return Promise.all(
        feed.items.map(async (item) => {
            const needsTranslation = !isSwahili(item.title);
            
            let title_sw = item.title;
            let description_sw = item.contentSnippet || item.description || "";
            
            if (needsTranslation) {
                title_sw = await translateToSwahili(item.title);
                description_sw = await translateToSwahili(description_sw);
            }
            
            return {
                title: item.title || "",
                title_sw,
                link: item.link || url,
                contentSnippet: item.contentSnippet || item.description || "",
                description_sw,
                pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
                source: feed.title || url,
                category,
                needsTranslation,
                image: extractImageFromItem(item)
            };
        })
    );
}

// ---------------- Main Article Fetch ----------------
async function getArticles() {
    const feeds = {
        international: [
            "https://feeds.bbci.co.uk/news/rss.xml",
            "http://rss.cnn.com/rss/edition.rss",
            "https://rss.dw.com/rdf/rss-kis-all",
            "https://parstoday.ir/sw/rss",
            "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
            "https://www.msnbc.com/feeds/latest"
        ],
        sports: [
            "https://www.bbc.com/sport/africa/rss.xml",
            "https://www.espn.com/espn/rss/news"
        ]
    };

    let articles = [];
    const feedPromises = [];

    // Fetch RSS feeds
    for (const category in feeds) {
        for (const url of feeds[category]) {
            feedPromises.push(
                fetchFeed(url)
                    .then(feed => processFeedItems(feed, category, url))
                    .then(items => articles = articles.concat(items))
                    .catch(err => {
                        console.error(`Error processing feed ${url}:`, err.message);
                        return [];
                    })
            );
        }
    }

    // Cheerio scrape for RFI and BBC Swahili
    feedPromises.push(
        scrapeRFI().then(items => articles = articles.concat(items))
    );
    feedPromises.push(
        scrapeBBCSwahili().then(items => articles = articles.concat(items))
    );

    await Promise.allSettled(feedPromises);

    // Sort by date and limit to 50 articles
    articles = articles
        .filter(a => a.pubDate)
        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
        .slice(0, 50);

    return articles;
}

// ---------------- Express Routes ----------------
app.get("/", async (req, res) => {
    try {
        const articles = await getArticles();
        res.render("index", { articles });
    } catch (err) {
        console.error("Main route error:", err);
        res.status(500).render("error", { 
            message: "Error loading news articles",
            error: err.message
        });
    }
});

app.get("/api/articles", async (req, res) => {
    try {
        const articles = await getArticles();
        res.json({ articles });
    } catch (err) {
        console.error("API route error:", err);
        res.status(500).json({ 
            error: "Failed to fetch articles",
            message: err.message 
        });
    }
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`HabariHub running on port ${PORT}`);
});

export default app;
