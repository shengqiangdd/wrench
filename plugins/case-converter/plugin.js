// 命名风格转换插件
(function () {
  const api = Wrench.getPluginAPI()

  /**
   * 将任意命名风格拆分为单词数组
   * 支持: camelCase, PascalCase, snake_case, kebab-case, UPPER_CASE, 混写
   */
  function splitWords(str) {
    const words = []
    // 先按下划线/连字符拆分
    const parts = str.split(/[-_]/)
    for (const part of parts) {
      if (!part) continue
      // 进一步按大写字母拆分 (处理 camelCase / PascalCase)
      // 匹配: 连续大写字母开头 + 小写字母（如 "HELLO" 或 "Hello"），或单独小写单词
      const segments = part.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z][a-z]*|[a-z]+|\d+/g)
      if (segments) {
        for (const seg of segments) {
          words.push(seg.toLowerCase())
        }
      } else if (part) {
        words.push(part.toLowerCase())
      }
    }
    return words.length > 0 ? words : [str.toLowerCase()]
  }

  /** 单词数组 → camelCase */
  function toCamel(words) {
    if (words.length === 0) return ''
    return words[0] + words.slice(1).map(w => w[0].toUpperCase() + w.slice(1)).join('')
  }

  /** 单词数组 → PascalCase */
  function toPascal(words) {
    return words.map(w => w[0].toUpperCase() + w.slice(1)).join('')
  }

  /** 单词数组 → snake_case */
  function toSnake(words) {
    return words.join('_')
  }

  /** 单词数组 → kebab-case */
  function toKebab(words) {
    return words.join('-')
  }

  /** 单词数组 → UPPER_CASE */
  function toUpper(words) {
    return words.join('_').toUpperCase()
  }

  /** 提取编辑器中的待转换标识符列表 */
  function extractIdentifiers(text) {
    // 匹配常见的标识符: 字母/数字/下划线/连字符组成的词，且至少包含一个字母
    const regex = /[a-zA-Z_][a-zA-Z0-9_-]*/g
    const matches = text.match(regex)
    if (!matches) return []
    // 去重且保留顺序
    const seen = new Set()
    return matches.filter(m => {
      // 至少有一个字母
      if (!/[a-zA-Z]/.test(m)) return false
      if (seen.has(m)) return false
      seen.add(m)
      return true
    })
  }

  /** 批量转换并输出结果 */
  function batchConvert(converter, targetName) {
    const content = api.getEditorContent()
    if (!content) {
      api.showNotification('请先在编辑器中打开文件', 'warning')
      return
    }

    const identifiers = extractIdentifiers(content)
    if (identifiers.length === 0) {
      api.showNotification('未找到可转换的标识符', 'warning')
      return
    }

    const lines = []
    for (const id of identifiers) {
      const words = splitWords(id)
      const converted = converter(words)
      if (converted !== id) {
        lines.push(`${id}  →  ${converted}`)
      }
    }

    if (lines.length === 0) {
      api.showNotification(`所有标识符已经是 ${targetName} 格式`, 'info')
      return
    }

    api.setEditorContent(lines.join('\n'))
    api.showNotification(`转换完成: ${lines.length} 个标识符 → ${targetName}`, 'success')
  }

  api.registerCommand('case-to-camel', {
    label: '转 camelCase',
    description: '转换标识符为驼峰命名: helloWorld',
    execute: () => batchConvert(toCamel, 'camelCase')
  })

  api.registerCommand('case-to-pascal', {
    label: '转 PascalCase',
    description: '转换标识符为大驼峰命名: HelloWorld',
    execute: () => batchConvert(toPascal, 'PascalCase')
  })

  api.registerCommand('case-to-snake', {
    label: '转 snake_case',
    description: '转换标识符为下划线命名: hello_world',
    execute: () => batchConvert(toSnake, 'snake_case')
  })

  api.registerCommand('case-to-kebab', {
    label: '转 kebab-case',
    description: '转换标识符为连字符命名: hello-world',
    execute: () => batchConvert(toKebab, 'kebab-case')
  })

  api.registerCommand('case-to-upper', {
    label: '转 UPPER_CASE',
    description: '转换标识符为大写下划线命名: HELLO_WORLD',
    execute: () => batchConvert(toUpper, 'UPPER_CASE')
  })

  console.log('[插件] 命名风格转换工具已加载')
})()
