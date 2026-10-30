# 卡坦島 3D 戰略版：給 Claude 的工作說明

線上可玩的卡坦島（基本版規則），three.js 3D 戰略地圖。介面文字一律用繁體中文。

## 指令
- `npm run build`：打包。輸出 `site/`（部署用：頁面＋`assets/`）與 `dist/`（claude.ai artifact 版頁面與 `dist/index.test.html` 測試頁）。
- `npm run dev`：打包後用 wrangler 在 http://127.0.0.1:8787 跑整個網站與房間伺服器。
- `npm test`：規則單元測試、網路序列化、300 局模擬。
- `node test/rooms.mjs`：房間伺服器協定（需先 `npm run dev`）。
- 瀏覽器測試（Playwright，SwiftShader 很慢）：`python3 test/ui1.py`…`ui4.py`、`online.py`、`online2.py`（斷線重連）、`online3.py`（觀戰）、`match.py`（快速配對）。加 `ROOMS=ws` 會改走真正的房間伺服器（需先 `npm run dev`）。截圖存到 `SHOTS` 指定的資料夾。

## 部署
- 推送到 `main` 由 Cloudflare Workers Builds 自動部署（Build `npm run build`、Deploy `npx wrangler deploy`）；其他分支產生預覽網址。
- `wrangler.jsonc` 的 `name` 要和 Cloudflare 上的 Worker 名稱一致（`catan-3d`）。
- 免費方案：Durable Objects 每天 10 萬次請求、寫入 10 萬列；不要加會大量寫入或常駐喚醒房間的功能。

## 架構重點
- 規則引擎 `src/engine/` 是純函式、seed 可重播；電腦對手在 `src/ai/`。
- 線上對戰只用 presence：主持人的瀏覽器跑規則並把公開狀態放進自己的 presence，玩家把動作放進自己的 presence，手牌用 ECDH + AES-GCM 加密。每個 presence 上限 4 KiB（`codec.js` 負責壓縮）。
- `src/net/room.js` 依環境選傳輸：claude.ai 的 room 功能、自架站的 WebSocket 房間（頁面有 `window.__rooms`）、測試用的 BroadcastChannel（`window.__mockRoom`）。三者介面相同。
- `server/worker.js`：靜態網站＋`/rooms/<名稱>` WebSocket → `PresenceRoom` Durable Object（休眠 API、同分頁重連接手、過期清除、速率限制、只接受同站或本機來源）。
- 地圖上的 DOM 標籤（數字牌、港口、強盜徽章）在 `src/render/labels.js`：外框只負責定位（inline transform），動畫只能加在裡面的元素上。

## 驗證時要注意
- 測試頁用和 claude.ai 完全相同的外框（`build.mjs` 的 `HOST_SKELETON`）；看畫面時要用真實字型與實際尺寸，並檢查數字牌是否在自己的地塊上（`test/ui1.py` 有自動檢查）。
- 素材包 `assets/`（約 22 MB）由 `tools/pack-assets.mjs` 產生；製作腳本在 `tools/art/`（參考用）。
