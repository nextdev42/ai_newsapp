import scrapy
from habarihub.items import HabarihubItem

class MwananchiSpider(scrapy.Spider):
    name = "mwananchi"
    allowed_domains = ["mwananchi.co.tz"]
    start_urls = ["https://www.mwananchi.co.tz/mw"]

    custom_settings = {
        "DEFAULT_REQUEST_HEADERS": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9,sw;q=0.8",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": "https://www.google.com/",
        }
    }

    def parse(self, response):
        # Example: Mwananchi homepage headlines
        articles = response.css("div.teaser__content")  # Inspect and adjust

        for article in articles:
            item = HabarihubItem()
            item["title"] = article.css("h2.teaser__title a::text").get(default="").strip()
            item["link"] = response.urljoin(article.css("h2.teaser__title a::attr(href)").get())
            item["summary"] = article.css("p.teaser__text::text").get(default="").strip()
            item["image"] = article.css("figure img::attr(data-src)").get() or article.css("figure img::attr(src)").get()
            yield item
