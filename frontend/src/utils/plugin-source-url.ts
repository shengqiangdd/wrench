import { safeUrl } from './markdown'

/**
 * 插件市场列表里「源码」链接的地址：`manifestUrl` 去掉 `/manifest.json` 后缀。
 *
 * `manifestUrl` 来自**服务端市场索引**（远端数据，见 backend/src/api/market.rs），
 * 属于不可信输入：原样塞进 `<a href>` 时，索引一旦被投毒成 `javascript:...` 或
 * `data:text/html,...`，点击即在本页面上下文里执行脚本 —— 等价于把一条 XSS 入口
 * 交给市场索引。因此这里和 MarkdownPreview / AiSidebar 一样过 `safeUrl` 白名单。
 *
 * 返回 `null` 表示"不渲染链接"（而不是渲染一个点了没反应的死链）。
 */
export function pluginSourceUrl(manifestUrl?: string | null): string | null {
  if (!manifestUrl) return null
  const root = manifestUrl.replace(/\/manifest\.json$/, '')
  const safe = safeUrl(root)
  return safe === '#' ? null : safe
}
