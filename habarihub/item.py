import scrapy

class NewsItem(scrapy.Item):
    title = scrapy.Field()
    link = scrapy.Field()
    description = scrapy.Field()
    image = scrapy.Field()
    pub_date = scrapy.Field()
    source = scrapy.Field()
