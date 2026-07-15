import assert from "node:assert/strict";
import test from "node:test";
import { parseEvidenceRss } from "../lib/web-evidence";

test("parses cited web evidence from RSS", () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[Market &amp; policy update]]></title><link>https://example.com/update</link><description><![CDATA[Fresh <b>evidence</b> for review.]]></description><pubDate>Wed, 15 Jul 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
  assert.deepEqual(parseEvidenceRss(xml), [{
    title: "Market & policy update",
    url: "https://example.com/update",
    description: "Fresh evidence for review.",
    publishedAt: "Wed, 15 Jul 2026 08:00:00 GMT",
  }]);
});
