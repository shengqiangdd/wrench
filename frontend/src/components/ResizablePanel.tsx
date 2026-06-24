/**
 * ResizablePanel.tsx — 可拖拽调整宽度的面板容器
 *
 * 在相邻两个面板之间生成一条拖拽分隔线，用户按住可左右（或上下）拖动调整面板宽度。
 *
 * 用法：
 * <ResizablePanel
 *   side="left"          // left | right | top | bottom
 *   defaultSize={256}    // 默认像素宽度
 *   minSize={180}
 *   maxSize={500}
 *   onResize={(px) => {}} // 每次 resize 结束回调
 * >
 *   <div>...左侧内容...</div>
 * </ResizablePanel>
 */

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 面板在哪一侧（拖动器的方向由这个决定） */
  side: 'left' | 'right' | 'top' | 'bottom'
  /** 默认尺寸（像素） */
  defaultSize?: number
  /** 最小尺寸 */
  minSize?: number
  /** 最大尺寸 */
  maxSize?: number
  /** resize 结束时的回调 */
  onResize?: (size: number) => void
  /** 当前外部控制尺寸（可选，覆盖内部 state） */
  size?: number
  /** 自定义类名 */
  className?: string
  /** 拖拽器额外类名 */
  handleClassName?: string
}

export default function ResizablePanel({
  children,
  side,
  defaultSize = 256,
  minSize = 150,
  maxSize = 600,
  onResize,
  size: externalSize,
  className = '',
  handleClassName = '',
}: Props) {
  const [internalSize, setInternalSize] = useState(defaultSize)
  const isDragging = useRef(false)
  const startPos = useRef(0)
  const startSize = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const actualSize = externalSize ?? internalSize

  const isHorizontal = side === 'left' || side === 'right'
  const isBefore = side === 'left' || side === 'top'

  // ─── 鼠标事件 ───

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
      startPos.current = isHorizontal ? e.clientX : e.clientY
      startSize.current = actualSize
      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [actualSize, isHorizontal],
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = (isHorizontal ? e.clientX : e.clientY) - startPos.current
      // 面板在分隔线之前（left/top），delta 直接加；之后（right/bottom）要反向
      const newSize = isBefore
        ? startSize.current + delta
        : startSize.current - delta
      setInternalSize(Math.max(minSize, Math.min(maxSize, newSize)))
    },
    [isHorizontal, isBefore, minSize, maxSize],
  )

  const handleMouseUp = useCallback(() => {
    if (!isDragging.current) return
    isDragging.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    onResize?.(internalSize)
  }, [internalSize, onResize])

  // 全局 mousemove / mouseup
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  // ─── 触摸事件（移动端） ───

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      isDragging.current = true
      startPos.current = isHorizontal ? e.touches[0].clientX : e.touches[0].clientY
      startSize.current = actualSize
    },
    [actualSize, isHorizontal],
  )

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isDragging.current) return
      const delta = (isHorizontal ? e.touches[0].clientX : e.touches[0].clientY) - startPos.current
      const newSize = isBefore
        ? startSize.current + delta
        : startSize.current - delta
      setInternalSize(Math.max(minSize, Math.min(maxSize, newSize)))
    },
    [isHorizontal, isBefore, minSize, maxSize],
  )

  const handleTouchEnd = useCallback(() => {
    isDragging.current = false
    onResize?.(internalSize)
  }, [internalSize, onResize])

  useEffect(() => {
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd)
    return () => {
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleTouchMove, handleTouchEnd])

  return (
    <div
      ref={containerRef}
      className={`relative flex shrink-0 ${className}`}
      style={{
        [isHorizontal ? 'width' : 'height']: actualSize,
        minWidth: isHorizontal ? minSize : undefined,
        minHeight: isHorizontal ? undefined : minSize,
      }}
    >
      {children}

      {/* 拖拽分隔线 */}
      <div
        className={`absolute ${
          isHorizontal ? 'top-0 w-1 cursor-col-resize' : 'left-0 h-1 cursor-row-resize'
        } z-20 transition-colors hover:bg-smartbox-500/30 active:bg-smartbox-500/50 ${handleClassName}`}
        style={{
          [isHorizontal ? (isBefore ? 'right' : 'left') : isBefore ? 'bottom' : 'top']: -4,
          [isHorizontal ? 'height' : 'width']: '100%',
        }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {/* 视觉指示点 */}
        <div
          className={`absolute ${
            isHorizontal
              ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-0.5 rounded-full'
              : 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-0.5 rounded-full'
          } bg-slate-600/50 group-hover:bg-smartbox-400/50 transition-colors`}
        />
      </div>

      {/* 拖拽时的覆盖层 */}
      {isDragging.current && (
        <div
          className="fixed inset-0 z-50"
          style={{ cursor: isHorizontal ? 'col-resize' : 'row-resize' }}
        />
      )}
    </div>
  )
}
