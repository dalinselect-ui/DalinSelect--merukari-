const form = document.querySelector('#form');
const result = document.querySelector('#result');
const money = value => new Intl.NumberFormat('zh-TW').format(value);

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function priceRow(label, value, total = false) {
  const row = node('div', total ? 'price-row price-total' : 'price-row');
  row.append(node('span', '', label), node('strong', '', value));
  return row;
}

function renderQuote(item) {
  const card = node('article', 'quote-card');
  const visual = node('div', 'quote-visual');
  if (item.image) {
    const image = node('img');
    image.src = item.image;
    image.alt = 'Mercari 商品圖片';
    image.loading = 'lazy';
    visual.append(image);
  } else visual.append(node('span', '', 'Mercari'));

  const content = node('div', 'quote-info');
  content.append(node('span', 'status-pill', '● 目前可報價'), node('h2', '', item.title));
  content.append(priceRow('Mercari 售價', '¥' + money(item.yen)));
  content.append(priceRow('商品換算（× ' + item.rate + '）', 'NT$' + money(item.itemTwd)));
  content.append(priceRow('代購服務費', 'NT$' + money(item.fee)));
  content.append(priceRow('商品＋服務費', 'NT$' + money(item.total), true));
  content.append(node('p', 'price-note', '日本至台灣國際運費另計；付款前請核對收費說明。'));
  const link = node('a', 'button button-primary', '確認商品並前往下單 →');
  link.href = '/order.html?url=' + encodeURIComponent(item.url);
  content.append(link);
  card.append(visual, content);
  result.replaceChildren(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = '查詢中…';
  result.replaceChildren(node('div', 'notice', '正在確認 Mercari 商品價格與販售狀態…'));
  try {
    const response = await fetch('/api/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: document.querySelector('#url').value })
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('目前無法連線到報價服務，請稍後再試');
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '暫時無法報價');
    renderQuote(data);
  } catch (error) {
    result.replaceChildren(node('div', 'notice notice-error', error.message || '暫時無法報價，請稍後再試'));
  } finally {
    button.disabled = false;
    button.textContent = '查看報價 →';
  }
});
