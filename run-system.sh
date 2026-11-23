#!/bin/bash
# 系統本體：Mac 登入後由 launchd 自動執行（~/Library/LaunchAgents/com.songhe.tkd.plist），停掉會自動重開。
# LINE 通道由系統自己管理（line-server.js）。紀錄在 data/system.log。
export PATH="$HOME/.local/node/bin:$PATH"
cd "$(dirname "$0")"
# .env.local 的設定（道館名稱、埠號、LINE）給系統各部分使用
set -a; [ -f .env.local ] && . ./.env.local; set +a
# 紀錄檔超過 5MB 就重新開始
[ -f data/system.log ] && [ "$(stat -f%z data/system.log)" -gt 5000000 ] && : > data/system.log
echo "===== 系統啟動 $(date '+%Y-%m-%d %H:%M:%S') ====="
# 系統執行期間防止 Mac 睡眠（螢幕仍可關閉）
exec caffeinate -is npm start
