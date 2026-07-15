import type { Citation, MarketPack } from "./types";

function decode(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function field(item: string, name: string) {
  return decode(item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "");
}

export function parseEvidenceRss(xml: string) {
  return Array.from(xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)).map((match) => ({
    title: field(match[1], "title"),
    url: field(match[1], "link"),
    description: field(match[1], "description"),
    publishedAt: field(match[1], "pubDate"),
  })).filter((item) => item.title && /^https?:\/\//.test(item.url));
}

export async function keylessEvidenceBrief(input: { query: string; agent: string; pack: MarketPack }) {
  const tickers = input.pack.approvedTickers.slice(0, 8).map((item) => item.ticker).join(" ");
  const searchQuery = [input.query, tickers, "stocks markets"].filter(Boolean).join(" ").slice(0, 450);
  const response = await fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(searchQuery)}&format=rss`, {
    headers: { "User-Agent": "Mozilla/5.0 OH-MEGA-Virtual-Fund/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Evidence search returned ${response.status}`);
  const items = parseEvidenceRss(await response.text()).slice(0, 6);
  if (!items.length) throw new Error("Evidence search returned no cited results");
  const citations: Citation[] = items.map((item) => ({ url: item.url, title: item.title, content: item.description }));
  const lines = items.map((item, index) => `${index + 1}. ${item.title}${item.publishedAt ? ` (${new Date(item.publishedAt).toLocaleDateString("en-SG")})` : ""}\n${item.description.slice(0, 280)}`);
  const text = [
    `${input.agent === "risk" ? "Risk" : input.agent === "ceo" ? "CEO" : "Decision"} evidence brief`,
    `Market data is as of ${input.pack.dataAsOf}. The quantitative safety engine currently indicates ${input.pack.mechanicalMode}.`,
    "Current sources surfaced for Human review:",
    ...lines,
    "These search results are evidence inputs. They are not verified facts or a trade instruction. Open the cited sources and review the publication dates before approving a paper allocation.",
  ].join("\n\n");
  return { text, citations, model: "keyless-web-evidence" };
}
