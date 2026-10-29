// 共享的无头 Chrome 实例(PDF 报告 + 分享海报共用一个浏览器,省内存;崩了自动重启)。
import puppeteer from 'puppeteer'

let _browser = null
export async function getBrowser() {
  if (_browser) {
    try { if (_browser.connected !== false && (!_browser.isConnected || _browser.isConnected())) return _browser } catch { /* fallthrough */ }
    _browser = null
  }
  _browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  })
  _browser.on('disconnected', () => { _browser = null })
  return _browser
}
