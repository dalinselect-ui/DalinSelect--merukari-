const state = document.querySelector('#order-state');
const sourceUrl = new URLSearchParams(location.search).get('url');
const money = value => new Intl.NumberFormat('zh-TW').format(value);

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function notice(message, error = false) {
  state.replaceChildren(node('div', error ? 'notice notice-error' : 'notice', message));
}

function renderOrder(item, checkoutEnabled) {
  const card = node('section', 'order-card');
  const itemHeader = node('div', 'order-item');
  if (item.image) {
    const image = node('img');
    image.src = item.image;
    image.alt = 'Mercari 商品圖片';
    itemHeader.append(image);
  }
  const heading = node('div');
  heading.append(node('span', 'status-pill', '● 價格與狀態已確認'), node('h2', '', item.title), node('p', 'muted', 'Mercari 商品 ID：' + item.itemId));
  itemHeader.append(heading);
  card.append(itemHeader);

  const controls = node('div', 'order-controls');
  const label = node('label', '', '購買數量');
  label.htmlFor = 'quantity';
  const select = node('select');
  select.id = 'quantity';
  for (let quantity = 1; quantity <= 3; quantity++) {
    const option = node('option', '', quantity + ' 件');
    option.value = String(quantity);
    select.append(option);
  }
  controls.append(label, select);
  card.append(controls);

  const unit = node('div', 'price-row');
  unit.append(node('span', '', '每件商品＋服務費'), node('strong', '', 'NT$' + money(item.total)));
  const total = node('div', 'price-row price-total');
  const totalAmount = node('strong');
  total.append(node('span', '', '本次商品小計'), totalAmount);
  const updateTotal = () => { totalAmount.textContent = 'NT$' + money(item.total * Number(select.value)); };
  select.addEventListener('change', updateTotal);
  updateTotal();
  const breakdown = node('div', 'order-breakdown');
  breakdown.append(unit, total, node('p', 'price-note', '日本至台灣國際運費另計；請在付款前核對 Shopify 結帳頁的金額與條款。'));
  card.append(breakdown);

  if (checkoutEnabled) {
    const button = node('button', 'button button-primary button-wide', '前往 Shopify 安全付款 →');
    const feedback = node('p', 'checkout-feedback');
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = '重新查價並建立結帳中…';
      feedback.textContent = '';
      try {
        const response = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: item.url, quantity: Number(select.value) })
        });
        if (!response.headers.get('content-type')?.includes('application/json')) {
          throw new Error('目前無法連線到結帳服務，請稍後再試');
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '暫時無法前往結帳');
        const destination = new URL(data.checkoutUrl);
        if (destination.protocol !== 'https:') throw new Error('結帳網址無效');
        location.assign(destination.href);
      } catch (error) {
        feedback.textContent = error.message || '暫時無法前往結帳，尚未付款';
        button.disabled = false;
        button.textContent = '前往 Shopify 安全付款 →';
      }
    });
    card.append(button, feedback);
  } else {
    card.append(node('div', 'notice notice-pending', 'Shopify 線上付款正在設定中，現在尚無法建立付款訂單。請稍後再來。'));
  }
  state.replaceChildren(card);
}

async function loadOrder() {
  if (!sourceUrl) return notice('請先回到報價頁貼上 Mercari 商品連結。', true);
  notice('正在重新查詢商品價格與販售狀態…');
  try {
    const [quoteResponse, checkoutResponse] = await Promise.all([
      fetch('/api/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: sourceUrl }) }),
      fetch('/api/checkout')
    ]);
    if (!quoteResponse.headers.get('content-type')?.includes('application/json')) {
      throw new Error('目前無法連線到報價服務，請稍後再試');
    }
    const item = await quoteResponse.json();
    if (!quoteResponse.ok) throw new Error(item.error || '目前無法報價');
    const checkout = checkoutResponse.ok && checkoutResponse.headers.get('content-type')?.includes('application/json')
      ? await checkoutResponse.json() : { enabled: false };
    renderOrder(item, checkout.enabled === true);
  } catch (error) {
    notice(error.message || '目前無法報價，請返回重試。', true);
  }
}

loadOrder();
