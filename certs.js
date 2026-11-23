// 道館專用的 https 安全憑證（在 vite.config.js 中使用）
//
// iPad、Windows 的瀏覽器只准 https 網頁使用鏡頭，所以系統改用 https。
// - certs/ca.key、ca.crt：道館自己的憑證機構，只產生一次；每台裝置安裝一次 ca.crt 就會信任系統
//   （限定只能用在道館區網的 IP 與這台 Mac，就算外流也不能拿去冒充其他網站）
// - certs/server.key、server.crt：系統本身的憑證，Mac 的 IP 改變時自動重新產生
// - certs/（道館名稱）安全憑證.cer：給 iPad、Windows 安裝用的檔案（登入頁可以下載）

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = path.resolve('certs')
const file = (name) => path.join(DIR, name)
const APP_NAME = process.env.APP_NAME || '跆拳道館'
export const CA_DOWNLOAD = file(`${APP_NAME}安全憑證.cer`)

const openssl = (...args) => execFileSync('/usr/bin/openssl', args, { stdio: 'pipe' })

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address).sort()
}

function hostName() {
  try { return execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName']).toString().trim() + '.local' }
  catch { return null }
}

function makeCA() {
  fs.writeFileSync(file('ca.cnf'), [
    '[req]', 'distinguished_name = dn', 'prompt = no', 'x509_extensions = v3_ca',
    '[dn]', `CN = ${APP_NAME} 學員管理系統`, `O = ${APP_NAME}`,
    '[v3_ca]',
    'basicConstraints = critical, CA:TRUE, pathlen:0',
    'keyUsage = critical, keyCertSign, cRLSign',
    'subjectKeyIdentifier = hash',
    // 只能用在私人區網與本機
    'nameConstraints = critical, permitted;IP:192.168.0.0/255.255.0.0, permitted;IP:10.0.0.0/255.0.0.0, permitted;IP:172.16.0.0/255.240.0.0, permitted;IP:127.0.0.0/255.0.0.0, permitted;DNS:local, permitted;DNS:localhost',
  ].join('\n'), 'utf8')
  openssl('req', '-x509', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
    '-keyout', file('ca.key'), '-out', file('ca.crt'), '-config', file('ca.cnf'), '-utf8')
  fs.chmodSync(file('ca.key'), 0o600)
  openssl('x509', '-in', file('ca.crt'), '-outform', 'der', '-out', CA_DOWNLOAD)
}

function makeServer(ips, host) {
  const alt = ['DNS.1 = localhost', 'IP.1 = 127.0.0.1', ...ips.map((ip, i) => `IP.${i + 2} = ${ip}`)]
  if (host) alt.push(`DNS.2 = ${host}`)
  fs.writeFileSync(file('server.cnf'), [
    '[req]', 'distinguished_name = dn', 'prompt = no',
    '[dn]', `CN = ${APP_NAME} 學員管理系統`,
    '[ext]',
    'basicConstraints = critical, CA:FALSE',
    'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth',
    'subjectAltName = @alt',
    '[alt]', ...alt,
  ].join('\n'), 'utf8')
  openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', file('server.key'),
    '-out', file('server.csr'), '-config', file('server.cnf'), '-utf8')
  // Apple 規定憑證最長 825 天，這裡用 800 天；到期前重新啟動系統會自動換新
  openssl('x509', '-req', '-in', file('server.csr'), '-CA', file('ca.crt'), '-CAkey', file('ca.key'),
    '-CAcreateserial', '-days', '800', '-sha256', '-extfile', file('server.cnf'), '-extensions', 'ext',
    '-out', file('server.crt'))
  fs.chmodSync(file('server.key'), 0o600)
  fs.writeFileSync(file('server-for.txt'), JSON.stringify({ ips, host, made: Date.now() }))
}

export function ensureCerts() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 })
  if (!fs.existsSync(file('ca.key')) || !fs.existsSync(file('ca.crt'))) makeCA()

  const ips = lanAddresses(), host = hostName()
  let made = null
  try { made = JSON.parse(fs.readFileSync(file('server-for.txt'), 'utf8')) } catch { /* 第一次 */ }
  const stale = !made || made.host !== host || JSON.stringify(made.ips) !== JSON.stringify(ips) ||
    Date.now() - made.made > 700 * 86400000
  if (stale || !fs.existsSync(file('server.crt'))) makeServer(ips, host)

  return { key: fs.readFileSync(file('server.key')), cert: fs.readFileSync(file('server.crt')) }
}
