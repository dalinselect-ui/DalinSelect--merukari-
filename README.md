# Dalin Select Mercari 報價器

客人輸入 Mercari 商品網址後，按「確定代購」會由伺服器重新取得價格與販售狀態，建立 Shopify 代購商品、設定台幣價格與 1 件庫存，發布至 Online Store，再回傳商品頁、購物車與 Checkout 連結。

## Vercel 環境變數

在 Vercel 專案的 Production 環境設定下列值；若測試 Preview，也需設定對應環境。變更後重新部署。

| 變數 | 值 |
| --- | --- |
| `SHOPIFY_CLIENT_ID` | DalinSelect Mercari Purchase App 的 Client ID |
| `SHOPIFY_CLIENT_SECRET` | 該 App 的 Client Secret，僅設於伺服器環境 |
| `SHOPIFY_STORE_DOMAIN` | `dalinselect.myshopify.com`，不含 `https://` 或路徑 |
| `SHOPIFY_API_VERSION` | `2026-07` |

不再使用 `SHOPIFY_ADMIN_ACCESS_TOKEN`。請勿把 Secret 放入前端或 Git。

App 必須已安裝到商店，且 App 和商店屬於同一 Shopify 組織，才能使用 [client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant)。所需寫入權限為 `write_products`、`write_inventory`、`write_publications`，以及 `read_locations`；Shopify 寫入權限包含同資源的讀取權限。變更 App 權限後，須發布 App 版本並在商店核准。

商店幣別須為 TWD、啟用 Online Store，並有啟用且可處理網路訂單的庫存地點。該地點的配送費率、目標市場與付款方式仍需在 Shopify 設定，才能完成結帳。

## 本地驗證

使用 Node.js 22 或以上：

```sh
npm ci
npm run check
npm test
```

此專案以 `vercel.json` 的 `@vercel/node` 與靜態資源 builders 部署，沒有另外的前端編譯步驟。測試以 mock Mercari／Shopify 回應驗證報價、OAuth、商品／規格建立、庫存、發布、連結、重試與錯誤；不會建立真實商品或付款。

## API 2026-07

- `productCreate(product: ProductCreateInput!)` 保留原本商品描述、標籤與 metafields。
- `UNLISTED` 是可透過直接連結購買的商品狀態，避免專屬代購商品出現在搜尋或推薦。
- `productVariantsBulkCreate` 使用 `REMOVE_STANDALONE_VARIANT`，將初始規格換成正確價格的規格。
- `inventoryQuantities` 是規格建立輸入欄位，使用 `availableQuantity`、`locationId`，搭配 `inventoryItem.tracked: true` 和 `inventoryPolicy: DENY`。
- `publishablePublish` 使用 Online Store 的 `publicationId`；若找不到 Online Store，會回報設定錯誤。

2026-07 schema 驗證通過。目前保留的 `productByHandle`、`Publication.name` 仍有效，但已標記 deprecated，未來 API 升級時需改用其替代欄位。

參考：[商品規格輸入](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/ProductVariantsBulkInput)、[商品狀態](https://shopify.dev/docs/api/admin-graphql/2026-07/enums/ProductStatus)、[商品發布](https://shopify.dev/docs/apps/build/sales-channels/product-publishing)。

## 重試與正式驗收

同一 Mercari ID 與報價金額會重用既有商品，但必須確認商品狀態、規格、價格和庫存符合預期。已完成規格建立但發布失敗的商品可重試發布；已售完的商品不會自動補庫存。若商品建立成功但規格建立失敗，後續重試會回報 409，需客服在 Shopify 處理未完成商品。

Shopify 多步驟建立並非交易；多個同時確認請求仍可能競爭建立商品，尚未加入跨執行個體的鎖或預約機制。Shopify 庫存僅控制各商品的可購買數量，並不代表 Mercari 已保留或下單，且不同報價金額使用不同商品 handle。

部署後請以一個仍在販售的 Mercari 商品實際驗收：報價 → 確定代購 → 商品頁 → 加入購物車 → Checkout，核對台幣價格、庫存、配送方式與付款方式。本地 mock 和 schema 驗證不等於真實商店驗收。
