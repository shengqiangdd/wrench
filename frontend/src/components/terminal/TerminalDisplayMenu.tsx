import { useEffect, useRef, useState } from 'react'
import { Minus, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../utils/terminal-prefs'

interface Props {
  /** 进度块原地刷新（原「画布」芯片）：窄视口下逻辑屏与可视窗口解耦 */
  canvasOn: boolean
  onToggleCanvas: () => void
  /** 日志逐行输出（原「plain」芯片）：会话内注入安静进度变量组 */
  plainOn: boolean
  onTogglePlain: () => void
  fontSize: number
  /** delta 为像素步进，或 'reset' 回默认值 */
  onFontSizeChange: (delta: number | 'reset') => void
  /** 默认字号（复位按钮的提示里显示） */
  defaultFontSize: number
}

/**
 * 终端右上角的**「显示」菜单** —— 把原先两个内部机制名的芯片
 * （`plain` / `画布`，见 TERM_UX_TODO batch 2）换成普通用户看得懂的入口。
 *
 * 设计约束：
 * - **零行为变更**：三组开关仍然操作原来的 `canvasOn` / `composePlain` / `prefs.fontSize`，
 *   这里只负责措辞与入口聚合，不改任何几何/注入逻辑。
 * - 芯片与面板内条目一律用 `pointerdown`：外层终端容器的 `touchAction` 为 none，
 *   移动端合成 click 会被吞（与本文件此前的芯片实现一致）。
 * - 面板内条目 `stopPropagation`，否则触摸会冒泡到容器、把软键盘叫起来。
 */
export function TerminalDisplayMenu({
  canvasOn,
  onToggleCanvas,
  plainOn,
  onTogglePlain,
  fontSize,
  onFontSizeChange,
  defaultFontSize,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  /** 任一项偏离默认（贴屏或逐行日志）= 芯片点亮，收起时也能看出状态 */
  const nonDefault = !canvasOn || plainOn
  const canShrink = fontSize > FONT_SIZE_MIN
  const canGrow = fontSize < FONT_SIZE_MAX

  const toggleRow = (
    label: string,
    desc: string,
    on: boolean,
    onToggle: () => void,
    testid: string,
  ) => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      data-testid={testid}
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle()
      }}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-slate-700/60 active:bg-slate-700/80"
    >
      <span
        aria-hidden
        className={`relative mt-0.5 h-4 w-7 shrink-0 rounded-full transition-colors ${
          on ? 'bg-emerald-600' : 'bg-slate-600'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
            on ? 'left-[0.875rem]' : 'left-0.5'
          }`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-tight text-slate-100">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{desc}</span>
      </span>
    </button>
  )

  return (
    <div ref={rootRef} className="pointer-events-none relative flex flex-col items-end">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="terminal-display-chip"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className={`pointer-events-auto flex items-center gap-1 rounded px-2 py-1 text-[11px] shadow-lg backdrop-blur-sm transition-all duration-150 ${
          nonDefault
            ? 'bg-sky-600/90 text-white hover:bg-sky-500'
            : 'bg-slate-800/90 text-slate-400 hover:bg-slate-700 hover:text-white'
        }`}
        style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
        title="终端显示：进度怎么画、字号多大"
      >
        <SlidersHorizontal size={12} />
        <span>显示</span>
      </button>

      {open && (
        <>
          {/* 透明遮罩：点别处收起 */}
          <div
            className="pointer-events-auto fixed inset-0 z-40"
            onPointerDown={(e) => {
              e.preventDefault()
              setOpen(false)
            }}
          />
          <div
            role="menu"
            data-testid="terminal-display-panel"
            onPointerDown={(e) => e.stopPropagation()}
            className="pointer-events-auto absolute top-full right-0 z-50 mt-1 w-[min(19rem,calc(100vw-1.5rem))] rounded-xl border border-slate-600/50 bg-slate-800/95 p-1.5 shadow-2xl backdrop-blur-md"
            style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
          >
            <div className="px-2.5 pt-1 pb-1.5 text-[11px] text-slate-400">终端显示</div>

            {toggleRow(
              '进度原地刷新',
              '窄窗口下 docker / compose 的进度条原地重绘，不会刷屏堆重复行（推荐开启）',
              canvasOn,
              onToggleCanvas,
              'display-toggle-canvas',
            )}
            {toggleRow(
              '日志逐行输出',
              '把动画进度换成一行一条的日志，方便复制和回看（只影响当前会话）',
              plainOn,
              onTogglePlain,
              'display-toggle-plain',
            )}

            <div className="my-1 border-t border-slate-700/60" />

            <div className="px-2.5 py-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-slate-100">字号</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    data-testid="display-font-smaller"
                    disabled={!canShrink}
                    title={`缩小字号（下限 ${FONT_SIZE_MIN}px）`}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (canShrink) onFontSizeChange(-1)
                    }}
                    className={`flex h-6 w-6 items-center justify-center rounded ${
                      canShrink
                        ? 'bg-slate-700/80 text-slate-200 hover:bg-slate-600'
                        : 'cursor-not-allowed text-slate-600'
                    }`}
                  >
                    <Minus size={12} />
                  </button>
                  <span
                    data-testid="display-font-size"
                    className="w-10 text-center font-mono text-[11px] text-slate-300"
                  >
                    {fontSize}px
                  </span>
                  <button
                    type="button"
                    data-testid="display-font-larger"
                    disabled={!canGrow}
                    title={`放大字号（上限 ${FONT_SIZE_MAX}px）`}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (canGrow) onFontSizeChange(1)
                    }}
                    className={`flex h-6 w-6 items-center justify-center rounded ${
                      canGrow
                        ? 'bg-slate-700/80 text-slate-200 hover:bg-slate-600'
                        : 'cursor-not-allowed text-slate-600'
                    }`}
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    type="button"
                    data-testid="display-font-reset"
                    title={`复位到 ${defaultFontSize}px`}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onFontSizeChange('reset')
                    }}
                    className="flex h-6 items-center gap-1 rounded bg-slate-700/80 px-1.5 text-[11px] text-slate-200 hover:bg-slate-600"
                  >
                    <RotateCcw size={11} />
                    <span>复位</span>
                  </button>
                </div>
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-slate-400">
                快捷键也可以：Ctrl / ⌘ + <span className="font-mono">−</span> 或{' '}
                <span className="font-mono">＋</span> 缩放，
                <span className="font-mono">Ctrl / ⌘ + 0</span> 复位
              </div>
            </div>

            <div className="px-2.5 pt-1 pb-1.5 text-[10px] leading-snug text-slate-500">
              这两项只改「怎么显示」，不改远端环境；更多终端偏好（字体栈、行高、光标、回滚缓冲）
              在「设置 → 终端」。
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default TerminalDisplayMenu
