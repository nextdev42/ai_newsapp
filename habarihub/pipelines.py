import json
import os

class HabarihubPipeline:
    def open_spider(self, spider):
        # Path to the output file (project root where scrapy.cfg is located)
        base_dir = os.path.dirname(os.path.abspath(os.path.join(__file__, "../..")))
        self.file_path = os.path.join(base_dir, "mwananchi.json")

        # Open file for writing
        self.file = open(self.file_path, "w", encoding="utf-8")
        self.file.write("[")  # start JSON array
        self.first_item = True

    def close_spider(self, spider):
        # Close JSON array and file
        self.file.write("]")
        self.file.close()

    def process_item(self, item, spider):
        # Ensure valid JSON
        line = json.dumps(dict(item), ensure_ascii=False)

        # Add comma if not first
        if not self.first_item:
            self.file.write(",\n")
        else:
            self.first_item = False

        self.file.write(line)
        return item
