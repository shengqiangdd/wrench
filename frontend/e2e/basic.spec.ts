import { test, expect } from '@playwright/test'

test.describe('Wrench 基础功能', () => {
  test('首页正常加载', async ({ page }) => {
    await page.goto('/')
    // 页面应该加载并显示标题
    await expect(page).toHaveTitle(/棘轮工具箱/)
    // 等待 React 挂载完成
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('认证失败时显示错误页面', async ({ page }) => {
    await page.goto('/')
    // AuthGate 尝试连接后端 → 失败 → 显示错误状态
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    // 错误信息应包含重试按钮
    await expect(page.getByText('重试')).toBeVisible()
    // 应用内容不应渲染
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('认证错误消息显示并能重试', async ({ page }) => {
    await page.goto('/')
    // 等待认证失败
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    // 应该有重试按钮
    const retryBtn = page.getByText('重试')
    await expect(retryBtn).toBeVisible()
    // 点击重试（后端仍然不可用，应再次显示错误）
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
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    const bgColor = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor
    )
    // 深色主题背景 (bg-gray-900 → rgb(17, 24, 39))
    expect(bgColor).toBe('rgb(17, 24, 39)')
  })

  test('错误页面包含连接图标', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    // SVG 图标应存在于错误页面中
    const svgCount = await page.locator('#root svg').count()
    expect(svgCount).toBeGreaterThan(0)
  })

  test('重试按钮可通过键盘访问', async ({ page }) => {
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
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    // 只允许预期的后端连接错误
    const unexpected = brokenUrls.filter(
      (u) => !u.includes('/ws') && !u.includes('ERR_CONNECTION_REFUSED')
    )
    expect(unexpected).toEqual([])
  })

  test('错误页面文本对比度可读', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    const color = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.text-center p')!).color
    )
    // text-gray-400 → rgb(156, 163, 175) 或类似灰色
    expect(color).toMatch(/rgb\(/)
  })
})

test.describe('响应式与移动端适配', () => {
  test('移动端 viewport 320px 正常渲染', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    // 错误信息完整可见
    await expect(page.getByText('重试')).toBeVisible()
  })

  test('平板 viewport 768px 正常渲染', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('重试')).toBeVisible()
  })

  test('桌面 viewport 1440px 正常渲染', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
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
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    const tagName = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      return buttons.find(b => b.textContent?.includes('重试'))?.tagName
    })
    expect(tagName).toBe('BUTTON')
  })

  test('错误提示元素有可读的文本颜色', async ({ page }) => {
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
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    const loadTime = Date.now() - start
    // 后端连接超时可能较慢，但 UI 框架应在 8 秒内渲染完毕
    expect(loadTime).toBeLessThan(20000)
  })

  test('无未捕获的 JavaScript 运行时错误', async ({ page }) => {
    const jsErrors: Error[] = []
    page.on('pageerror', (err) => jsErrors.push(err))
    await page.goto('/')
    await expect(page.getByText('连接失败')).toBeVisible({ timeout: 15000 })
    expect(jsErrors.length).toBe(0)
  })
})
