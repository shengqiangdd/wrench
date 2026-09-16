/**
 * 插件市场「源码」链接的白名单化。
 *
 * 回归背景：`PluginMarket` 曾经把市场索引给的 `manifestUrl` 去掉后缀后**原样**
 * 塞进 `<a href>`。索引是远端数据，被投毒成 `javascript:` / `data:text/html,`
 * 时点击即执行脚本。这里锁定"不安全 → 不渲染链接"的契约。
 */

import { describe, it, expect } from 'vitest'
import { pluginSourceUrl } from '@/utils/plugin-source-url'

describe('pluginSourceUrl', () => {
  it('去掉 manifest.json 后缀，保留仓库根地址', () => {
    expect(pluginSourceUrl('https://github.com/me/plugin/manifest.json')).toBe(
      'https://github.com/me/plugin',
    )
    expect(pluginSourceUrl('http://git.internal:3000/a/b/manifest.json')).toBe(
      'http://git.internal:3000/a/b',
    )
  })

  it('本地路径形式的 manifest 保持原样（同源相对链接）', () => {
    expect(pluginSourceUrl('/plugins/demo/manifest.json')).toBe('/plugins/demo')
  })

  it('可执行协议一律拒绝（返回 null，调用方不渲染链接）', () => {
    for (const bad of [
      'javascript:alert(document.cookie)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '  javascript:alert(1)  ',
    ]) {
      expect(pluginSourceUrl(bad), bad).toBeNull()
    }
  })

  it('缺失或空值不渲染链接', () => {
    expect(pluginSourceUrl(undefined)).toBeNull()
    expect(pluginSourceUrl(null)).toBeNull()
    expect(pluginSourceUrl('')).toBeNull()
  })

  it('后缀不在末尾时不误裁剪路径', () => {
    expect(pluginSourceUrl('https://github.com/a/manifest.json.bak')).toBe(
      'https://github.com/a/manifest.json.bak',
    )
  })
})
