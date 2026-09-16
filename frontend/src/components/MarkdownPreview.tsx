/**
 * MarkdownPreview — Markdown 实时预览组件
 *
 * 轻量实现，无外部依赖。markdown → HTML 的转换本身（以及 HTML 转义、
 * 链接/图片目标白名单这些安全边界）在 `utils/markdown.ts`：
 * 组件文件只导出组件（ESLint `react-refresh/only-export-components`），
 * 纯函数放 utils 才能被单测直接调用。
 *
 * 支持：
 * - 标题（# ~ ######）
 * - 代码块（\`\`\` 和 \` 行内代码）
 * - 表格
 * - 列表（有序/无序/嵌套）
 * - 链接、图片（仅 http(s) / mailto / 站内相对路径与锚点）
 * - 粗体、斜体、删除线、下划线
 * - 引用块
 * - 水平线
 * - 任务列表
 * - HTML 转义（XSS 防护）
 */

import { renderMarkdown } from '../utils/markdown'

interface MarkdownPreviewProps {
  content: string
  className?: string
}

export default function MarkdownPreview({ content, className = '' }: MarkdownPreviewProps) {
  const html = renderMarkdown(content)

  return (
    <div className={`markdown-preview ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
  )
}
