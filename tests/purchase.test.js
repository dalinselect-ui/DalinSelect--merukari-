import assert from "node:assert/strict";
import test from "node:test";

process.env.SHOPIFY_CLIENT_ID = "test-client";
process.env.SHOPIFY_CLIENT_SECRET = "test-secret";
process.env.SHOPIFY_STORE_DOMAIN = "dalinselect.myshopify.com";
process.env.SHOPIFY_API_VERSION = "2026-07";
const { default: handler } = await import("../purchase.js");

const productId = "gid://shopify/Product/1";
const variantId = "gid://shopify/ProductVariant/2";
const handle = "mercari-m123-970";
const setup = {
  shop: { currencyCode: "TWD" },
  publications: { nodes: [{ id: "pub-other", name: "Other channel" }, { id: "pub-online", name: "Online Store" }] },
  locations: { nodes: [{ id: "loc-retail", isActive: true, fulfillsOnlineOrders: false }, { id: "loc-online", isActive: true, fulfillsOnlineOrders: true }] }
};
function existing(available = 1) {
  return {
    id: productId, handle, status: "UNLISTED",
    variants: { nodes: [{ id: variantId, price: "970.00", inventoryPolicy: "DENY", inventoryItem: {
      tracked: true, sku: "MER-m123", inventoryLevel: { quantities: [{ name: "available", quantity: available }] }
    } }] }
  };
}
function mockApi(t, overrides = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.startsWith("https://jp.mercari.com/")) {
      return new Response(`<script type="application/ld+json">${JSON.stringify({
        "@type": "Product", sku: "m123", name: "測試商品", offers: {
          priceCurrency: "JPY", price: 3000, availability: "https://schema.org/InStock"
        }
      })}</script>`);
    }
    if (url.endsWith("/admin/oauth/access_token")) {
      assert.equal(options.headers["content-type"], "application/x-www-form-urlencoded");
      assert.equal(options.body.get("grant_type"), "client_credentials");
      assert.equal(options.body.get("client_secret"), "test-secret");
      return Response.json({ access_token: "mock-token", expires_in: 86400 });
    }
    assert.equal(url, "https://dalinselect.myshopify.com/admin/api/2026-07/graphql.json");
    assert.equal(options.headers["x-shopify-access-token"], "mock-token");
    const { query, variables } = JSON.parse(options.body);
    const operation = query.match(/(?:query|mutation)\s+(\w+)/)[1];
    calls.push({ operation, variables });
    if (overrides[operation] instanceof Error) throw overrides[operation];
    const defaults = {
      PurchaseSetup: setup,
      ExistingMercariProduct: { productByHandle: null },
      CreateMercariProduct: { productCreate: { product: { id: productId, handle }, userErrors: [] } },
      CreateMercariVariant: { productVariantsBulkCreate: { productVariants: [{ id: variantId }], userErrors: [] } },
      PublishMercariProduct: { publishablePublish: { userErrors: [] } }
    };
    const result = overrides[operation] ?? defaults[operation];
    assert.ok(result, `Unexpected operation ${operation}`);
    return result instanceof Response ? result : Response.json({ data: result });
  });
  return calls;
}
async function request(method = "POST", body = { url: "https://jp.mercari.com/item/m123", total: 1 }) {
  const res = {
    headers: {}, code: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; }
  };
  await handler({ method, body }, res);
  return res;
}

test("confirm purchase gets OAuth token, requotes, creates priced stocked variant and publishes to Online Store", async t => {
  const calls = mockApi(t);
  const res = await request();
  assert.equal(res.code, 200);
  assert.equal(res.body.total, 970);
  assert.equal(res.body.productUrl, `https://dalinselect.myshopify.com/products/${handle}`);
  assert.equal(res.body.cartUrl, "https://dalinselect.myshopify.com/cart/2:1");
  assert.equal(res.body.checkoutUrl, "https://dalinselect.myshopify.com/cart/2:1?checkout");
  assert.equal(res.body.reused, false);
  assert.deepEqual(calls.map(x => x.operation), ["PurchaseSetup", "ExistingMercariProduct", "CreateMercariProduct", "CreateMercariVariant", "PublishMercariProduct"]);
  const variant = calls[3].variables.variants[0];
  assert.equal(variant.price, "970");
  assert.equal(variant.inventoryPolicy, "DENY");
  assert.equal(variant.inventoryItem.tracked, true);
  assert.deepEqual(variant.inventoryQuantities, [{ availableQuantity: 1, locationId: "loc-online" }]);
  assert.equal(calls[4].variables.publicationId, "pub-online");
});

test("retry republishes a valid existing product without recreating or replenishing inventory", async t => {
  const calls = mockApi(t, { ExistingMercariProduct: { productByHandle: existing() } });
  const res = await request();
  assert.equal(res.code, 200);
  assert.equal(res.body.reused, true);
  assert.deepEqual(calls.map(x => x.operation), ["PurchaseSetup", "ExistingMercariProduct", "PublishMercariProduct"]);
});

for (const [name, product] of [
  ["out of stock", existing(0)],
  ["wrong price", { ...existing(), variants: { nodes: [{ ...existing().variants.nodes[0], price: "0" }] } }],
  ["draft product", { ...existing(), status: "DRAFT" }]
]) {
  test(`rejects existing ${name} without returning checkout links`, async t => {
    const calls = mockApi(t, { ExistingMercariProduct: { productByHandle: product } });
    const res = await request();
    assert.equal(res.code, 409);
    assert.equal(res.body.checkoutUrl, undefined);
    assert.equal(calls.length, 2);
  });
}

for (const [name, value] of [
  ["no Online Store", { ...setup, publications: { nodes: [{ id: "other", name: "Other" }] } }],
  ["no online fulfillment", { ...setup, locations: { nodes: [{ id: "retail", isActive: true, fulfillsOnlineOrders: false }] } }],
  ["wrong currency", { ...setup, shop: { currencyCode: "JPY" } }]
]) {
  test(`fails before mutations when setup has ${name}`, async t => {
    const calls = mockApi(t, { PurchaseSetup: value });
    const res = await request();
    assert.equal(res.code, 503);
    assert.equal(res.body.setupRequired, true);
    assert.equal(calls.length, 1);
  });
}

for (const operation of ["CreateMercariProduct", "CreateMercariVariant", "PublishMercariProduct"]) {
  test(`does not claim success on ${operation} userErrors`, async t => {
    const key = { CreateMercariProduct: "productCreate", CreateMercariVariant: "productVariantsBulkCreate", PublishMercariProduct: "publishablePublish" }[operation];
    const calls = mockApi(t, { [operation]: { [key]: { userErrors: [{ message: "mutation failed" }] } } });
    const res = await request();
    assert.equal(res.code, 500);
    assert.equal(res.body.error, "mutation failed");
    assert.equal(res.body.checkoutUrl, undefined);
    assert.equal(calls.at(-1).operation, operation);
  });
}

for (const [name, result, status] of [
  ["GraphQL errors", Response.json({ errors: [{ message: "Access denied" }] }), 502],
  ["missing data", Response.json({}), 502],
  ["HTTP 401", Response.json({}, { status: 401 }), 503],
  ["HTTP 429", Response.json({}, { status: 429 }), 502],
  ["network timeout", new Error("TimeoutError"), 502]
]) {
  test(`handles ${name}`, async t => {
    mockApi(t, { PurchaseSetup: result });
    const res = await request();
    assert.equal(res.code, status);
    assert.equal(res.body.checkoutUrl, undefined);
  });
}

test("invalid Mercari URL and unsupported methods never call Shopify", async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
  assert.equal((await request("POST", { url: "https://example.com" })).code, 400);
  assert.equal((await request("OPTIONS")).code, 204);
  assert.equal((await request("GET")).code, 405);
});

