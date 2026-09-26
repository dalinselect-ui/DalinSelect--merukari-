# DalinSelect Mercari 代購報價與下單

顧客貼上 Mercari 商品連結後，網站會確認商品專屬價格與販售狀態，顯示台幣報價。下單頁不收集姓名、電話或電郵；付款時跳轉到 Shopify。已登入 Shopify 的顧客可使用帳號保存的資料，缺少的付款或配送資訊仍由 Shopify 要求填寫。

## 付款上線條件

目前付款預設關閉。正式開啟前須完成：

1. Shopify 商店啟用可收款的方案與付款服務。
2. 已確定運費規則：第一次付款只收商品與代購服務費；商品到台灣後按實際國際運費另行收款。需建立抵台後核算、通知與第二次收款的營運流程。
3. 為商店建立僅有必要權限（至少 `write_draft_orders`）的 Admin API 存取權杖，在 Vercel **Production** 環境變數設定 `SHOPIFY_ADMIN_ACCESS_TOKEN`，切勿提交到 GitHub。
4. 用 Shopify 測試付款模式驗證草稿訂單、實際結帳金額、顧客登入與配送資料流程。
5. 確認上述項目後，在 Vercel 設定 `CHECKOUT_ENABLED=true` 並重新部署。

付款 API 會在建立 Shopify 草稿訂單前重新查詢 Mercari，不接受瀏覽器傳入的價格。首次草稿訂單加上價格為 NT$0、標明「國際運費抵台後另收」的自訂配送項目，避免第一筆付款誤收國際運費；實際運費需抵台後另行建立請款。商品已售出、資料不足、幣別或 Shopify 回傳金額不一致時會拒絕結帳。沒有啟用設定時，下單頁只顯示付款尚未開通，不會製造假訂單。

## 本機測試

```sh
npm install
node --test checkout.test.js
```
