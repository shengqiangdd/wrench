/**
 * markdown 渲染安全回归测试（`src/utils/markdown.ts`）
 *
 * 背景：`MarkdownPreview` 把这些 HTML 交给 `dangerouslySetInnerHTML`，
 * `AiSidebar` 用同一套 `safeUrl` 渲染链接（其输入是模型输出）。两处的 markdown
 * 来源都不可信（AI 回复、日志内容、项目文件、剪贴板），所以这里锁死三件事：
 *   1. 链接/图片的目标只允许 http(s) / mailto / 站内相对路径与锚点；
 *      `javascript:`、`data:text/html`、`vbscript:` 一律降级为 `#`
 *      （点一下就在本页执行脚本，而本页存着会话令牌与已连接的 SSH 会话）。
 *   2. 裸 HTML 仍然被转义，不会变成可执行元素。
 *   3. 引号先被转义成实体，URL 里的引号逃不出 `href` 属性。
 *
 * 直接测纯函数（inlineMarkdownToHtml / renderMarkdown / safeUrl）而不渲染 React 树：
 * jsdom + React 19 的 act 在 CJS/ESM 混载下不稳定，而风险点就在字符串转换本身。
 */
import { describe, it, expect } from 'vitest'
import { renderMarkdown, inlineMarkdownToHtml, safeUrl } from '@/utils/markdown'

function hrefs(html: string): string[] {
  return Array.from(html.matchAll(/<a href="([^"]*)"/g), (m) => m[1]!)
}

function srcs(html: string): string[] {
  return Array.from(html.matchAll(/<img src="([^"]*)"/g), (m) => m[1]!)
}

describe('markdown 链接安全', () => {
  it('把 javascript: 链接降级为 #', () => {
    expect(hrefs(inlineMarkdownToHtml('[点我](javascript:alert(1))'))).toEqual(['#'])
  })

  it('把 data:text/html 链接降级为 #（data URL 可执行脚本）', () => {
    const html = inlineMarkdownToHtml(
      '[点我](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    )
    expect(hrefs(html)).toEqual(['#'])
  })

  it('把 vbscript: 链接降级为 #', () => {
    expect(hrefs(inlineMarkdownToHtml('[点我](vbscript:msgbox(1))'))).toEqual(['#'])
  })

  it('大小写与空白变体也挡得住', () => {
    expect(hrefs(inlineMarkdownToHtml('[点我](JaVaScRiPt:alert(1))'))).toEqual(['#'])
    expect(hrefs(inlineMarkdownToHtml('[点我]( javascript:alert(1))'))).toEqual(['#'])
  })

  it('保留 http(s) / mailto / 站内链接与锚点', () => {
    const html = inlineMarkdownToHtml(
      '[a](https://example.com/x?y=1) [b](http://example.com) [c](mailto:me@example.com) [d](/devices) [e](#top)',
    )
    expect(hrefs(html)).toEqual([
      'https://example.com/x?y=1',
      'http://example.com',
      'mailto:me@example.com',
      '/devices',
      '#top',
    ])
  })

  it('外链带上 noopener/noreferrer 并新窗口打开', () => {
    const html = inlineMarkdownToHtml('[a](https://example.com)')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('图片允许 data:image/*，但拒绝 javascript:', () => {
    expect(srcs(inlineMarkdownToHtml('![pixel](data:image/png;base64,iVBORw0KGgo=)'))).toEqual([
      'data:image/png;base64,iVBORw0KGgo=',
    ])
    expect(srcs(inlineMarkdownToHtml('![x](javascript:alert(1))'))).toEqual(['#'])
  })

  // 端到端：列表项会走行内渲染，这是 javascript: 链接真正能到达的地方
  it('列表项里的 javascript: 链接同样被降级（端到端）', () => {
    const html = renderMarkdown('- [点我](javascript:alert(1))\n- [正常](https://example.com)')
    expect(hrefs(html)).toEqual(['#', 'https://example.com'])
  })

  it('裸 HTML 被转义，不会变成可执行元素', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('URL 里的引号逃不出 href 属性', () => {
    const html = renderMarkdown('[x](https://example.com/" onmouseover="alert(1))')
    expect(html).not.toContain('onmouseover="alert(1)"')
    expect(html).toContain('&quot;')
  })
})

describe('safeUrl（MarkdownPreview 与 AiSidebar 共用）', () => {
  it('相对路径与锚点放行', () => {
    expect(safeUrl('/devices')).toBe('/devices')
    expect(safeUrl('#top')).toBe('#top')
  })

  it('危险协议降级为 #', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:msgbox(1)']) {
      expect(safeUrl(bad)).toBe('#')
    }
  })

  it('data: 只有图片允许（且必须显式开启）', () => {
    expect(safeUrl('data:image/png;base64,AAA', { allowImageData: true })).toBe(
      'data:image/png;base64,AAA',
    )
    expect(safeUrl('data:image/png;base64,AAA')).toBe('#')
    expect(safeUrl('data:text/html,<b>x</b>', { allowImageData: true })).toBe('#')
  })
})
