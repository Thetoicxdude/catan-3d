# 素材製作腳本（參考用）

`assets/` 裡的寫實素材都是用這些腳本從 CC0 原始素材做出來的。原始素材（Poly Haven 的模型與貼圖、Blend Swap 的房屋、Quaternius 的動物）體積太大，沒有放進 repo，腳本裡的路徑也是當初工作環境的路徑，要重做素材時需要先下載原始素材並調整路徑。

| 腳本 | 用途 |
| --- | --- |
| `cards/cards.py` | 五張資源卡的靜物擺拍（Blender 4.5 + Cycles）：`python3.11 cards.py <名稱|all> <輸出資料夾> [寬] [取樣數]` |
| `cards/devcards.py` | 五張發展卡的擺拍（引用 `cards.py` 的工具函式） |
| `cards/post_cards.py` | 卡面調色、裁切與縮圖，輸出 WebP |
| `impost.py` | 樹木與灌木烘焙成多角度 impostor |
| `terrain.py` | 地表材質（顏色與法線）處理 |
| `bldg/*.py`、`bldg/jobs.sh` | 房屋、城堡、碼頭、帆船與道具的材質烘焙 |
| `bake.js`、`runbake.mjs` | 烘焙流程的驅動程式 |
| `animals.mjs`、`rocks.mjs`、`rockpack.mjs`、`bldgpack.mjs` | 模型轉換與打包 |
| `../pack-assets.mjs` | 把處理好的素材收進 `assets/` 並寫出 `assets/manifest.json` |
