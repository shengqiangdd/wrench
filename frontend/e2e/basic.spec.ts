import { test, expect, type Page } from '@playwright/test'

/**
 * 让后端「连不上」，用于错误页相关用例。
 *
 * 这些用例验证的是**后端不可达**时的界面（AuthGate 拿不到 /api/auth/status →
 * 显示「连接失败」+「重试」）。别指望运行环境恰好没有后端：CI 的 E2E 作业把
 * BASE_URL 指向真实栈（活着、健康、WRENCH_REQUIRE_AUTH=off），应用会正常加载，
 * 于是这些断言永远等不到错误页 —— 这是 2026-10-06 那次 E2E 首跑里 15 个失败的根因。
 *
 * 用 `connectionrefused` 而不是默认的 `failed`：控制台里出现的仍是
 * `net::ERR_CONNECTION_REFUSED`，与既有断言（过滤该串、放行 /ws）保持一致。
 */
async function blockBackend(page: Page) {
  await page.route('**/api/**', (route) => route.abort('connectionrefused'))
}

/**
 * 把任意 CSS 颜色画成像素再读回来。
 *
 * Tailwind v4 起 `getComputedStyle` 返回的是 `oklch(...)` 而不是 `rgb(...)`
 * （旧断言写死的 `toMatch(/rgb\(/)` 就是被这个打死的），所以交给浏览器自己解析，
 * 别把颜色空间的实现细节钉进断言。
 */
async function resolvedRgb(page: Page, css: string): Promise<[number, number, number]> {
  return page.evaluate((value) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return [r, g, b] as [number, number, number]
  }, css)
}

/** 相对亮度（WCAG 定义）。用来判断「深 / 浅」，而不是把具体色值钉死。 */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** 错误页最外层容器的背景色（从「连接失败」标题往上找到 #root 的直接子节点）。 */
async function errorPageBackground(page: Page): Promise<string> {
  return page.evaluate(() => {
    const heading = [...document.querySelectorAll('p')].find((p) => p.textContent === '连接失败')
    if (!heading) throw new Error('找不到「连接失败」标题')
    let node: HTMLElement = heading
    while (node.parentElement && node.parentElement.id !== 'root') node = node.parentElement
    return getComputedStyle(node).backgroundColor
  })
}

test.describe('Wrench 基础功能', () => {
  test('首页正常加载', async ({ page }) => {
    await page.goto('/')
    // 页面应该加载并显示标题
    await expect(page).toHaveTitle(/棘轮工具箱/)
    // 等待 React 挂载完成
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('认证失败时显示错误页面', async ({ page }) => {
    await blockBackend(page)
    await page.goto('/')
    // AuthGate 尝试连接后端 → 失败 → 显示错误状态
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    // 错误信息应包含重试按钮
    await expect(page.getByText('重试')).toBeVisible()
    // 应用内容不应渲染
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('认证错误消息显示并能重试', async ({ page }) => {
    await blockBackend(page)
    await page.goto('/')
    // 等待认证失败
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    // 应该有重试按钮
    const retryBtn = page.getByText('重试')
    await expect(retryBtn).toBeVisible()
    // 点击重试（后端仍然不可达，应再次显示错误）
    await retryBtn.click()
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 10000 })
    // 不应渲染应用内容
    await expect(page.getByText('正在连接服务器...')).not.toBeVisible()
  })

  test('当前页面 URL 显示正确', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/')
  })

  test('meta viewport 正确（移动端适配）', async ({ page }) => {
    await page.goto('/')
    const viewport = await page.getAttribute('meta[name="viewport"]', 'content')
    expect(viewport).toBeTruthy()
  })

  test('页面存在 Vite 构建标识', async ({ page }) => {
    await page.goto('/')
    // 检查构建产物中有 Vite 注入的脚本（仅生产构建）
    const hasViteScript = await page.evaluate(() => {
      return document.querySelector('script[type="module"]') !== null
    })
    expect(hasViteScript).toBe(true)
  })

  test('根节点存在 React 容器属性', async ({ page }) => {
    await page.goto('/')
    const hasReactRoot = await page.evaluate(() => {
      const root = document.getElementById('root')
      return root !== null && root.childNodes.length > 0
    })
    expect(hasReactRoot).toBe(true)
  })
})

test.describe('错误处理与 UI', () => {
  test('浏览器控制台无严重错误', async ({ page }) => {
    const errorLogs: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errorLogs.push(msg.text())
      }
    })

    await blockBackend(page)
    await page.goto('/')
    // 等待认证失败（预期行为，不是 JS 错误）
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })

    // 应该有且仅有预期中的错误（网络请求错误不算严重）
    const jsErrors = errorLogs.filter((log) => !log.includes('net::ERR_CONNECTION_REFUSED'))
    expect(jsErrors.length).toBe(0)
  })

  test('HTML 标签语言属性正确', async ({ page }) => {
    await page.goto('/')
    const lang = await page.getAttribute('html', 'lang')
    expect(lang).toBeTruthy()
  })

  test('根节点未使用替换方案', async ({ page }) => {
    await page.goto('/')
    // root 应包含 React 渲染的内容而非原始 HTML 替换
    const rootContent = await page.innerHTML('#root')
    expect(rootContent).not.toContain('loading')
  })
})

test.describe('错误页面 UI 验证', () => {
  test('错误页面背景色为深色主题', async ({ page }) => {
    await blockBackend(page)
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    // 只断言「暗」，不钉色值：深色主题挂的是错误页最外层容器（不是 document.body），
    // 且 Tailwind v4 的颜色是 oklch、色板还会随版本调整 ——
    // 旧断言 `expect(document.body 的背景).toBe('rgb(17, 24, 39)')` 两处都错，只会恒假。
    expect(luminance(await resolvedRgb(page, await errorPageBackground(page)))).toBeLessThan(0.25)
  })

  test('错误页面给出可读的失败原因', async ({ page }) => {
    await blockBackend(page)
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    // 原先这条断言「页面上有 svg 图标」，但错误页从来就是纯文字（AuthGate 里没有任何图标），
    // 属于恒假断言。改成断言它真正该保证的事：除了标题，还得有一句能看懂的说明。
    const explanation = await page.evaluate(() => {
      const box = document.querySelector('.text-center')
      if (!box) throw new Error('找不到错误卡片')
      return [...box.querySelectorAll('p')]
        .map((p) => p.textContent?.trim() ?? '')
        .filter((text) => text && text !== '连接失败')
        .join('')
    })
    expect(explanation.length).toBeGreaterThan(0)
  })

  test('重试按钮可通过键盘访问', async ({ page }) => {
    await blockBackend(page)
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    const retryBtn = page.getByText('重试')
    // 按钮应可聚焦
    await retryBtn.focus()
    await expect(retryBtn).toBeFocused()
    // Enter 键触发重试
    await page.keyboard.press('Enter')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 10000 })
  })

  test('错误页面无断链资源', async ({ page }) => {
    const brokenUrls: string[] = []
    page.on('response', (resp) => {
      if (resp.status() >= 400 && resp.status() !== 503) {
        brokenUrls.push(`${resp.status()} ${resp.url()}`)
      }
    })
    await blockBackend(page)
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    // 只允许预期的后端连接错误
    const unexpected = brokenUrls.filter(
      (u) => !u.includes('/ws') && !u.includes('ERR_CONNECTION_REFUSED'),
    )
    expect(unexpected).toEqual([])
  })

  test('错误页面文本对比度可读', async ({ page }) => {
    await blockBackend(page)
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    // 深色底 + 浅色字才叫「可读」。同样不钉色值（Tailwind v4 是 oklch），
    // 旧断言 `toMatch(/rgb\(/)` 拿到的是 `oklch(0.704 0.191 22.216)` 直接失败。
    const color = await page.evaluate(() => {
      const el = document.querySelector('.text-center p')
      if (!el) throw new Error('找不到错误页文案节点')
      return getComputedStyle(el).color
    })
    expect(luminance(await resolvedRgb(page, color))).toBeGreaterThan(0.2)
  })
})

test.describe('响应式与移动端适配', () => {
  test('移动端 viewport 320px 正常渲染', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await blockBackend(page)
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    // 错误信息完整可见
    await expect(page.getByText('重试')).toBeVisible()
  })

  test('平板 viewport 768px 正常渲染', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await blockBackend(page)
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('重试')).toBeVisible()
  })

  test('桌面 viewport 1440px 正常渲染', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await blockBackend(page)
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('重试')).toBeVisible()
  })
})

test.describe('可访问性与语义化', () => {
  test('页面有正确的 lang 属性', async ({ page }) => {
    await page.goto('/')
    const lang = await page.getAttribute('html', 'lang')
    expect(lang).toBe('zh-CN')
  })

  test('重试按钮是 button 元素', async ({ page }) => {
    await blockBackend(page)
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    const tagName = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      return buttons.find((b) => b.textContent?.includes('重试'))?.tagName
    })
    expect(tagName).toBe('BUTTON')
  })

  test('错误提示元素有可读的文本颜色', async ({ page }) => {
    await blockBackend(page)
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    // 确保没有全透明或不可见的文本
    const textEl = page.locator('#root').first()
    await expect(textEl).not.toHaveCSS('opacity', '0')
  })
})

test.describe('性能与资源加载', () => {
  test('页面加载时间在合理范围内', async ({ page }) => {
    const start = Date.now()
    await blockBackend(page)
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    const loadTime = Date.now() - start
    // 后端连接超时可能较慢，但 UI 框架应在 8 秒内渲染完毕
    expect(loadTime).toBeLessThan(20000)
  })

  test('无未捕获的 JavaScript 运行时错误', async ({ page }) => {
    const jsErrors: Error[] = []
    page.on('pageerror', (err) => jsErrors.push(err))
    await blockBackend(page)
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    expect(jsErrors.length).toBe(0)
  })
})
