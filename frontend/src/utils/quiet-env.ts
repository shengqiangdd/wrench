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
