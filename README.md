# 跆拳道館學員管理系統

給中小型道館用的學員管理系統，在道館的一台 Mac 上執行，搭配 LINE 官方帳號通知家長。所有學員資料都存在自己的電腦裡，不放到任何雲端服務。

## 功能

**學員與上課**
- 學員管理（依段位排序）、出缺勤點名、簽到／簽退
- 刷卡簽到（NFC 卡）、臉部簽到（iPad 鏡頭，資料只存在本機）
- 簽到語音播報（Google Nest／Chromecast 喇叭唸出學員名字）
- 補課管理、段位記錄、比賽成績

**LINE 官方帳號**
- 家長綁定（傳孩子姓名，館長在 LINE 按同意）
- 到課、下課、缺席通知，繳費提醒
- 新生報名表、免費體驗預約（含前一天提醒）
- 比賽報名（家長勾項目、填體重，一鍵複製報名名單）
- 團購訂購（品項 × 尺寸統計，可下載 Excel 報表）
- 教練 LINE 打卡（依堂數計算鐘點費）
- AI 自動客服（選用，使用本機的 LM Studio，對話不會離開電腦）

**其他**
- 多台裝置同步（Mac、iPad、手機在道館 Wi-Fi 上都能用）
- 每天自動備份到 iCloud 雲碟
- 不需要的功能可以關掉（例如學校社團不需要收費）
- 同一台電腦可以跑兩套系統（例如道館和學校社團分開）

## 需要準備

- 一台 Mac（建議一直開著，例如 Mac mini）
- [Node.js](https://nodejs.org/) 18 以上
- LINE 官方帳號，並在 [LINE Developers](https://developers.line.biz/) 開啟 Messaging API
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)，放在 `~/.local/bin/cloudflared`（讓 LINE 能把家長的訊息送進來，不需要固定 IP）
- 選用：[LM Studio](https://lmstudio.ai/) 和 Qwen 模型（AI 自動客服）

## 安裝

```bash
git clone <這個專案的網址> tkd-manager
cd tkd-manager
npm install
cp .env.example .env.local   # 打開 .env.local 填入道館名稱、密碼、LINE 設定
npm start
```

打開 https://localhost:3000 ，輸入 `.env.local` 裡的密碼登入。第一次會出現安全憑證提示，iPad 等裝置可以在登入頁下載道館憑證安裝。

LINE Webhook 網址由系統自動設定，不用手動填。請在 LINE Official Account Manager 的「回應設定」把 Webhook 打開、自動回應訊息關掉。

### 開機自動執行（選用）

`run-system.sh` 可以搭配 macOS 的 LaunchAgent，讓系統開機自動啟動、當掉自動重開。

## 資料與隱私

- 所有資料存在 `data/` 資料夾，**不會**上傳到 GitHub（已列在 `.gitignore`）
- `.env.local`（密碼、LINE 金鑰）也不會上傳
- 家長收到的報名、訂購連結都有簽章，只看得到自己的孩子
- 使用前請先取得家長同意，臉部簽到要另外勾選同意才會啟用

## 授權

MIT License，詳見 [LICENSE](LICENSE)。臉部辨識模型來自 [@vladmandic/face-api](https://github.com/vladmandic/face-api)（MIT）。
