import { fetchQuote } from "./quote.js";

const SHOP = "ebhfru-de.myshopify.com";
const API_VERSION = "2026-07";
const CREATE_DRAFT = `mutation CreateMercariCheckout($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder { id name invoiceUrl totalPriceSet { shopMoney { amount currencyCode } } }
    userErrors { field message }
  }
}`;

function enabled() {
  return process.env.CHECKOUT_ENABLED === "true" && Boolean(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") return res.status(200).json({ enabled: enabled() });
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!enabled()) return res.status(503).json({ error: "Shopify 付款功能尚未啟用" });

  const quantity = Number(req.body?.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 3) {
    return res.status(400).json({ error: "數量須為 1 到 3 件" });
  }
  // Re-fetch before creating a payable order. Ignore any price or status from the browser.
  const result = await fetchQuote(req.body?.url);
  if (result.status !== 200) return res.status(result.status).json(result.body);
  const item = result.body;

  const input = {
    presentmentCurrencyCode: "TWD",
    lineItems: [{
      title: item.title.slice(0, 255),
      quantity,
      originalUnitPriceWithCurrency: { amount: String(item.total), currencyCode: "TWD" },
      requiresShipping: true,
      taxable: false,
      customAttributes: [
        { key: "Mercari item ID", value: item.itemId },
        { key: "Mercari URL", value: item.url },
        { key: "Mercari JPY price", value: String(item.yen) }
      ]
    }],
    note: "Mercari 代購；下單時重新查價。商品與服務費已含於單價；日本至台灣國際運費另計。來源：" + item.url,
    tags: "Mercari,代購"
  };

  try {
    const response = await fetch("https://" + SHOP + "/admin/api/" + API_VERSION + "/graphql.json", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
      },
      body: JSON.stringify({ query: CREATE_DRAFT, variables: { input } }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error("Shopify HTTP " + response.status);
    const data = await response.json();
    const payload = data?.data?.draftOrderCreate;
    if (data.errors?.length || payload?.userErrors?.length || !payload?.draftOrder?.invoiceUrl) {
      throw new Error("Shopify draft order unavailable");
    }
    const order = payload.draftOrder;
    const checkoutUrl = new URL(order.invoiceUrl);
    if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== SHOP) {
      throw new Error("Unexpected checkout domain");
    }
    const total = order.totalPriceSet?.shopMoney;
    if (total?.currencyCode !== "TWD") throw new Error("Unexpected checkout currency");
    if (Number(total.amount) !== item.total * quantity) throw new Error("Unexpected checkout amount");
    return res.status(200).json({ checkoutUrl: checkoutUrl.href, orderName: order.name, amount: total.amount, currency: "TWD" });
  } catch {
    return res.status(502).json({ error: "目前無法建立 Shopify 結帳，請稍後再試；尚未完成付款" });
  }
}
