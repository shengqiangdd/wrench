import { useCallback, useEffect, useRef, useState } from 'react'

interface VirtualListProps<T> {
  items: T[]
  itemHeight: number
  renderItem: (item: T, index: number) => React.ReactNode
  /** 列表容器额外 className */
  className?: string
  /** 超过此数量才启用虚拟化（默认 100） */
  virtualizeThreshold?: number
  /** 底部额外空白（px），用于状态栏对齐 */
  paddingBottom?: number
  /** key 提取函数 */
  getKey?: (item: T) => string | number
}

export default function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  className = '',
  virtualizeThreshold = 100,
  paddingBottom = 0,
  getKey,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)

  // 如果数据量小，直接用原生列表
  const useVirtual = items.length > virtualizeThreshold

  // 监听滚动和容器尺寸变化
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)

    const handleScroll = () => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', handleScroll, { passive: true })

    // 初始尺寸
    setContainerHeight(el.clientHeight)
    setScrollTop(el.scrollTop)

    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', handleScroll)
    }
  }, [])

  // 计算可见范围
  let visibleItems: { item: T; index: number }[] = []
  const totalHeight = items.length * itemHeight + paddingBottom
  let paddingTop = 0

  if (useVirtual) {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight))
    const endIndex = Math.min(items.length, Math.ceil((scrollTop + containerHeight) / itemHeight))

    // 前后各多渲染 5 行作为缓冲
    const buffer = 5
    const renderStart = Math.max(0, startIndex - buffer)
    const renderEnd = Math.min(items.length, endIndex + buffer)

    paddingTop = renderStart * itemHeight
    visibleItems = items.slice(renderStart, renderEnd).map((item, i) => ({
      item,
      index: renderStart + i,
    }))
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const el = e.currentTarget
    // Home / End 键支持
    if (e.key === 'Home') {
      e.preventDefault()
      el.scrollTop = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      el.scrollTop = el.scrollHeight
    }
  }, [])

  if (!useVirtual) {
    return (
      <div
        ref={containerRef}
        className={`overflow-y-auto ${className}`}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        style={{ minHeight: 0 }}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {items.map((item, i) => (
            <div
              key={getKey?.(item) ?? i}
              style={{
                position: 'absolute',
                top: i * itemHeight,
                left: 0,
                right: 0,
                height: itemHeight,
              }}
            >
              {renderItem(item, i)}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-y-auto ${className}`}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${paddingTop}px)` }}>
          {visibleItems.map(({ item, index }) => (
            <div key={getKey?.(item) ?? index} style={{ height: itemHeight }}>
              {renderItem(item, index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
