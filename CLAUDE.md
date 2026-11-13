# 卡坦島 3D 戰略版：給 Claude 的工作說明

線上可玩的卡坦島（基本版規則＋5–6 人擴充＋航海家），three.js 3D 戰略地圖。介面文字一律用繁體中文。

## 指令
- `npm run build`：打包。輸出 `site/`（部署用：頁面＋`assets/`）與 `dist/`（claude.ai artifact 版頁面與 `dist/index.test.html` 測試頁）。
- `npm run dev`：打包後用 wrangler 在 http://127.0.0.1:8787 跑整個網站與房間伺服器。
- `npm test`：規則單元測試、地圖繪圖的步調與解析度調整（`test/pace.mjs`）、標準地圖回歸（`test/golden.mjs`）、網路序列化、時間限制、帳號、模擬（標準 300 局、大島嶼配對回合 120 局與特別建造 40 局、航海家劇本 1 與 2 各 60 局、劇本 3 與 9 各 40 局、5–6 人航海家四張各 30 局、房規 40＋20 局；`node test/sim.mjs N --map=base-6 --turns=sbp`（加 `--house` 用房規）、`--map=sea-1`、`sea-2`、`sea-3`、`sea-9`、`sea-1-6`…`sea-9-6` 可單獨跑）。
- `node test/rooms.mjs`：房間伺服器協定（需先 `npm run dev`）；`python3 test/lobby.py`：主畫面官方房間在連線無聲斷掉後自己接上（需先 `npm run dev`）。
- 瀏覽器測試（Playwright，SwiftShader 很慢）：`python3 test/ui1.py`…`ui4.py`、`ui5.py`（大島嶼 6 人單機，`TURNS=sbp` 測特別建造）、`online.py`、`online2.py`（斷線重連、主持人重新整理時交接）、`online3.py`（觀戰）、`online4.py`（主持人交接與接手、回合時間、聊天、退出由電腦代替）、`online5.py`（6 席大島嶼房間）、`ui6.py`（航海家單機：開局放船、造船、移船、金礦、重新整理後繼續；`MAP=sea-2` 跑四座島嶼、`MAP=sea-3` 跑霧島、`MAP=sea-9` 跑新世界，`MAP=sea-1-6`…`sea-9-6` 跑 5–6 人版；`online6.py` 也接受 `MAP`）、`online6.py`（航海家線上房間）、`match.py`（快速配對）。加 `ROOMS=ws` 會改走真正的房間伺服器（需先 `npm run dev`）。截圖存到 `SHOTS` 指定的資料夾。
- 效能（瀏覽器，一次只跑一個）：`python3 test/pace.py`（幀率：操作 60、靜止 30、視窗在背景 15、設定的省電／不限與效能資訊）、`python3 test/mapleak.py`（換 5 次島嶼再開戰役，只能剩 1 份地圖與 WebGL；`ART=1 QUALITY=high` 帶素材包）、`python3 test/shaders.py`（開局後與地圖原地重建時不能再編譯著色器；`QUALITY=high ART=1`、`MAP=sea-1`、`MAP=sea-3 TURNS=16`）。SwiftShader 量不到真實顯示卡的時間：要看真實數字，在設定開「效能資訊」。
- 帳號：`node test/accounts.mjs`（token 驗證）；完整流程見 `docs/catan-3d-status.md` 的「帳號與戰績」。
- 地圖工坊：`node test/custom.mjs`（草稿轉地圖定義、檢查、在畫出來的地圖上打完整局；範例草稿在 `test/drafts.mjs`，`node test/sim.mjs N --map=draft:twin` 可單獨模擬）；`python3 test/editor.py`（瀏覽器：畫地圖、3D 預覽、試玩、重新整理後繼續、手機）。
- 玩家地圖（發布）：先 `node test/accounts.mjs --keys DIR` 做測試金鑰、把 `DIR/dev.vars` 放成 `.dev.vars`，`npm run dev` 後跑 `API=http://127.0.0.1:8787 KEYS=DIR node test/accounts.mjs`（含發布、評分、移除的伺服器流程）與 `KEYS=DIR python3 test/maps.py`（瀏覽器：發布拿代號、連結、公開列表、用代號開房、評分）。`node test/accounts.mjs --token DIR SUB` 印出測試用的登入 token。

## 部署
- 推送到 `main` 由 Cloudflare Workers Builds 自動部署（Build `npm run build`、Deploy `npx wrangler deploy`）。其他分支的建置會失敗、沒有預覽網址（實作 Durable Object 的 Worker 不產生預覽網址），要試新版用本機 `npm run dev`。
- `wrangler.jsonc` 的 `name` 要和 Cloudflare 上的 Worker 名稱一致（`catan-3d`）。
- 免費方案：Durable Objects 每天 10 萬次請求、寫入 10 萬列；不要加會大量寫入或常駐喚醒房間的功能。

## 架構重點
- 規則引擎 `src/engine/` 是純函式、seed 可重播；電腦對手在 `src/ai/`。
- 地圖由地圖定義決定（`src/engine/maps.js`：格子、地形池、數字、港口、人數、銀行、發展卡、回合規則）。幾何從定義算出，`GEO` 是可切換的共用值（`useMap`；對局狀態的 `map` 欄位，`ensureMap(st)` 換回）。只能同時有一張地圖在用，畫別張地圖要用 `withMap`。
- 標準地圖（`base-4`）用原本的產生器（`legacy`），不要改它的抽牌順序：`node test/golden.mjs` 會比對 24 局的盤面、幾何與對局過程。新地圖用另一個產生器（同地形不相鄰、修正數字）。
- 房規（`menu.js` 的 `houseRuleRows`、`gameSetup`；單人設定與自訂房間，官方房間用 `officialSettings` 固定標準）：設定 `vpAdj`（勝利分數相對地圖原本的分數）、`discard`（棄牌門檻，`st.rules.discard`，引擎用 `handLimit`）、`dice: 'deck'`（平衡骰，`st.rules.dice`，牌堆 `st.diceDeck` 只在主持人那裡，`encodeFull` 的 `dk`）、`mix: 'rich'`（數字偏向高機率，`board.js` 的 `richNumbers`，盤面的 `mix`；非標準地圖靠 `encodeBoard` 的 `x` 讓各頁面排出同樣盤面）。標準規則時這些欄位都不存在，所以 `golden.mjs` 不受影響。房間大廳的 presence 用 `hr`（`houseCode`）告訴玩家。
- 5–6 人（`base-6`）：`st.rules.turns` 是 `paired`（配對回合，預設）或 `sbp`（特別建造階段）；回合後段在 `st.sub = { k, lead, rest }`，`st.current` 是正在行動的玩家。
- 航海家（地圖定義 `rules.seafarers`，規則在 `src/engine/seafarers.js`）：船在 `st.ships`（每條路徑一格，`-1` 是空的），海盜在 `board.pirate`。地形池可以含 `sea`，所以哪裡是陸地要看盤面（`seaInfo(board)`，依盤面快取），不是只看地圖定義。格子的 `g` 是分組，各組有自己的地形池與數字（`groups`）。開局：有 `setup.group` 時只能在那組的島上，沒有時任何島都可以；玩家開局所在的島記在 `players[].home`（本島，`homeIslands(st, p)`），在其他島第一次蓋村莊得 `isleBonus` 分。霧島（地圖定義 `fog`）：格子 `t: 'fog'` 在盤面上是 `fog`，`st.fog` 是霧裡剩下的地形與數字（只在主持人那裡）；道路、船抵達霧旁的路口時由引擎 `discover` 用遊戲亂數抽出並換一個新的 `st.board`，畫面偵測到後在原地重建（`MapView.rebuildBoard`），雲霧在 `src/render/fog.js`。新世界（地圖定義 `islands`）：盤面產生器把地形池的陸地隨機長成幾座互不相連的島（`board.js` 的 `islandLayout`）；`robber: { off: true }` 時強盜（與沒有起點的海盜）是 `-1`，畫面與電腦都要處理這個值。5–6 人航海家（`sea-1-6`…`sea-9-6`）的格子用 `picture()` 畫成文字（`S` 海、`P` 海盜起點、`F` 霧）；配對回合的第二位開始行動時 `shipMoved` 重設（第二位也能移一艘船），特別建造階段不能移船。選單的地圖表是 `MAP_TABLE`（左欄 3–4 人、右欄 5–6 人，`menu.js` 的 `mapTable` 給單人設定與線上房間共用），按鈕用定義的 `short`。
- 地圖工坊（玩家自己畫的地圖）：`src/engine/custom.js` 把草稿（編輯器格子上的海、隨機陸地或指定地形，加上人數、勝利分數、開局島、外島加分）轉成地圖定義；草稿沒說的照標準島嶼的比例補（隨機陸地的地形、數字牌、港口數量與種類），同一份草稿一定得到同一份定義。好幾座島或有金礦時一定用航海家規則。地圖代號 `my-<內容雜湊>`（改了內容就是另一張地圖），用 `registerMap` 登記（`maps.js` 分內建 `MAPS` 與登記的 `CUSTOM`，`isBuiltIn`）；不是內建的地圖整份定義存在對局狀態的 `mapDef`，所以存檔不靠草稿。介面在 `src/ui/editor.js`（草稿存在 localStorage `catan3d-drafts-v1`，邊畫邊存）；主畫面的「地圖工坊」卡片、單人設定的「玩家地圖」。發布（只在自架版）：`server/maps.js`（路由與 `Accounts` 裡的 `maps`、`ratings` 兩張表；伺服器用同一份 `custom.js` 檢查草稿；同一位作者發布同樣的草稿得到同一個代號；讀單張地圖與列表有邊緣快取）、`src/net/maps.js`（代號 6 碼，地圖代號 `u-<代號>`，`loadPublished` 抓一次並登記）、`src/ui/maps-ui.js`（公開地圖列表、發布結果、戰役結束的評分）。最近開過的已發布地圖連草稿存在 localStorage `catan3d-maps-seen-v1`；連結 `#map=代號` 打開單人設定。線上房間可以用內建或已發布的地圖（本機草稿要先發布，建房時遇到會換回標準島嶼）：玩家的頁面在 `handleHost` 先用代號抓地圖再排盤面，接手主持時 `decodeFull` 把地圖定義放回狀態。
- 線上對戰只用 presence：主持人的瀏覽器跑規則並把公開狀態放進自己的 presence，玩家把動作放進自己的 presence，手牌用 ECDH + AES-GCM 加密。每個 presence 上限 4 KiB（`codec.js` 負責壓縮）。標準地圖的盤面完整傳送；其他地圖只傳地圖代號、seed、數字排法與盤面雜湊，各頁面自己產生盤面（產生器必須是決定性的，改了它就是新版本，雜湊不同時會提示重新整理）。
- 主持人會換人（`src/net/online.js`）：開戰後交給效能最好的玩家（`src/net/perf.js`）；主持人每次更新把整局狀態加密給接班人（`bk`），離開或失聯時由接班人接手（`ep` 代數高者為準，舊主持人自動改當玩家）。線上房間有回合時間限制（`src/game/clock.js`）；聊天在 `src/net/chat.js`。
- 帳號（只在自架版）：`server/accounts.js`（Google ID token 驗證、SQLite Durable Object `Accounts`）、`src/net/account.js`、`src/ui/account-ui.js`；用戶端 ID 在 `server/config.js`。不保存 email。
- `src/net/room.js` 依環境選傳輸：claude.ai 的 room 功能、自架站的 WebSocket 房間（頁面有 `window.__rooms`）、測試用的 BroadcastChannel（`window.__mockRoom`）。三者介面相同。
- `server/worker.js`：靜態網站＋`/rooms/<名稱>` WebSocket → `PresenceRoom` Durable Object（休眠 API、同分頁重連接手、過期清除、速率限制、只接受同站或本機來源）。
- 畫面風格（設定 → 介面風格，設定值 `ui`；玩家在設定裡選過才有 `uiPicked`，沒選過的跟著預設走，舊版存下的 `classic` 不算選過）：
  - 製圖桌（預設，`ui: 'atlas'`，`<html>` 加 `ui3`）：`src/ui/theme3.css`（最後載入），所有規則都在 `html.ui3` 底下。每樣東西是製圖桌上不同的材質，不要再讓好幾個面板共用同一種框：上方列是胡桃木樑加黃銅條，銀行、行動列、小地圖是胡桃木托盤，諸國、戰報、通知、對話框、設定畫面是羊皮紙，目前的指令是布條，分數是蠟封，行動是黃銅圓章，港口標籤是羊皮紙籤，獎項是勳章。紙上用墨色字（紙的容器把 `--ink`、`--brass` 等變數換成墨色與紅墨）。主畫面的玩法卡片與官方房間的框維持原本的樣子（使用者要求換回來），製圖桌不改它們。
    - **不要縫合**（使用者明確反對）：任何表面都不用貼圖拼出來，不用重複貼圖（`repeat`）、九宮格（`border-image` 切片）、或把圖拉伸到面板大小；圖的尺寸不合就不用，寧可素色。紙、木頭、布都是素色（最多一個平順的漸層做立體感），線與框用 `border`／`box-shadow` 畫。圖片只整張使用、而且不超過它本身的大小：蠟封、燕尾旗、六角形當遮罩（`mask`），墨線插圖，標題旁的花飾，勳章。這些圖在 `src/ui/kit3.css`（data URI，claude.ai 版沒有素材包也能用），由 `python3 tools/ui-kit3.py` 從 `tools/art/kenney-ui3/`（Kenney CC0：Cartography Pack、UI Pack - Adventure、Fantasy UI Borders、Medals；`SOURCES.txt` 寫每張圖出自哪裡）產生。
    - 對話框依 `data-kind`（`dialogs.open` 的 `kind`）配一張墨線插圖（`--u3-vig`：標題旁一個紅墨小圖、紙角淡淡一張，最大 128 px），新增對話框種類時在 theme3.css 幫它選一張。用 `mask` 做形狀的元素，自己的陰影與光暈會被遮掉，要陰影就加在外層。
  - 經典（`ui: 'classic'`）：`src/ui/theme.css`，把面板、按鈕、對話框統一成主畫面的古銅回紋框（`assets/ui/frame_*.webp`）、琺瑯底與金字；沒有素材包時 `<html>` 會有 `no-art`，框線退回簡單線條。
  - 清爽（`ui: 'clean'`，`<html>` 加 `ui2`）：`src/ui/theme2.css`，所有規則都在 `html.ui2` 底下；細框與分隔線是 Kenney Fantasy UI Borders（CC0），`python3 tools/ui-kit.py` 把 `tools/art/kenney-ui/` 的圖染色後寫成 `src/ui/kit.css`。
  - 遊戲物件的圖示來自 game-icons.net（`src/ui/gameicons.js`，由 `tools/icons.mjs` 產生；CC BY 3.0，主畫面左下角的出處不可拿掉）。
- 效能（第十六輪；起因是電競電腦也發熱、卡頓）：
  - 繪圖步調與解析度的邏輯在 `src/render/pace.js`（純函式，`test/pace.mjs`）。`MapView.start()` 每次螢幕更新被叫一次，只在其中幾次畫：有東西在變 60 幀（`poke()`）、靜止 30、視窗不在前景 15（玩家的指標、滾輪、按鍵算在場，`attend()`）、分頁藏起來不畫；設定 `fps` 是省電／標準／不限。地圖上新加會動的東西要 `poke()`，或在 `frame()` 裡讓 `lively` 成立，不然只照靜止的幀率畫（還是會動，只是 30 幀）。
  - 解析度＝像素預算（`pixelRatioCap`：低 1.8、中 2.4、高 4.2 百萬像素）×調整器（`Governor`）。調整器以靜止時的每幀時間為預算，只看靜止、沒有重畫陰影的幀；量得到顯示卡時間（`EXT_disjoint_timer_query_webgl2`）時不看遲到的幀（那是頁面在忙）。建好、改尺寸、換素材後先 `hold()`。
  - 著色器一律在載入時編好：新的物件種類加進 `Pieces.prewarm`／`Markers.prewarm`，用 `MapView.precompile`（會綁上後處理的 render target，否則編到給畫布用的另一個版本；也先把貼圖送上顯示卡，並在兩幀之間做 three.js 的「第一次使用」`getUniforms()`：在一幀中途做，要等瀏覽器的繪圖程序把排隊的指令做完，每種新東西卡 10–50 ms）。three.js 在最後一個用到某程式的材質 dispose 時就丟掉程式，所以換材質要先畫新的再丟舊的（`disposeLater`）。`test/shaders.py` 會檢查。
  - `MapView.dispose()` 要放掉所有顯示資源並 `forceContextLoss()`；掛在 window 上的監聽要在 dispose 時拿掉（鏡頭的按鍵監聽曾經讓每一份舊地圖都留在顯示卡上）。`test/mapleak.py` 會檢查。
  - 後處理（`post.js`）：環境光遮蔽半解析度、不做半透明感知（那會每幀多畫兩次場景裡的半透明物件）、強度接近 0（拉遠的紙地圖）時改用一般的 RenderPass；調色寫在輸出 pass 裡。
  - 主執行緒：每步棋的領土計算在下一個工作才做（`updateTerritory`），不要和介面更新疊成一次長停頓；地圖每幀的流程裡不要讀版面（`offsetParent`、`getBoundingClientRect` 等會逼瀏覽器重排），小地圖用 IntersectionObserver 記是否看得到；音效裝置在第一次點擊後的空檔開啟（`sfx.js`）。
  - 蓋在地圖上的 CSS 動畫只動 opacity／transform（放在偽元素上），不要動畫 box-shadow，也不要 backdrop-filter。
  - 設定 →「效能資訊」在地圖左下角顯示每秒幀數、螢幕 Hz、顯示卡每幀時間與負載、程式每幀時間、繪製解析度與調整比例、繪製次數、顯示卡名稱；玩家回報卡頓時請他截這個。
- 地圖上的 DOM 標籤（數字牌、港口、強盜徽章）在 `src/render/labels.js`：外框只負責定位（inline transform），動畫只能加在裡面的元素上。大小依標籤下方格子在畫面上的寬度決定（選項 `ground`、`px`、`size`、`fadePx`；`scene.js` 的 `tokenPx`、`harborPx`），不要再用鏡頭高度決定。
- `room.js` 的 WebSocket 傳輸會在頁面回到前景、網路恢復或切換時送 ping，沒回應就重連（`probe`）；不要拿掉，手機上主畫面的即時更新靠它。

## 驗證時要注意
- 測試頁用和 claude.ai 完全相同的外框（`build.mjs` 的 `HOST_SKELETON`）；看畫面時要用真實字型與實際尺寸，並檢查數字牌是否在自己的地塊上（`test/ui1.py` 有自動檢查）。
- 素材包 `assets/`（約 22 MB）由 `tools/pack-assets.mjs` 產生；製作腳本在 `tools/art/`（參考用）。
