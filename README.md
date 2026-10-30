# 卡坦島 3D 戰略版

線上可玩的卡坦島（基本版規則）。地圖是可以旋轉、傾斜的 3D 戰略地圖，資源卡與發展卡都是寫實卡面。可以跟電腦對戰、在同一台裝置輪流玩，也可以線上多人：開房、用代碼或邀請連結加入、快速配對、觀戰、斷線重連。

## 專案結構

| 路徑 | 內容 |
| --- | --- |
| `src/` | 遊戲本體（three.js）。規則引擎在 `src/engine/`，是純函式，同一個 seed 可以重播。 |
| `src/net/` | 線上對戰。由主持人的瀏覽器跑規則並裁判，玩家的手牌用 ECDH + AES-GCM 加密。 |
| `server/worker.js` | Cloudflare Worker：提供網頁與素材，並用 Durable Objects 跑線上房間（只轉送每位玩家的 presence，伺服器不需要懂規則）。 |
| `assets/` | 寫實素材包（約 22 MB，全部 CC0）。 |
| `build.mjs` | 打包。`site/` 是部署用的網站，`dist/` 是 claude.ai 版與測試頁。 |
| `test/` | 測試（見下方）。 |

## 本機開發

```sh
npm install
npm run dev        # 打包後啟動本機伺服器：http://127.0.0.1:8787
```

本機伺服器會一起執行房間伺服器，所以開兩個瀏覽器分頁就能測多人。

## 部署（Cloudflare Workers，免費方案）

只需要設定一次：

1. 在 Cloudflare 主控台進入 **Workers & Pages**，選 **Create application**，再選 **Import a repository**。
2. 授權 GitHub，選這個 repo。
3. 建置設定：
   - Build command：`npm run build`
   - Deploy command：`npx wrangler deploy`（預設值）
4. 按 **Deploy**。網址會是 `https://catan-3d.<你的子網域>.workers.dev`。

之後每次推送到 `main` 分支都會自動部署；推送到其他分支會產生預覽網址，不影響正式版。

## 測試

```sh
npm test                                  # 規則單元測試、網路序列化、300 局完整模擬
node test/rooms.mjs                       # 房間伺服器協定（需先執行 npm run dev）
python3 test/ui1.py                       # 瀏覽器介面流程（Playwright；ui1 到 ui4）
python3 test/online.py                    # 線上對局（瀏覽器內的模擬房間）
ROOMS=ws python3 test/online.py           # 同一場線上對局，改走真正的房間伺服器
```

Python 測試會把截圖存到 `SHOTS` 環境變數指定的資料夾（預設是系統暫存資料夾下的 `catan-shots`）。

## 免費額度（Workers Free 方案）

| 項目 | 每日或每月額度 |
| --- | --- |
| Worker 請求 | 每天 10 萬次（靜態檔案不計） |
| Durable Objects | 每天 10 萬次請求、13,000 GB-s 執行時間、寫入 10 萬列 |
| WebSocket | 連線算 1 次請求；收到的訊息每 20 則算 1 次；送出的訊息與 ping 不計 |
| Workers Builds | 每月 3,000 分鐘建置時間 |

一場四人線上對局大約寫入幾百列、用掉幾百次請求，測試階段的用量遠低於上限。

## 素材來源（全部 CC0）

- [Poly Haven](https://polyhaven.com)：植物、岩石、地表、城堡、碼頭、帆船、道具與照片材質。
- Daniel74（[Blend Swap](https://www.blendswap.com/blends/view/75519) 等四棟）：中世紀木構房屋。
- [Quaternius](https://quaternius.com) Farm Animals：農場動物。
- 資源卡與發展卡的卡面：用上述素材在 Blender（Cycles）擺拍算圖。
