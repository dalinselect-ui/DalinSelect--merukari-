import * as cheerio from "cheerio";

function parseItemId(input) {
  try {
    const u = new URL(input);
    if (u.hostname !== "jp.mercari.com") return null;
    const m = u.pathname.match(/^\/item\/(m\d+)\/?$/i);
    return m?.[1] || null;
  } catch { return null; }
}

function feeFor(yen) {
  if (yen <= 2999) return 150;
  if (yen <= 9999) return 250;
  if (yen <= 29999) return 350;
  return Math.ceil((yen * 0.24 * 0.05) / 10) * 10;
}

function quote(yen) {
  const itemTwd = Math.ceil((yen * 0.24) / 10) * 10;
  const fee = feeFor(yen);
  return { rate: 0.24, itemTwd, fee, total: itemTwd + fee };
}

function extractJsonLd($) {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const raw = JSON.parse($(el).text());
      const nodes = Array.isArray(raw) ? raw : [raw];
      for (const x of nodes) {
        if (!x) continue;
        const offers = Array.isArray(x.offers) ? x.offers[0] : (x.offers || {});
        const price = Number(offers?.price ?? x.price);
        if (x.name && Number.isFinite(price)) {
          return {
            title: x.name,
            image: Array.isArray(x.image) ? x.image[0] : x.image,
            yen: price,
            availability: offers?.availability || ""
          };
        }
      }
    } catch {}
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const input = String(req.body?.url || "").trim();
  const itemId = parseItemId(input);
  if (!itemId) return res.status(400).json({ error: "請貼上有效的 Mercari 日本商品網址" });

  // Reconstruct canonical URL instead of fetching arbitrary user-provided URLs.
  const url = `https://jp.mercari.com/item/${itemId}`;

  try {
    const r = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        "accept-language": "ja-JP,ja;q=0.9,en;q=0.7"
      },
      redirect: "follow"
    });

    if (!r.ok) throw new Error(`Mercari HTTP ${r.status}`);
    const html = await r.text();
    const $ = cheerio.load(html);
    const ld = extractJsonLd($);

    const title = ld?.title || $('meta[property="og:title"]').attr("content") || $("title").text().trim();
    const image = ld?.image || $('meta[property="og:image"]').attr("content") || "";
    let yen = ld?.yen;

    if (!Number.isFinite(yen)) {
      const candidates = [
        $('meta[property="product:price:amount"]').attr("content"),
        $('meta[name="twitter:data1"]').attr("content")
      ];
      for (const c of candidates) {
        const m = String(c || "").match(/([\d,]+)/);
        if (m) { yen = Number(m[1].replaceAll(",", "")); break; }
      }
    }

    if (!Number.isFinite(yen)) {
      const m = $("body").text().match(/¥\s*([\d,]+)/);
      if (m) yen = Number(m[1].replaceAll(",", ""));
    }

    const availability = String(ld?.availability || "");
    const bodyText = $("body").text();
    let status = "unknown";
    if (/OutOfStock|SoldOut/i.test(availability) || /売り切れ|SOLD/i.test(bodyText)) status = "sold";
    else if (/InStock/i.test(availability)) status = "available";

    if (!Number.isFinite(yen)) {
      return res.status(422).json({
        error: "已辨識 Mercari 商品，但目前無法自動讀取價格",
        itemId, title, image, status
      });
    }

    return res.status(200).json({
      itemId, url, title, image, yen, status,
      sold: status === "sold",
      ...quote(yen)
    });
  } catch (e) {
    return res.status(502).json({
      error: "目前無法從 Mercari 取得商品資料",
      detail: e?.message || "Unknown error",
      itemId
    });
  }
}
