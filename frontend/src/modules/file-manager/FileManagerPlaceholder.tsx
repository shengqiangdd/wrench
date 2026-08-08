import { FileCode2 } from 'lucide-react'

export default function FileManagerPlaceholder() {
  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-200">文件管理</h2>
      </div>

      <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-700/50">
        <div className="text-center">
          <FileCode2 size={48} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm text-slate-500">通过 SSH 连接或本地文件系统访问文件</p>
          <p className="mt-1 text-xs text-slate-600">先连接 SSH 或打开本地文件夹</p>
        </div>
      </div>
    </div>
  )
}
