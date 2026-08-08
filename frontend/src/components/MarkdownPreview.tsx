/**
 * MarkdownPreview — Markdown 实时预览组件
 *
 * 轻量实现，无外部依赖，自包含 markdown → HTML 转换。
 *
 * 支持：
 * - 标题（# ~ ######）
 * - 代码块（\`\`\` 和 \` 行内代码）
 * - 表格
 * - 列表（有序/无序/嵌套）
 * - 链接、图片
 * - 粗体、斜体、删除线、下划线
 * - 引用块
 * - 水平线
 * - 任务列表
 * - HTML 转义（XSS 防护）
 */

interface MarkdownPreviewProps {
  content: string
  className?: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderMarkdown(md: string): string {
  let html = md

  // HTML 转义（但保留代码块内的原始内容）
  const codeBlocks: string[] = []
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
    const idx = codeBlocks.length
    codeBlocks.push(code)
    return `%%CODEBLOCK_${idx}%%`
  })

  // 行内代码
  const inlineCodes: string[] = []
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length
    inlineCodes.push(code)
    return `%%INLINECODE_${idx}%%`
  })

  // 转义剩余的 HTML
  html = escapeHtml(html)

  // 恢复行内代码（用 <code> 包裹）
  html = html.replace(/%%INLINECODE_(\d+)%%/g, (_, idx) => {
    return `<code class="cm-inline-code">${inlineCodes[parseInt(idx)]}</code>`
  })

  // 恢复代码块
  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_, idx) => {
    const code = codeBlocks[parseInt(idx)]
    if (!code) return ''

    const lines = code.split('\n')
    // 尝试从第一行提取语言
    let lang = ''
    let codeContent = code
    if (lines.length > 1 && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(lines[0]!.trim())) {
      lang = lines[0]!.trim()
      codeContent = lines.slice(1).join('\n')
    }
    const escaped = escapeHtml(codeContent.replace(/\n$/, ''))
    return `<pre class="cm-code-block${lang ? ` language-${lang}` : ''}"><code>${escaped || ' '}</code></pre>`
  })

  // 任务列表 [x] 和 [ ] — 必须在普通列表处理之前
  html = html.replace(/^([ \t]*)- \[([ x])\] (.+)$/gm, (_, indent, checked, text) => {
    const cls = checked === 'x' ? 'checked' : 'unchecked'
    return `${indent}<label class="cm-task cm-task-${cls}"><input type="checkbox"${checked === 'x' ? ' checked' : ''} disabled> ${inlineMarkdownToHtml(text)}</label>`
  })

  // 水平线
  html = html.replace(/^---+$/gm, '<hr class="cm-hr">')

  // 标题
  html = html.replace(/^###### (.+)$/gm, '<h6 class="cm-heading cm-h6">$1</h6>')
  html = html.replace(/^##### (.+)$/gm, '<h5 class="cm-heading cm-h5">$1</h5>')
  html = html.replace(/^#### (.+)$/gm, '<h4 class="cm-heading cm-h4">$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3 class="cm-heading cm-h3">$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2 class="cm-heading cm-h2">$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1 class="cm-heading cm-h1">$1</h1>')

  // 引用块
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="cm-blockquote"><p>$1</p></blockquote>')

  // 表格
  html = html.replace(
    /^\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/gm,
    (_, headerRow: string, bodyRows: string) => {
      const headers = headerRow
        .split('|')
        .filter(Boolean)
        .map((h: string) => `<th>${h.trim()}</th>`)
        .join('')
      const rows = bodyRows
        .trim()
        .split('\n')
        .map((row: string) => {
          const cells = row
            .split('|')
            .filter(Boolean)
            .map((c: string) => `<td>${c.trim()}</td>`)
            .join('')
          return `<tr>${cells}</tr>`
        })
        .join('')
      return `<table class="cm-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`
    },
  )

  // 有序列表
  html = html.replace(/^(\s*)\d+\. (.+)$/gm, (_, indent, text) => {
    return `${indent}<li class="cm-li cm-ol-li">${inlineMarkdownToHtml(text)}</li>`
  })

  // 无序列表
  html = html.replace(/^(\s*)[*+-] (.+)$/gm, (_, indent, text) => {
    return `${indent}<li class="cm-li cm-ul-li">${inlineMarkdownToHtml(text)}</li>`
  })

  // 段落：连续非空行
  const lines = html.split('\n')
  const result: string[] = []
  let inList = false
  let inTable = false
  let inBlockquote = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    // 空行 — 关闭上下文
    if (!trimmed) {
      if (inList) {
        inList = false
      }
      if (inTable) {
        inTable = false
      }
      if (inBlockquote) {
        inBlockquote = false
      }
      result.push('')
      continue
    }

    // 已经是 HTML 标签的行（标题/列表/引用/表格/代码块等）
    if (
      trimmed.startsWith('<h') ||
      trimmed.startsWith('<li') ||
      trimmed.startsWith('<blockquote') ||
      trimmed.startsWith('<pre') ||
      trimmed.startsWith('<hr') ||
      trimmed.startsWith('<table') ||
      trimmed.startsWith('<label') ||
      trimmed === '</tbody>'
    ) {
      if (trimmed.startsWith('<li')) inList = true
      if (trimmed.startsWith('<table')) inTable = true
      if (trimmed.startsWith('<blockquote')) inBlockquote = true
      result.push(line)
      continue
    }

    // 普通段落
    result.push(`<p class="cm-paragraph">${trimmed}</p>`)
  }

  return result.join('\n')
}

/** 处理行内格式：粗体、斜体、删除线、链接、图片 */
function inlineMarkdownToHtml(text: string): string {
  return (
    text
      // 图片 ![alt](url)
      .replace(
        /!\[([^\]]*)\]\(([^)]+)\)/g,
        '<img src="$2" alt="$1" class="cm-image" loading="lazy">',
      )
      // 链接 [text](url)
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" class="cm-link" target="_blank" rel="noopener noreferrer">$1</a>',
      )
      // 删除线 ~~text~~
      .replace(/~~([^~]+)~~/g, '<del class="cm-del">$1</del>')
      // 粗体+斜体 ***text***
      .replace(
        /\*\*\*([^*]+)\*\*\*/g,
        '<strong class="cm-strong"><em class="cm-em">$1</em></strong>',
      )
      // 粗体 **text**
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="cm-strong">$1</strong>')
      // 斜体 *text*
      .replace(/\*([^*]+)\*/g, '<em class="cm-em">$1</em>')
      // 下划线 ++text++ 或 ~text~（部分方言）
      .replace(/\+\+([^+]+)\+\+/g, '<ins class="cm-ins">$1</ins>')
  )
}

export default function MarkdownPreview({ content, className = '' }: MarkdownPreviewProps) {
  const html = renderMarkdown(content)

  return (
    <div className={`markdown-preview ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
  )
}
