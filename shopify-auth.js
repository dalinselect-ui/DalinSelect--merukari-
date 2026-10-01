const SHOP = process.env.SHOPIFY_STORE_DOMAIN || "dalinselect.myshopify.com";
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

let cachedToken = null;
let cachedExpire = 0;
let pendingToken = null;

function authError(message, setupRequired = false) {
  return Object.assign(new Error(message), { statusCode: setupRequired ? 503 : 502, setupRequired });
}

export async function getShopifyAccessToken() {
  if (cachedToken && Date.now() < cachedExpire) return cachedToken;
  if (pendingToken) return pendingToken;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    const error = new Error("Shopify Client ID / Secret 尚未設定");
    error.statusCode = 503;
    error.setupRequired = true;
    throw error;
  }

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(SHOP)) {
    throw authError("SHOPIFY_STORE_DOMAIN 必須是完整的 myshopify.com 網域，不含 https:// 或路徑", true);
  }

  pendingToken = requestAccessToken();
  try {
    return await pendingToken;
  } finally {
    pendingToken = null;
  }
}

async function requestAccessToken() {
  let response;
  try {
    response = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      }),
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw authError("Shopify Token 連線逾時或暫時無法使用");
  }

  const data = await response.json().catch(() => null);

  if (!response.ok || typeof data?.access_token !== "string" || !data.access_token) {
    const setupRequired = [400, 401, 403].includes(response.status);
    throw authError(setupRequired
      ? "Shopify Token 授權失敗，請檢查 Client ID / Secret、App 安裝與商店所屬組織"
      : "Shopify Token 取得失敗，請稍後再試", setupRequired);
  }

  cachedToken = data.access_token;
  const expiresIn = Number(data.expires_in);
  // Missing or invalid expiry must never turn into an indefinitely reusable token.
  cachedExpire = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0
    ? Math.max(0, expiresIn - Math.min(300, expiresIn / 2)) * 1000 : 0);

  return cachedToken;
}

export { SHOP, API_VERSION };
