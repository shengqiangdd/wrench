const { chromium } = require('/home/agent/cow/wrench/frontend/node_modules/playwright')
const PORT = parseInt(process.argv[2] || '24923')
const BASE = 'http://localhost:' + PORT
const CHROME = '/app/ms-playwright/chromium-1169/chrome-linux/chrome'

let ok = 0, fail = 0
function pass(m) { console.log('  [PASS] ' + m); ok++ }
function no(m) { console.log('  [FAIL] ' + m); fail++ }

async function main() {
  console.log('=== Wrench UI Test ===\n')
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] })

  // PC 1280x720
  console.log('--- PC 1280x720 ---')
  const pc = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  await pc.goto(BASE, { timeout: 5000 }); pass('Page loaded')
  const pcNav = pc.locator('nav').first()
  for (const item of ['常用命令','Docker 管理','性能看板','文件管理','日志聚合','插件','设置']) {
    try { await pcNav.locator('button').filter({ hasText: new RegExp('^' + item + '$') }).first().click({ timeout: 3000 }); await pc.waitForTimeout(400); pass(item) }
    catch(e) { no(item + ': ' + e.message.substring(0, 60)) }
  }
  await pc.close()

  // Mobile 375x667
  console.log('\n--- Mobile 375x667 ---')
  const mb = await (await browser.newContext({ viewport: { width: 375, height: 667 } })).newPage()
  await mb.goto(BASE, { timeout: 5000 }); pass('Page loaded')
  const bc = await mb.locator('nav').last().locator('button').count(); pass('Bottom nav: ' + bc + ' items')
  const mobNav = mb.locator('nav').last()
  for (const item of ['SSH','命令','Docker','监控','文件','日志','插件','设置']) {
    try { await mobNav.locator('button').filter({ hasText: new RegExp('^' + item + '$') }).first().click({ timeout: 3000, force: true }); await mb.waitForTimeout(400); pass(item) }
    catch(e) { no(item + ': ' + e.message.substring(0, 60)) }
  }
  await mb.close()

  // Landscape 667x375
  console.log('\n--- Landscape 667x375 ---')
  const ld = await (await browser.newContext({ viewport: { width: 667, height: 375 } })).newPage()
  await ld.goto(BASE, { timeout: 5000 }); pass('Page loaded')
  const ldNav = ld.locator('nav').last()
  for (const item of ['SSH','命令','Docker','监控','文件','日志','插件','设置']) {
    try { await ldNav.locator('button').filter({ hasText: new RegExp('^' + item + '$') }).first().click({ timeout: 3000, force: true }); await ld.waitForTimeout(400); pass(item) }
    catch(e) { no(item + ': ' + e.message.substring(0, 60)) }
  }
  await ld.close()
  await browser.close()

  const total = ok + fail
  console.log('\n=== ' + (fail === 0 ? 'ALL PASSED' : fail + ' FAILED') + ' (' + ok + '/' + total + ') ===')
  process.exit(fail > 0 ? 1 : 0)
}
main()
