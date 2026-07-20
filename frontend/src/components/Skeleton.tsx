/**
 * Skeleton — 通用骨架屏加载组件
 *
 * 用法：
 *   <Skeleton lines={3} />            // 3 行文本骨架
 *   <Skeleton type="card" />          // 卡片骨架
 *   <Skeleton type="list" rows={5} /> // 5 行列表骨架
 *   <Skeleton type="table" rows={4} />// 表格骨架
 *   <Skeleton type="stats" />         // 统计面板骨架
 */
import { memo } from 'react'

interface SkeletonProps {
  /** 骨架类型 */
  type?: 'text' | 'card' | 'list' | 'table' | 'stats'
  /** 行数/卡片数（text/list/table 有效） */
  rows?: number
  /** 宽度类名 */
  className?: string
}

function PulseBar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-700/50 ${className}`} />
}

function TextSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <PulseBar
          key={i}
          className={`h-3 ${i === rows - 1 ? 'w-2/3' : i === 0 ? 'w-4/5' : 'w-full'}`}
        />
      ))}
    </div>
  )
}

function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-lg border border-slate-700/30 bg-slate-800/50 p-4">
          <PulseBar className="mb-3 h-4 w-1/3" />
          <PulseBar className="mb-2 h-3 w-full" />
          <PulseBar className="mb-2 h-3 w-4/5" />
          <PulseBar className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-700/30">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <PulseBar className="h-4 w-4 shrink-0 rounded" />
          <PulseBar className="h-3 flex-1" />
          <PulseBar className="h-3 w-16 shrink-0" />
        </div>
      ))}
    </div>
  )
}

function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-hidden">
      {/* header */}
      <div className="flex gap-4 border-b border-slate-700/30 px-4 py-2">
        <PulseBar className="h-3 w-1/4" />
        <PulseBar className="h-3 w-1/4" />
        <PulseBar className="h-3 w-1/4" />
        <PulseBar className="h-3 w-1/4" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 border-b border-slate-700/20 px-4 py-3">
          <PulseBar className="h-3 w-1/4" />
          <PulseBar className="h-3 w-1/4" />
          <PulseBar className="h-3 w-1/4" />
          <PulseBar className="h-3 w-1/4" />
        </div>
      ))}
    </div>
  )
}

function StatsSkeleton() {
  return (
    <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-slate-700/30 bg-slate-800/50 p-4">
          <PulseBar className="mb-2 h-3 w-1/2" />
          <PulseBar className="mb-1 h-6 w-1/3" />
          <PulseBar className="h-2 w-full" />
        </div>
      ))}
    </div>
  )
}

const Skeleton = memo(function Skeleton({ type = 'text', rows = 3, className }: SkeletonProps) {
  return (
    <div className={`animate-pulse ${className ?? ''}`}>
      {type === 'text' && <TextSkeleton rows={rows} />}
      {type === 'card' && <CardSkeleton rows={rows} />}
      {type === 'list' && <ListSkeleton rows={rows} />}
      {type === 'table' && <TableSkeleton rows={rows} />}
      {type === 'stats' && <StatsSkeleton />}
    </div>
  )
})

export default Skeleton
