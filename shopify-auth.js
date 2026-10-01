const SHOP = process.env.SHOPIFY_STORE_DOMAIN || "dalinselect.myshopify.com";
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

let cachedToken = null;
let cachedExpire = 0;

export async function getShopifyAccessToken() {
  if (cachedToken && Date.now() < cachedExpire) return cachedToken;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    const error = new Error("Shopify Client ID / Secret 尚未設定");
    error.statusCode = 503;
    error.setupRequired = true;
    throw error;
  }

  const response = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.access_token) {
    throw new Error("Shopify Token 取得失敗");
  }

  cachedToken = data.access_token;
  cachedExpire = Date.now() + ((data.expires_in || 86400) - 300) * 1000;

  return cachedToken;
}

export { SHOP, API_VERSION };
