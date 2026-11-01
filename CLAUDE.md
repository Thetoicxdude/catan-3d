# 卡坦島 3D 戰略版：給 Claude 的工作說明

線上可玩的卡坦島（基本版規則＋5–6 人擴充＋航海家），three.js 3D 戰略地圖。介面文字一律用繁體中文。

## 指令
- `npm run build`：打包。輸出 `site/`（部署用：頁面＋`assets/`）與 `dist/`（claude.ai artifact 版頁面與 `dist/index.test.html` 測試頁）。
- `npm run dev`：打包後用 wrangler 在 http://127.0.0.1:8787 跑整個網站與房間伺服器。
- `npm test`：規則單元測試、標準地圖回歸（`test/golden.mjs`）、網路序列化、時間限制、帳號、模擬（標準 300 局、大島嶼配對回合 120 局與特別建造 40 局、航海家劇本 1 與 2 各 60 局、劇本 3 與 9 各 40 局；`node test/sim.mjs N --map=base-6 --turns=sbp`、`--map=sea-1`、`sea-2`、`sea-3`、`sea-9` 可單獨跑）。
- `node test/rooms.mjs`：房間伺服器協定（需先 `npm run dev`）。
- 瀏覽器測試（Playwright，SwiftShader 很慢）：`python3 test/ui1.py`…`ui4.py`、`ui5.py`（大島嶼 6 人單機，`TURNS=sbp` 測特別建造）、`online.py`、`online2.py`（斷線重連、主持人重新整理時交接）、`online3.py`（觀戰）、`online4.py`（主持人交接與接手、回合時間、聊天、退出由電腦代替）、`online5.py`（6 席大島嶼房間）、`ui6.py`（航海家單機：開局放船、造船、移船、金礦、重新整理後繼續；`MAP=sea-2` 跑四座島嶼、`MAP=sea-3` 跑霧島、`MAP=sea-9` 跑新世界；`online6.py` 也接受 `MAP`）、`online6.py`（航海家線上房間）、`match.py`（快速配對）。加 `ROOMS=ws` 會改走真正的房間伺服器（需先 `npm run dev`）。截圖存到 `SHOTS` 指定的資料夾。
- 帳號：`node test/accounts.mjs`（token 驗證）；完整流程見 `docs/catan-3d-status.md` 的「帳號與戰績」。

## 部署
- 推送到 `main` 由 Cloudflare Workers Builds 自動部署（Build `npm run build`、Deploy `npx wrangler deploy`）；其他分支產生預覽網址。
- `wrangler.jsonc` 的 `name` 要和 Cloudflare 上的 Worker 名稱一致（`catan-3d`）。
- 免費方案：Durable Objects 每天 10 萬次請求、寫入 10 萬列；不要加會大量寫入或常駐喚醒房間的功能。

## 架構重點
- 規則引擎 `src/engine/` 是純函式、seed 可重播；電腦對手在 `src/ai/`。
- 地圖由地圖定義決定（`src/engine/maps.js`：格子、地形池、數字、港口、人數、銀行、發展卡、回合規則）。幾何從定義算出，`GEO` 是可切換的共用值（`useMap`；對局狀態的 `map` 欄位，`ensureMap(st)` 換回）。只能同時有一張地圖在用，畫別張地圖要用 `withMap`。
- 標準地圖（`base-4`）用原本的產生器（`legacy`），不要改它的抽牌順序：`node test/golden.mjs` 會比對 24 局的盤面、幾何與對局過程。新地圖用另一個產生器（同地形不相鄰、修正數字）。
- 5–6 人（`base-6`）：`st.rules.turns` 是 `paired`（配對回合，預設）或 `sbp`（特別建造階段）；回合後段在 `st.sub = { k, lead, rest }`，`st.current` 是正在行動的玩家。
- 航海家（地圖定義 `rules.seafarers`，規則在 `src/engine/seafarers.js`）：船在 `st.ships`（每條路徑一格，`-1` 是空的），海盜在 `board.pirate`。地形池可以含 `sea`，所以哪裡是陸地要看盤面（`seaInfo(board)`，依盤面快取），不是只看地圖定義。格子的 `g` 是分組，各組有自己的地形池與數字（`groups`）。開局：有 `setup.group` 時只能在那組的島上，沒有時任何島都可以；玩家開局所在的島記在 `players[].home`（本島，`homeIslands(st, p)`），在其他島第一次蓋村莊得 `isleBonus` 分。霧島（地圖定義 `fog`）：格子 `t: 'fog'` 在盤面上是 `fog`，`st.fog` 是霧裡剩下的地形與數字（只在主持人那裡）；道路、船抵達霧旁的路口時由引擎 `discover` 用遊戲亂數抽出並換一個新的 `st.board`，畫面偵測到後在原地重建（`MapView.rebuildBoard`），雲霧在 `src/render/fog.js`。新世界（地圖定義 `islands`）：盤面產生器把地形池的陸地隨機長成幾座互不相連的島（`board.js` 的 `islandLayout`）；`robber: { off: true }` 時強盜（與沒有起點的海盜）是 `-1`，畫面與電腦都要處理這個值。
- 線上對戰只用 presence：主持人的瀏覽器跑規則並把公開狀態放進自己的 presence，玩家把動作放進自己的 presence，手牌用 ECDH + AES-GCM 加密。每個 presence 上限 4 KiB（`codec.js` 負責壓縮）。標準地圖的盤面完整傳送；其他地圖只傳地圖代號、seed、數字排法與盤面雜湊，各頁面自己產生盤面（產生器必須是決定性的，改了它就是新版本，雜湊不同時會提示重新整理）。
- 主持人會換人（`src/net/online.js`）：開戰後交給效能最好的玩家（`src/net/perf.js`）；主持人每次更新把整局狀態加密給接班人（`bk`），離開或失聯時由接班人接手（`ep` 代數高者為準，舊主持人自動改當玩家）。線上房間有回合時間限制（`src/game/clock.js`）；聊天在 `src/net/chat.js`。
- 帳號（只在自架版）：`server/accounts.js`（Google ID token 驗證、SQLite Durable Object `Accounts`）、`src/net/account.js`、`src/ui/account-ui.js`；用戶端 ID 在 `server/config.js`。不保存 email。
- `src/net/room.js` 依環境選傳輸：claude.ai 的 room 功能、自架站的 WebSocket 房間（頁面有 `window.__rooms`）、測試用的 BroadcastChannel（`window.__mockRoom`）。三者介面相同。
- `server/worker.js`：靜態網站＋`/rooms/<名稱>` WebSocket → `PresenceRoom` Durable Object（休眠 API、同分頁重連接手、過期清除、速率限制、只接受同站或本機來源）。
- 畫面風格：`src/ui/theme.css` 最後載入，把面板、按鈕、對話框統一成主畫面的古銅回紋框（`assets/ui/frame_*.webp`）、琺瑯底與金字；沒有素材包時 `<html>` 會有 `no-art`，框線退回簡單線條。遊戲物件的圖示來自 game-icons.net（`src/ui/gameicons.js`，由 `tools/icons.mjs` 產生；CC BY 3.0，主畫面左下角的出處不可拿掉）。
- 地圖上的 DOM 標籤（數字牌、港口、強盜徽章）在 `src/render/labels.js`：外框只負責定位（inline transform），動畫只能加在裡面的元素上。

## 驗證時要注意
- 測試頁用和 claude.ai 完全相同的外框（`build.mjs` 的 `HOST_SKELETON`）；看畫面時要用真實字型與實際尺寸，並檢查數字牌是否在自己的地塊上（`test/ui1.py` 有自動檢查）。
- 素材包 `assets/`（約 22 MB）由 `tools/pack-assets.mjs` 產生；製作腳本在 `tools/art/`（參考用）。
