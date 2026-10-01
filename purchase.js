import { fetchMercariQuote } from "./quote.js";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN || "dalinselect.myshopify.com";
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function shopify(query, variables = {}) {
  if (!TOKEN) {
    const e = new Error("Shopify 尚未完成安全連線設定");
    e.statusCode = 503;
    e.setupRequired = true;
    throw e;
  }

  const r = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-access-token": TOKEN
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000)
  });

  const body = await r.json().catch(() => null);
  if (!r.ok || !body) throw new Error("Shopify API 暫時無法使用");
  if (body.errors?.length) throw new Error(body.errors.map(x => x.message).join("；"));
  return body.data;
}

function userErrors(payload) {
  return payload?.userErrors || payload?.productSetOperation?.userErrors || [];
}

function assertNoErrors(payload) {
  const errors = userErrors(payload);
  if (errors.length) throw new Error(errors.map(x => x.message).join("；"));
}

async function findExisting(handle) {
  const data = await shopify(`
    query ExistingMercariProduct($handle: String!) {
      productByHandle(handle: $handle) {
        id
        handle
        status
        variants(first: 1) { nodes { id } }
      }
    }
  `, { handle });
  return data.productByHandle || null;
}

async function getOnlineStorePublicationAndLocation() {
  const data = await shopify(`
    query PurchaseSetup {
      publications(first: 20) { nodes { id name } }
      locations(first: 20, query: "active:true") { nodes { id name } }
    }
  `);

  const publication = data.publications.nodes.find(x => x.name === "Online Store") || data.publications.nodes[0];
  const location = data.locations.nodes[0];
  if (!publication) throw new Error("找不到 Shopify Online Store 銷售管道");
  if (!location) throw new Error("找不到可用的 Shopify 庫存地點");
  return { publicationId: publication.id, locationId: location.id };
}

async function createPurchaseProduct(q) {
  const handle = `mercari-${q.itemId}-${q.total}`;
  const existing = await findExisting(handle);
  if (existing?.variants?.nodes?.[0]) {
    return {
      productId: existing.id,
      handle: existing.handle,
      variantId: existing.variants.nodes[0].id,
      reused: true
    };
  }

  const { publicationId, locationId } = await getOnlineStorePublicationAndLocation();
  const descriptionHtml = `
    <p><strong>Dalin Select Mercari 專屬代購商品</strong></p>
    <p>此商品由客人透過報價器確認後建立，價格由伺服器重新核對 Mercari 當下售價後產生。</p>
    <ul>
      <li>Mercari 商品 ID：${escapeHtml(q.itemId)}</li>
      <li>Mercari 售價：¥${q.yen.toLocaleString("ja-JP")}</li>
      <li>商品換算：NT$${q.itemTwd.toLocaleString("zh-TW")}</li>
      <li>代購服務費：NT$${q.fee.toLocaleString("zh-TW")}</li>
      <li><strong>本次代購價：NT$${q.total.toLocaleString("zh-TW")}</strong></li>
    </ul>
    <p><a href="${escapeHtml(q.url)}" target="_blank" rel="noopener noreferrer">查看 Mercari 原商品</a></p>
    <p>日本寄往台灣的國際運費於商品抵達後另計。</p>
  `;

  const created = await shopify(`
    mutation CreateMercariProduct($input: ProductCreateInput!) {
      productCreate(product: $input) {
        product {
          id
          handle
        }
        userErrors { field message }
      }
    }
  `, {
    input: {
      title: `Mercari 代購｜${q.title.slice(0, 150)}`,
      handle,
      descriptionHtml,
      productType: "Mercari 代購",
      vendor: "Dalin Select",
      tags: ["mercari代購", "自動報價", q.itemId],
      status: "UNLISTED",
      productOptions: [{ name: "代購", values: [{ name: "1件" }] }],
      metafields: [
        { namespace: "dalinselect", key: "mercari_item_id", type: "single_line_text_field", value: q.itemId },
        { namespace: "dalinselect", key: "mercari_url", type: "url", value: q.url },
        { namespace: "dalinselect", key: "quote_yen", type: "number_integer", value: String(q.yen) },
        { namespace: "dalinselect", key: "quote_total_twd", type: "number_integer", value: String(q.total) }
      ]
    }
  });
  assertNoErrors(created.productCreate);
  const product = created.productCreate.product;
  if (!product?.id) throw new Error("Shopify 商品建立失敗");

  const variants = await shopify(`
    mutation CreateMercariVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(
        productId: $productId
        strategy: REMOVE_STANDALONE_VARIANT
        variants: $variants
      ) {
        productVariants { id }
        userErrors { field message }
      }
    }
  `, {
    productId: product.id,
    variants: [{
      price: String(q.total),
      optionValues: [{ optionName: "代購", name: "1件" }],
      inventoryPolicy: "DENY",
      taxable: false,
      inventoryItem: {
        tracked: true,
        sku: `MER-${q.itemId}`,
        requiresShipping: true
      },
      inventoryQuantities: [{
        availableQuantity: 1,
        locationId
      }]
    }]
  });
  assertNoErrors(variants.productVariantsBulkCreate);
  const variantId = variants.productVariantsBulkCreate.productVariants?.[0]?.id;
  if (!variantId) throw new Error("Shopify 商品規格建立失敗");

  const published = await shopify(`
    mutation PublishMercariProduct($id: ID!, $publicationId: ID!) {
      publishablePublish(id: $id, input: [{ publicationId: $publicationId }]) {
        userErrors { field message }
      }
    }
  `, { id: product.id, publicationId });
  assertNoErrors(published.publishablePublish);

  return { productId: product.id, handle: product.handle, variantId, reused: false };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Never trust the total sent by the browser. Re-read Mercari and recalculate here.
    const q = await fetchMercariQuote(req.body?.url);
    const p = await createPurchaseProduct(q);
    const numericVariantId = p.variantId.split("/").pop();
    const productUrl = `https://${SHOP}/products/${p.handle}`;
    const cartUrl = `https://${SHOP}/cart/${numericVariantId}:1`;
    const checkoutUrl = `${cartUrl}?checkout`;

    return res.status(200).json({
      ok: true,
      itemId: q.itemId,
      title: q.title,
      total: q.total,
      productUrl,
      cartUrl,
      checkoutUrl,
      reused: p.reused
    });
  } catch (e) {
    return res.status(e.statusCode || 500).json({
      error: e.message || "建立代購商品失敗",
      setupRequired: Boolean(e.setupRequired)
    });
  }
}
