/**
 * 终端「安静进度」变量组 —— 把"整块重画"型进度 UI 变成逐行纯文本。
 *
 * 背景（实测数据，视口 44 列 × 12 行 ≈ 手机键盘弹起后的高度）：
 *
 * - 用 `ESC[nA` 把整块进度"上移回块首"再重画的程序，每帧会往 scrollback
 *   永久丢 (块高 − 可见行数) 行。docker compose 的 `[+] Pulling` 块高 =
 *   1 + 服务数，20 服务跑一次 pull 实测堆出 3012 行（其中 2151 行重复，
 *   单个服务最多被重画 281 次）；同一条件换成 plain 输出是 943 行、无重复块。
 * - 这类程序的修复只有两条路：让它别整块重画（本文件的开关），
 *   或者给终端更多行数（终端尺寸层面，代价见 docs/ARCHITECTURE.md）。
 *
 * 覆盖范围只针对"整块重画"的工具：
 *
 * - `COMPOSE_PROGRESS=plain` — docker compose 全部子命令（pull / push /
 *   build / up / down / create …），日志逐行追加，任何行数列数下都稳定。
 * - `BUILDKIT_PROGRESS=plain` — 裸 `docker build` / `docker buildx`（不经
 *   compose 时 compose 的开关管不到它）。
 * - `DOCKER_CLI_HINTS=false` — 关掉 docker 的 "What's Next" 气泡，纯降噪。
 *
 * 刻意**不**覆盖单行 `\r` 原地刷新的进度条（wget / curl / pip / npm /
 * cargo / rsync）：它们永远在同一行覆盖，结构上不会堆行，保留动画更有用。
 *
 * **注入时机**：默认不注入。这些变量只在用户主动选择「日志逐行输出」且探测到真实
 * shell 提示符后注入（见 `shell-prompt.ts`）；默认由本地终端画布容纳进度块。
 */

/** 变量名 → 值。值里不能有空格：注入行是 `export A=1 B=2` 形式，会被 word split。 */
export const QUIET_PROGRESS_ENV: ReadonlyArray<readonly [string, string]> = [
  ['COMPOSE_PROGRESS', 'plain'],
  ['BUILDKIT_PROGRESS', 'plain'],
  ['DOCKER_CLI_HINTS', 'false'],
]

/** 注入行：`export COMPOSE_PROGRESS=plain BUILDKIT_PROGRESS=plain DOCKER_CLI_HINTS=false` */
export function buildQuietProgressExportLine(
  env: ReadonlyArray<readonly [string, string]> = QUIET_PROGRESS_ENV,
): string {
  return `export ${env.map(([name, value]) => `${name}=${value}`).join(' ')}`
}

/**
 * 撤销行。注意：撤销是"整组 unset"，若用户在远端自己 export 过同名变量，
 * 关开关会一并清掉——这四个变量本来就是 docker 的展示开关，影响面可控。
 */
export function buildQuietProgressUnsetLine(
  env: ReadonlyArray<readonly [string, string]> = QUIET_PROGRESS_ENV,
): string {
  return `unset ${env.map(([name]) => name).join(' ')}`
}

/** 变量名列表（供提示文案 / 调试使用） */
export function quietProgressVarNames(
  env: ReadonlyArray<readonly [string, string]> = QUIET_PROGRESS_ENV,
): string[] {
  return env.map(([name]) => name)
}

/** 用户显式选择「进度纯文本」的存储键 */
export const QUIET_PROGRESS_STORAGE_KEY = 'wrench_ssh_quiet_progress'
/** 老键（语义已从"只 compose"扩到 docker 全家族，读到就当作显式选择） */
export const QUIET_PROGRESS_LEGACY_STORAGE_KEY = 'wrench_ssh_compose_plain'

/**
 * 安静变量组的默认值：**关闭注入**。
 *
 * 不向远端 shell 注入任何 export 命令，连接体验保持干净。Docker Compose / BuildKit 的
 * 进度保护由本地终端画布自动容纳；「日志逐行输出」只作为用户主动选择的高级兼容模式。
 * `canvasOn` 参数保留是为了兼容已有调用方和测试；默认策略不再跟随它变化。
 */
export function defaultQuietProgress(_canvasOn: boolean): boolean {
  // 默认由本地终端画布容纳进度块，不向远端 shell 注入 export。
  // 保留该函数和返回值类型，兼容显示菜单的“高级覆盖”与旧调用方。
  return false
}

/**
 * 解析「进度纯文本」的初值。
 *
 * @param stored  localStorage 里读到的值（老键已合并进来）；`null` = 用户从没选过
 * @param canvasOn 保留的兼容参数；默认策略不再受其影响
 * @returns `value` = 本次会话是否注入；`manual` = 是否是用户显式选过
 */
export function resolveQuietProgress(
  stored: string | null,
  canvasOn: boolean,
): { value: boolean; manual: boolean } {
  if (stored === null) return { value: defaultQuietProgress(canvasOn), manual: false }
  return { value: stored === '1', manual: true }
}
