const form = document.querySelector('#form');
const result = document.querySelector('#result');
const money = n => new Intl.NumberFormat('zh-TW').format(n);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let currentQuote = null;

function quoteCard(x) {
  const image = x.image ? `<img src="${escapeHtml(x.image)}" alt="商品圖片">` : '<div></div>';
  return `
    <article class="card">
      ${image}
      <div>
        <div class="ok">● 販售狀態確認</div>
        <h2>${escapeHtml(x.title || x.itemId)}</h2>
        <div class="row"><span>Mercari 售價</span><b>¥${money(x.yen)}</b></div>
        <div class="row"><span>商品換算（× ${x.rate}）</span><b>NT$${money(x.itemTwd)}</b></div>
        <div class="row"><span>代購服務費</span><b>NT$${money(x.fee)}</b></div>
        <div class="row total"><span>本次報價</span><span>NT$${money(x.total)}</span></div>
        <p class="hint">日本 → 台灣國際運費於商品抵達後另計</p>
        <button id="confirm-purchase" class="confirm-btn">確定代購</button>
        <p class="purchase-note">按下後會再次確認 Mercari 價格與販售狀態，並建立專屬 Shopify 代購商品。</p>
      </div>
    </article>
  `;
}

function purchaseReady(x) {
  return `
    <div class="purchase-ready">
      <div class="ok">✓ 專屬代購商品已建立</div>
      <h3>${escapeHtml(x.title)}</h3>
      <div class="row total"><span>代購價格</span><span>NT$${money(x.total)}</span></div>
      <div class="purchase-actions">
        <a class="secondary-action" target="_top" href="${escapeHtml(x.cartUrl)}">加入購物車</a>
        <a class="primary-action" target="_top" href="${escapeHtml(x.checkoutUrl)}">直接購買</a>
      </div>
      <a class="product-link" target="_top" href="${escapeHtml(x.productUrl)}">查看專屬商品頁面 →</a>
    </div>
  `;
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = form.querySelector('button');
  btn.disabled = true;
  btn.textContent = '讀取中…';
  result.innerHTML = '';
  currentQuote = null;

  try {
    const r = await fetch('/api/quote', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({url: document.querySelector('#url').value})
    });
    const x = await r.json();
    if (!r.ok) throw x;
    currentQuote = x;
    result.innerHTML = quoteCard(x);

    document.querySelector('#confirm-purchase').addEventListener('click', async () => {
      const purchaseBtn = document.querySelector('#confirm-purchase');
      purchaseBtn.disabled = true;
      purchaseBtn.textContent = '重新確認並建立商品…';

      try {
        const pr = await fetch('/api/purchase', {
          method: 'POST',
          headers: {'content-type':'application/json'},
          body: JSON.stringify({url: currentQuote.url})
        });
        const p = await pr.json();
        if (!pr.ok) throw p;
        result.insertAdjacentHTML('beforeend', purchaseReady(p));
        purchaseBtn.textContent = '商品已建立';
      } catch (p) {
        purchaseBtn.disabled = false;
        purchaseBtn.textContent = '確定代購';
        const extra = p.setupRequired ? '<br><small>網站管理員尚未完成 Shopify 安全金鑰設定。</small>' : '';
        result.insertAdjacentHTML('beforeend', `<div class="error"><b>無法建立代購商品</b><br>${escapeHtml(p.error || '發生未知錯誤')}${extra}</div>`);
      }
    });
  } catch (x) {
    result.innerHTML = `<div class="error"><b>讀取失敗</b><br>${escapeHtml(x.error || '發生未知錯誤')}${x.itemId ? `<br><small>商品 ID：${escapeHtml(x.itemId)}</small>` : ''}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '立即報價';
  }
});
