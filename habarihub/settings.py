ITEM_PIPELINES = {
    "habarihub.pipelines.HabarihubPipeline": 300,
}
# Enable downloader middlewares
DOWNLOADER_MIDDLEWARES = {
    "scrapy.downloadermiddlewares.useragent.UserAgentMiddleware": None,
    "scrapy_user_agents.middlewares.RandomUserAgentMiddleware": 400,
}

# Optional: retry if blocked
RETRY_ENABLED = True
RETRY_TIMES = 3
