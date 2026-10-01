import assert from "node:assert/strict";
import test from "node:test";

process.env.SHOPIFY_STORE_DOMAIN = "dalinselect.myshopify.com";
process.env.SHOPIFY_CLIENT_ID = "test-client";
process.env.SHOPIFY_CLIENT_SECRET = "test-secret";
let sequence = 0;
async function freshAuth() { return import(`../shopify-auth.js?test=${sequence++}`); }

test("caches and coalesces token requests and refreshes before expiry", async t => {
  let now = 1000000;
  let calls = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(options.body.get("client_id"), "test-client");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ access_token: `token-${calls}`, expires_in: 86400 });
  });
  const { getShopifyAccessToken } = await freshAuth();
  assert.deepEqual(await Promise.all([getShopifyAccessToken(), getShopifyAccessToken()]), ["token-1", "token-1"]);
  assert.equal(await getShopifyAccessToken(), "token-1");
  assert.equal(calls, 1);
  now += 86100 * 1000;
  assert.equal(await getShopifyAccessToken(), "token-2");
});

test("missing credentials fail without fetching", async t => {
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  delete process.env.SHOPIFY_CLIENT_SECRET;
  const auth = await freshAuth();
  process.env.SHOPIFY_CLIENT_SECRET = secret;
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
  await assert.rejects(auth.getShopifyAccessToken(), e => e.statusCode === 503 && e.setupRequired);
});

test("invalid store domain fails before sending credentials", async t => {
  process.env.SHOPIFY_STORE_DOMAIN = "https://example.com";
  const auth = await freshAuth();
  process.env.SHOPIFY_STORE_DOMAIN = "dalinselect.myshopify.com";
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
  await assert.rejects(auth.getShopifyAccessToken(), e => e.statusCode === 503 && e.setupRequired);
});

test("failed token request is sanitized and can be retried", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    return ++calls === 1
      ? Response.json({ error: "test-secret must not leak" }, { status: 401 })
      : Response.json({ access_token: "recovered", expires_in: 86400 });
  });
  const auth = await freshAuth();
  await assert.rejects(auth.getShopifyAccessToken(), e => e.statusCode === 503 && e.setupRequired && !e.message.includes("test-secret"));
  assert.equal(await auth.getShopifyAccessToken(), "recovered");
});

test("token timeout reports an upstream error", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("private details"); });
  const auth = await freshAuth();
  await assert.rejects(auth.getShopifyAccessToken(), e => e.statusCode === 502 && !e.message.includes("private"));
});

test("missing expiry is never cached", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json({ access_token: `token-${++calls}` }));
  const auth = await freshAuth();
  assert.equal(await auth.getShopifyAccessToken(), "token-1");
  assert.equal(await auth.getShopifyAccessToken(), "token-2");
});
