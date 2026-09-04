/**
 * ANSI 输出预处理过滤器
 *
 * 解决 Docker Compose v2 进度输出在 xterm.js 中导致页面重复增长的问题。
 * Docker Compose 使用 \r + \x1b[NA (光标上移N行) + \x1b[2K (擦除行) 组合
 * 来制作多行动画进度条，但 SSH 小分片传输 + \r\n 与光标移动序列冲突
 * 会产生大量重复行。
 *
 * 策略：
 * 1. 剥离光标移动/擦除等控制序列
 *    - \x1b[NA (光标上移 N 行，N=1..9)
 *    - \x1b[NB (光标下移 N 行)
 *    - \x1b[2K (擦除整行)
 *    - \x1b[?25l/h (光标隐藏/显示)
 * 2. 将独立的 \r（后无 \n）转换为 \n
 * 3. 折叠连续相同行（≥3 次相同内容合并为 "[重复 N 次]" 标记）
 */

// 匹配光标上移/下移 N 行：ESC [ N A/B (N=1..9，Docker Compose 常用 1-4)
const CURSOR_MOVEUpDown_REGEX = /\x1b\[[1-9][AB]/g

// 匹配擦除整行：ESC [ 2 K
const ERASE_LINE_REGEX = /\x1b\[2K/g

// 匹配光标隐藏/显示：ESC [?25l / ESC [?25h
const ANSI_CURSOR_VIS_REGEX = /\x1b\[\?25[hl]/g

// 匹配独立的 \r 后面没有 \n 的情况（用于转换为 \n）
const CR_ONLY_REGEX = /\r(?!\n)/g

// 连续相同行折叠阈值
const FOLD_THRESHOLD = 3

/**
 * 从字符串中剥离 Docker Compose 进度相关的 ANSI 控制序列。
 * 保留正常显示用的 ANSI 序列（颜色、样式等），只剥离影响布局的序列。
 */
function stripProgressSequences(data: string): string {
  let result = data

  // 光标隐藏/显示
  result = result.replace(ANSI_CURSOR_VIS_REGEX, '')

  // 光标上移/下移 N 行（Docker Compose 进度条核心序列）
  // Docker Compose v2 使用 \x1b[4A 上移4行、\x1b[2A 上移2行等
  result = result.replace(CURSOR_MOVEUpDown_REGEX, '')

  // 擦除整行
  result = result.replace(ERASE_LINE_REGEX, '')

  return result
}

/**
 * 将独立的 \r（后无 \n）转换为 \n。
 * Docker Compose 用 \r 回到行首再写入新内容，
 * 在 SSH 小分片传输时可能与后续 \n 组合产生重复行。
 */
function normalizeLineEndings(data: string): string {
  return data.replace(CR_ONLY_REGEX, '\n')
}

/**
 * 折叠连续相同的行（≥3 次）。
 * 返回折叠后的文本。
 */
function foldRepeatedLines(data: string): string {
  const lines = data.split('\n')
  if (lines.length < FOLD_THRESHOLD) return data

  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    let count = 1

    // 向前扫描连续相同的行
    while (
      i + count < lines.length &&
      lines[i + count] === line &&
      line.trim().length > 0 // 跳过空行的折叠
    ) {
      count++
    }

    if (count >= FOLD_THRESHOLD) {
      result.push(line)
      result.push(`\x1b[90m[重复 ${count} 次]\x1b[0m`)
      i += count
    } else {
      // 不够阈值，原样输出
      for (let j = 0; j < count; j++) {
        result.push(lines[i + j]!)
      }
      i += count
    }
  }

  return result.join('\n')
}

/**
 * 预处理 ANSI 终端输出，优化 Docker Compose 等进度输出模式。
 *
 * @param data - 原始终端输出数据
 * @returns 处理后的数据
 */
export function preprocessAnsiOutput(data: string): string {
  // 步骤 1：剥离进度相关的光标控制序列
  let result = stripProgressSequences(data)

  // 步骤 2：统一换行符
  result = normalizeLineEndings(result)

  // 步骤 3：折叠连续重复行
  result = foldRepeatedLines(result)

  return result
}
