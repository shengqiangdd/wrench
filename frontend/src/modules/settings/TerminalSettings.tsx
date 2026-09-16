import { useEffect, useState } from 'react'
import { Type, RotateCcw, Keyboard, MonitorSmartphone } from 'lucide-react'
import {
  CURSOR_STYLES,
  DEFAULT_FONT_FAMILY,
  DEFAULT_TERMINAL_PREFS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  SCROLLBACK_OPTIONS,
  clampFontSize,
  patchTerminalPrefs,
  readTerminalPrefs,
  subscribeTerminalPrefs,
  type CursorStyle,
  type TerminalPrefs,
} from '../../utils/terminal-prefs'

/**
 * 设置面板里的「终端」区。
 *
 * 之前终端的显示参数全是硬编码字面量（`fontSize: 13` 之类），用户唯一能调的是浏览器缩放
 * ——那会把整个界面一起缩掉。这里把字号/字体/行高/光标/滚动缓冲/交互偏好集中成一处，
 * 写进 `utils/terminal-prefs` 的单一来源；SSH 终端与容器终端都订阅同一份，改完立刻生效。
 */
export default function TerminalSettings() {
  const [prefs, setPrefs] = useState(readTerminalPrefs)

  // 别的入口改了（Ctrl± 、另一个标签页）→ 这里同步
  useEffect(() => {
    return subscribeTerminalPrefs(() => setPrefs(readTerminalPrefs()))
  }, [])

  const update = (patch: Partial<TerminalPrefs>) => {
    setPrefs(patchTerminalPrefs(patch))
  }

  return (
    <section>
      <h3 className="mb-4 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
        <Type size={14} />
        终端
      </h3>
      <div className="space-y-4 rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
        {/* 字号 */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-300">字号</div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              当前 {prefs.fontSize}px。终端里用 Ctrl/⌘ + <kbd className="font-mono">+</kbd> /{' '}
              <kbd className="font-mono">-</kbd> 可直接缩放，
              <kbd className="font-mono">0</kbd> 复位。
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => update({ fontSize: clampFontSize(prefs.fontSize - 1) })}
              disabled={prefs.fontSize <= FONT_SIZE_MIN}
              className="h-7 w-7 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-30"
              title="减小字号"
            >
              −
            </button>
            <span className="w-10 text-center font-mono text-sm text-slate-200">
              {prefs.fontSize}
            </span>
            <button
              type="button"
              onClick={() => update({ fontSize: clampFontSize(prefs.fontSize + 1) })}
              disabled={prefs.fontSize >= FONT_SIZE_MAX}
              className="h-7 w-7 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-30"
              title="增大字号"
            >
              ＋
            </button>
          </div>
        </div>

        {/* 字体 */}
        <div>
          <div className="text-sm text-slate-300">字体栈</div>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              value={prefs.fontFamily}
              onChange={(e) => update({ fontFamily: e.target.value })}
              spellCheck={false}
              className="focus:border-wrench-500/60 min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200 outline-none"
            />
            <button
              type="button"
              onClick={() => update({ fontFamily: DEFAULT_FONT_FAMILY })}
              className="shrink-0 rounded border border-slate-600 px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200"
            >
              重置
            </button>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            本机没装的字体会自动回退到后面的候选，留空则用默认栈。
          </div>
        </div>

        {/* 行高 */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-300">行高</div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              默认 1.0（最紧凑）。调大更好读，但同样高度能显示的行数会变少。
            </div>
          </div>
          <select
            value={String(prefs.lineHeight)}
            onChange={(e) => update({ lineHeight: Number(e.target.value) })}
            className="shrink-0 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 outline-none"
          >
            {[1, 1.1, 1.2, 1.35, 1.5, 1.8].map((v) => (
              <option key={v} value={String(v)}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {/* 光标 */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-300">光标</div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              形状与是否闪烁；录屏/远距离看屏时用方块 + 闪烁更显眼。
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select
              value={prefs.cursorStyle}
              onChange={(e) => update({ cursorStyle: e.target.value as CursorStyle })}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 outline-none"
            >
              {CURSOR_STYLES.map((s) => (
                <option key={s} value={s}>
                  {s === 'block' ? '方块' : s === 'underline' ? '下划线' : '竖线'}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={prefs.cursorBlink}
                onChange={(e) => update({ cursorBlink: e.target.checked })}
              />
              闪烁
            </label>
          </div>
        </div>

        {/* 滚动缓冲 */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-300">回滚缓冲行数</div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              能往回翻多少行历史输出；调大更占内存，长时间跑构建时更省心。
            </div>
          </div>
          <select
            value={String(prefs.scrollback)}
            onChange={(e) => update({ scrollback: Number(e.target.value) })}
            className="shrink-0 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 outline-none"
          >
            {SCROLLBACK_OPTIONS.map((v) => (
              <option key={v} value={String(v)}>
                {v.toLocaleString()} 行
              </option>
            ))}
          </select>
        </div>

        {/* 交互偏好 */}
        <div className="space-y-2 border-t border-slate-700/50 pt-3">
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={prefs.copyOnSelect}
              onChange={(e) => update({ copyOnSelect: e.target.checked })}
            />
            <span>
              选中即复制
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Linux/macOS 终端的老习惯。开启后每次选中都会覆盖系统剪贴板。
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={prefs.macOptionIsMeta}
              onChange={(e) => update({ macOptionIsMeta: e.target.checked })}
            />
            <span>
              macOS：Option 键作为 Meta
              <span className="mt-0.5 block text-[11px] text-slate-500">
                开启后 <kbd className="font-mono">Option+B</kbd> 这类组合键会按 Meta 传给远端（shell
                的 readline 快捷键）；关掉则当作普通字符输入。
              </span>
            </span>
          </label>
        </div>

        {/* 交互说明 + 复位 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-700/50 pt-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <Keyboard size={12} />
            右键/长按出菜单：复制、粘贴、全选、查找、清屏
          </span>
          <span className="flex items-center gap-1">
            <MonitorSmartphone size={12} />
            链接需 Ctrl/⌘ + 点击（触屏直接点）
          </span>
          <button
            type="button"
            onClick={() => update(DEFAULT_TERMINAL_PREFS)}
            className="ml-auto flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
          >
            <RotateCcw size={11} />
            恢复默认
          </button>
        </div>
      </div>
    </section>
  )
}
