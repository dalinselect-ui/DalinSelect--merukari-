import * as cheerio from "cheerio";

export function parseItemId(input) {
  try {
    const u = new URL(input);
    if (u.protocol !== "https:" || u.hostname !== "jp.mercari.com" || u.port || u.username || u.password) return null;
    return u.pathname.match(/^\/item\/(m\d+)\/?$/)?.[1] || null;
  } catch { return null; }
}

function priceYen(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) return null;
  const price = Number(String(value).replaceAll(",", ""));
  return Number.isSafeInteger(price) && price > 0 ? price : null;
}

function availability(value) {
  const name = String(value || "").replace(/^https?:\/\/schema\.org\//, "");
  if (name === "InStock") return "available";
  if (["OutOfStock", "SoldOut", "Discontinued"].includes(name)) return "sold";
  return "unknown";
}

function safeImage(value) {
  const image = Array.isArray(value) ? value[0] : value;
  try { return new URL(image).protocol === "https:" ? image : ""; }
  catch { return ""; }
}

function identity(value) {
  if (typeof value !== "string") return null;
  return /^m\d+$/.test(value) ? value : parseItemId(value);
}

export function extractItem(html, itemId) {
  const $ = cheerio.load(html);
  const candidates = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    if (types.includes("Product")) {
      const offers = Array.isArray(node.offers) ? node.offers : [node.offers];
      for (const offer of offers) {
        if (!offer || typeof offer !== "object") continue;
        const ids = [node.sku, node.productID, node.url, node["@id"], offer.url].map(identity).filter(Boolean);
        if (!ids.includes(itemId) || ids.some(id => id !== itemId)) continue;
        candidates.push({ title: typeof node.name === "string" ? node.name : "", image: safeImage(node.image), yen: offer.priceCurrency === "JPY" ? priceYen(offer.price) : null, status: availability(offer.availability), source: "product-json-ld" });
      }
    }
    for (const child of Object.values(node)) visit(child);
  }
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try { visit(JSON.parse($(el).text())); } catch { /* Missing or malformed data cannot authorize a quote. */ }
  }
  if (!candidates.length) return null;
  const first = candidates[0];
  if (candidates.some(x => x.yen !== first.yen || x.status !== first.status)) return null;
  return first;
}

function quote(yen) {
  const itemTwd = Math.ceil((yen * 0.24) / 10) * 10;
  const fee = yen <= 2999 ? 150 : yen <= 9999 ? 250 : yen <= 29999 ? 350 : Math.ceil((yen * 0.24 * 0.05) / 10) * 10;
  return { rate: 0.24, itemTwd, fee, total: itemTwd + fee };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  // Quotes contain public product data; Shopify storefronts can call this API directly.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const itemId = parseItemId(String(req.body?.url || "").trim());
  if (!itemId) return res.status(400).json({ error: "請貼上有效的 Mercari 日本商品網址" });
  const url = "https://jp.mercari.com/item/" + itemId;
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "accept-language": "ja-JP,ja;q=0.9" },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000)
    });
    if (r.status === 404 || r.status === 410) return res.status(422).json({ error: "無法報價：商品已刪除或不存在", itemId, status: "unknown" });
    if (!r.ok) throw new Error("Mercari HTTP " + r.status);
    const item = extractItem(await r.text(), itemId);
    if (!item || item.yen === null || item.status === "unknown" || !item.title.trim()) {
      return res.status(422).json({ error: "無法報價：無法確認此商品的價格與販售狀態，商品可能已刪除或資料暫時無法讀取", itemId, status: "unknown" });
    }
    if (item.status === "sold") return res.status(422).json({ error: "無法報價：此商品已售出或已下架", itemId, status: "sold", sold: true });
    return res.status(200).json({ itemId, url, ...item, sold: false, ...quote(item.yen) });
  } catch {
    return res.status(502).json({ error: "無法報價：目前無法從 Mercari 取得商品資料，請稍後再試", itemId });
  }
}
