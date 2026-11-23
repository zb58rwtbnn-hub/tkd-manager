import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { appIntegration } from './app-server.js'
import { lineIntegration } from './line-server.js'
import { ensureCerts } from './certs.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['LINE_', 'APP_'])
  return {
    plugins: [react(), appIntegration(env), lineIntegration(env)],
    // 道館名稱、LINE 官方帳號 ID（.env.local 的 APP_NAME、LINE_BASIC_ID，第二套系統用）
    define: {
      __APP_NAME__: JSON.stringify(process.env.APP_NAME || '跆拳道館'),
      __LINE_ID__: JSON.stringify(process.env.LINE_BASIC_ID || ''),
      // 不需要的功能（APP_HIDE=fees,trials,coach,makeup），選單和相關欄位會隱藏
      __HIDE__: JSON.stringify((process.env.APP_HIDE || '').split(',').map(x => x.trim()).filter(Boolean)),
    },
    optimizeDeps: { include: ['@vladmandic/face-api', 'exceljs'] }, // 臉部辨識元件先準備好，第一次打開臉部簽到不會整頁重新載入
    server: {
      port: +process.env.APP_PORT || 3000,
      strictPort: true,
      https: ensureCerts(), // iPad、Windows 要 https 才能用鏡頭（臉部簽到）
      host: true,          // 道館 Wi-Fi 上的 iPad 也能連（需要 APP_PASSWORD 登入）
      allowedHosts: true,
      open: false,         // 由 start.command 打開網頁（系統平常在背景自動執行）
      watch: { ignored: ['**/data/**'] },
    },
  }
})
