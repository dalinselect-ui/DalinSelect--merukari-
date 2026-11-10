import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const oldUrl = "https://jp.mercari.com/item/m111";
const newUrl = "https://jp.mercari.com/item/m222";
const response = value => ({ ok: true, json: async () => value });
const quote = (url, title) => response({ url, title, yen: 900, rate: 0.25, itemTwd: 230, fee: 150, total: 380 });

function setup(fetch) {
  const handlers = {};
  const submit = { disabled: false };
  const confirm = { disabled: false, addEventListener: (name, fn) => { handlers[name] = fn; } };
  const input = {
    value: oldUrl,
    setAttribute() {},
    addEventListener: (name, fn) => { handlers[name] = fn; }
  };
  const form = {
    querySelector: () => submit,
    addEventListener: (name, fn) => { handlers[name] = fn; }
  };
  const result = {
    innerHTML: "",
    insertAdjacentHTML: (_, html) => { result.innerHTML += html; }
  };
  const nodes = { "#form": form, "#url": input, "#result": result, "#confirm-purchase": confirm };
  const document = { querySelector: selector => nodes[selector], querySelectorAll: () => [], documentElement: {} };
  runInNewContext(source, { fetch, document, URLSearchParams, location: { search: "?lang=en" } });
  return {
    input, submit, result,
    request: () => handlers.submit({ preventDefault() {} }),
    confirm: () => handlers.click(),
    change(url) {
      input.value = url;
      handlers.input();
    }
  };
}

test("editing the listing invalidates its old result and confirmation", async () => {
  const requests = [];
  const ui = setup(async (path, options) => {
    const { url } = JSON.parse(options.body);
    requests.push([path, url]);
    return quote(url, "Previous listing");
  });
  await ui.request();
  assert.match(ui.result.innerHTML, /Previous listing/);
  ui.change(newUrl);
  assert.equal(ui.result.innerHTML, "");
  await ui.confirm();
  assert.deepEqual(requests, [["/api/quote", oldUrl]]);
});

test("a quote that resolves after the input changes never appears", async () => {
  let resolveQuote;
  const ui = setup(() => new Promise(resolve => { resolveQuote = resolve; }));
  const pending = ui.request();
  ui.change(newUrl);
  resolveQuote(quote(oldUrl, "Previous listing"));
  await pending;
  assert.equal(ui.result.innerHTML, "");
  assert.equal(ui.submit.disabled, false);
});

test("confirmation locks quoting and discards its response if the listing changes", async () => {
  let resolvePurchase;
  const requests = [];
  const ui = setup((path, options) => {
    const { url } = JSON.parse(options.body);
    requests.push([path, url]);
    return path === "/api/quote"
      ? Promise.resolve(quote(url, url === oldUrl ? "Previous listing" : "Current listing"))
      : new Promise(resolve => { resolvePurchase = resolve; });
  });
  await ui.request();
  const pending = ui.confirm();
  assert.equal(ui.input.readOnly, true);
  assert.equal(ui.submit.disabled, true);
  await ui.confirm();
  await ui.request();
  assert.deepEqual(requests, [["/api/quote", oldUrl], ["/api/purchase", oldUrl]]);
  ui.change(newUrl);
  resolvePurchase(response({ title: "Previous listing", total: 380, cartUrl: "https://example.test/cart/111" }));
  await pending;
  assert.equal(ui.result.innerHTML, "");
  assert.equal(ui.input.readOnly, false);
  assert.equal(ui.submit.disabled, false);
  await ui.request();
  assert.match(ui.result.innerHTML, /Current listing/);
  assert.doesNotMatch(ui.result.innerHTML, /cart\/111/);
});

test("successful confirmation displays the current listing's cart link", async () => {
  const ui = setup((path) => Promise.resolve(path === "/api/quote"
    ? quote(oldUrl, "Current listing")
    : response({ title: "Current listing", total: 380, cartUrl: "https://example.test/cart/111" })));
  await ui.request();
  await ui.confirm();
  assert.match(ui.result.innerHTML, /https:\/\/example\.test\/cart\/111/);
  assert.equal(ui.input.readOnly, false);
  assert.equal(ui.submit.disabled, false);
});
