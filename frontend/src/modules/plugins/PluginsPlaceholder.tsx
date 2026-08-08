import { Puzzle } from 'lucide-react'

export default function PluginsPlaceholder() {
  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-200">插件</h2>
      </div>

      <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-700/50">
        <div className="text-center">
          <Puzzle size={48} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm text-slate-500">插件系统加载中</p>
          <p className="mt-1 text-xs text-slate-600">将插件放入 plugins/ 目录后自动识别</p>
        </div>
      </div>
    </div>
  )
}
