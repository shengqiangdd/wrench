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
 */

// 匹配光标上移/下移 N 行：ESC [ N A/B（N 可多位数，Docker Compose 常用 1-10）
// 实测 compose v2.40 会输出连续 \x1b[1A×10 序列
const CURSOR_MOVEUpDown_REGEX = /\x1b\[[0-9]+[AB]/g

// 匹配光标水平定位：ESC [ N G（含 \x1b[0G 回到列0，compose 进度条重绘核心序列）
const CURSOR_COLUMN_REGEX = /\x1b\[[0-9]*[G]/g

// 匹配擦除整行：ESC [ 2 K
const ERASE_LINE_REGEX = /\x1b\[2K/g

// 匹配光标隐藏/显示：ESC [?25l / ESC [?25h
const ANSI_CURSOR_VIS_REGEX = /\x1b\[\?25[hl]/g

// 匹配独立的 \r 后面没有 \n 的情况（用于转换为 \n）
const CR_ONLY_REGEX = /\r(?!\n)/g

/**
 * 从字符串中剥离 Docker Compose 进度相关的 ANSI 控制序列。
 * 保留正常显示用的 ANSI 序列（颜色、样式等），只剥离影响布局的序列。
 */
function stripProgressSequences(data: string): string {
  let result = data

  // 光标隐藏/显示
  result = result.replace(ANSI_CURSOR_VIS_REGEX, '')

  // 光标上移/下移 N 行（Docker Compose 进度条核心序列）
  // Docker Compose v2 使用 \x1b[10A 上移10行等（多位数 + 连续多个单步序列）
  result = result.replace(CURSOR_MOVEUpDown_REGEX, '')

  // 光标水平定位到列 N（\x1b[0G 等，compose 每次重绘进度行都会用）
  result = result.replace(CURSOR_COLUMN_REGEX, '')

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

  return result
}
