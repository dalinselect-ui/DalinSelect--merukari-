import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import handler from './checkout.js';

const originalFetch = globalThis.fetch;
const originalEnabled = process.env.CHECKOUT_ENABLED;
const originalToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
after(() => {
  globalThis.fetch = originalFetch;
  if (originalEnabled === undefined) delete process.env.CHECKOUT_ENABLED;
  else process.env.CHECKOUT_ENABLED = originalEnabled;
  if (originalToken === undefined) delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  else process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = originalToken;
});

function response() {
  return {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const itemId = 'm12345678901';
const itemUrl = 'https://jp.mercari.com/item/' + itemId;
const html = '<script type="application/ld+json">' + JSON.stringify({
  '@type': 'Product',
  sku: itemId,
  name: '測試商品',
  offers: { price: 23999, priceCurrency: 'JPY', availability: 'https://schema.org/InStock' }
}) + '</script>';

before(() => {
  process.env.CHECKOUT_ENABLED = 'true';
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = 'test-token';
});

test('ignores browser-supplied price and creates Shopify draft from fresh Mercari price', async () => {
  let sentInput;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://jp.mercari.com/')) return { ok: true, status: 200, text: async () => html };
    sentInput = JSON.parse(options.body).variables.input;
    return {
      ok: true,
      json: async () => ({ data: { draftOrderCreate: {
        draftOrder: {
          id: 'gid://shopify/DraftOrder/1',
          name: '#D1',
          invoiceUrl: 'https://ebhfru-de.myshopify.com/123/invoices/abc',
          totalPriceSet: { shopMoney: { amount: '12220.00', currencyCode: 'TWD' } }
        },
        userErrors: []
      } } })
    };
  };
  const res = response();
  await handler({ method: 'POST', body: { url: itemUrl, quantity: 2, total: 1, sold: false } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(sentInput.lineItems[0].originalUnitPriceWithCurrency.amount, '6110');
  assert.equal(sentInput.lineItems[0].quantity, 2);
  assert.equal(res.body.currency, 'TWD');
});

test('sold item never creates a Shopify draft order', async () => {
  let shopifyCalled = false;
  globalThis.fetch = async url => {
    if (String(url).startsWith('https://jp.mercari.com/')) {
      return { ok: true, status: 200, text: async () => html.replace('InStock', 'SoldOut') };
    }
    shopifyCalled = true;
    throw new Error('Should not reach Shopify');
  };
  const res = response();
  await handler({ method: 'POST', body: { url: itemUrl, quantity: 1 } }, res);
  assert.equal(res.statusCode, 422);
  assert.equal(shopifyCalled, false);
});

test('payment is unavailable without explicit enablement', async () => {
  process.env.CHECKOUT_ENABLED = 'false';
  const res = response();
  await handler({ method: 'POST', body: { url: itemUrl, quantity: 1 } }, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /尚未啟用/);
  process.env.CHECKOUT_ENABLED = 'true';
});
