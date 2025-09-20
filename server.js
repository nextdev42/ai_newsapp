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
const CACHE_EXPIRY = 30 * 60 * 1000; // 30 min cache
const REQUEST_TIMEOUT = 25000;
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0"
];

// ---------------- Caches ----------------
const translationCache = {};
const feedCache = {
    data: [],
    lastUpdated: 0,
    isUpdating: false
};

// ---------------- Utility Functions ----------------
function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function makeRequest(url, options = {}) {
    const userAgent = getRandomUserAgent();
    const defaultOptions = {
        timeout: REQUEST_TIMEOUT,
        headers: { "User-Agent": userAgent }
    };
    const finalOptions = { ...defaultOptions, ...options };

    try {
        const response = await axios.get(url, finalOptions);
        return response;
    } catch (error) {
        console.error(`Request failed for ${url}:`, error.message);
        throw error;
    }
}

// ---------------- Translation Functions ----------------
async function translateToSwahili(text) {
    if (!text || text.trim() === "") return "Hakuna maelezo";

    const now = Date.now();
    if (translationCache[text] && now - translationCache[text].timestamp < CACHE_EXPIRY) {
        return translationCache[text].translation;
    }

    try {
        const cleanText = text.replace(/[^\w\s.,!?;:'"-]/gi, "").trim();
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

function isSwahili(text) {
    if (!text) return false;
    const swIndicators = ["ya", "wa", "za", "ku", "na", "ni", "kwa", "hii", "hili", "mimi", "wewe", "yeye", "sisi"];
    const words = text.toLowerCase().split(/\s+/);
    let count = 0;
    for (const word of words) {
        if (swIndicators.includes(word)) count++;
        if (count >= 3) return true;
    }
    return false;
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
    const contentFields = [item.content, item.contentEncoded, item.description, item.summary].filter(Boolean);
    for (const c of contentFields) {
        try {
            const $ = cheerio.load(c);
            $("img").each((i, el) => {
                const src = $(el).attr("src") || $(el).attr("data-src");
                if (src && src.startsWith("http")) imgs.push(src);
            });
        } catch {}
    }
    return imgs.find(src => src.startsWith("http")) || "/default-news.jpg";
}

// ---------------- Scrapers ----------------
async function scrapeRFI() { /* unchanged */ }
async function scrapeVOASwahili() { /* unchanged */ }
async function scrapeAlJazeera() { /* unchanged */ }

// ---------------- Fallback Feeds ----------------
function getFallbackArticles() {
    return [{
        title: "Habari za Kiswahili",
        title_sw: "Habari za Kiswahili",
        contentSnippet: "Karibu kwenye tovuti yetu ya habari za Kiswahili",
        description_sw: "Karibu kwenye tovuti yetu ya habari za Kiswahili",
        pubDate: new Date().toISOString(),
        source: "HabariHub",
        category: "international",
        link: "#",
        image: "/default-news.jpg",
        needsTranslation: false
    }];
}

// ---------------- Article Processing ----------------
async function processFeedItems(feed, category, url) {
    if (!feed.items || feed.items.length === 0) return [];
    return Promise.all(feed.items.slice(0, 5).map(async item => {
        const needsTranslation = !isSwahili(item.title);
        let title_sw = item.title;
        let description_sw = item.contentSnippet || item.description || "";
        if (needsTranslation) {
            try {
                title_sw = await translateToSwahili(item.title);
                description_sw = await translateToSwahili(description_sw);
            } catch {}
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
    }));
}

// ---------------- Main Article Fetch ----------------
async function getArticles() {
    if (Date.now() - feedCache.lastUpdated < CACHE_EXPIRY && !feedCache.isUpdating) {
        return feedCache.data;
    }
    feedCache.isUpdating = true;

    const feeds = {
        international: [
            "https://feeds.bbci.co.uk/news/rss.xml",
            "http://rss.cnn.com/rss/edition.rss"
        ],
        sports: [
            "https://www.bbc.com/sport/africa/rss.xml",
            "https://www.espn.com/espn/rss/news"
        ],
        swahili: [
            "https://feeds.bbci.co.uk/swahili/rss.xml",
            "https://rss.dw.com/rdf/rss-kis-all",
            "https://www.voaswahili.com/api/zkgoqpl-vomx-tpejmmqp"
        ]
    };

    let articles = [];
    const feedPromises = [];
    for (const category in feeds) {
        for (const url of feeds[category]) {
            feedPromises.push(
                fetchFeed(url)
                    .then(feed => processFeedItems(feed, category, url))
                    .then(items => articles = articles.concat(items))
                    .catch(() => [])
            );
        }
    }
    feedPromises.push(scrapeRFI().then(items => articles = articles.concat(items)));
    feedPromises.push(scrapeVOASwahili().then(items => articles = articles.concat(items)));
    feedPromises.push(scrapeAlJazeera().then(items => articles = articles.concat(items)));

    try {
        await Promise.allSettled(feedPromises);
        articles = articles
            .filter(a => a.pubDate)
            .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
            .slice(0, 50);
        if (articles.length < 5) {
            articles = articles.concat(getFallbackArticles());
        }
        feedCache.data = articles;
        feedCache.lastUpdated = Date.now();
        return articles;
    } finally {
        feedCache.isUpdating = false;
    }
}

// ---------------- Express Routes ----------------
app.get("/", async (req, res) => {
    try {
        const articles = await getArticles();
        res.render("index", { articles });
    } catch {
        res.status(500).render("error", { message: "Error loading news articles" });
    }
});

app.get("/api/articles", async (req, res) => {
    try {
        const articles = await getArticles();
        res.json({ articles });
    } catch {
        res.status(500).json({ error: "Failed to fetch articles" });
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`HabariHub running on port ${PORT}`);
});

export default app;
