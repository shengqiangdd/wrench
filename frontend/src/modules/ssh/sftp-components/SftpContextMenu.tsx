/**
 * SftpContextMenu — right-click context menu for SFTP file browser
 */
import { memo } from 'react'
import {
  Folder,
  Eye,
  Edit3,
  Download,
  Trash2,
  Copy,
  FilePlus,
  FolderPlus,
  Save,
  RefreshCw,
  HardDrive,
  Binary,
  RotateCcw,
} from 'lucide-react'
import type { SftpEntry } from '../../../types/ssh'
import { isDirLike, isBinaryFile } from '../sftp-utils'

export interface SftpContextMenuProps {
  contextMenu: { x: number; y: number; entry: SftpEntry | null } | null
  // Entry action callbacks
  onOpen: (entry: SftpEntry) => void
  onPreview: (entry: SftpEntry) => void
  onOpenInEditor: (entry: SftpEntry) => void
  onDownload: (entry: SftpEntry) => void
  onRename: (entry: SftpEntry) => void
  onDelete: (entry: SftpEntry) => void
  onChmod: (entry: SftpEntry) => void
  onMove: (entry: SftpEntry) => void
  onCopyPath: (entry: SftpEntry) => void
  onCopyName: (entry: SftpEntry) => void
  onFileInfo: (entry: SftpEntry) => void
  onCopyFile: (entries: SftpEntry[]) => void
  onCutFile: (entries: SftpEntry[]) => void
  onDiskUsage: (entry: SftpEntry) => void
  onFileHash: (entry: SftpEntry) => void
  // Empty area callbacks
  onCreateFile: () => void
  onCreateDir: () => void
  onPaste: () => void
  onRefresh: () => void
  onClose: () => void
  // Clipboard state
  clipboard: { paths: string[]; mode: 'copy' | 'cut' } | null
  clipboardCount: number
  // 回收站模式
  isTrash?: boolean
  onRestore?: (entry: SftpEntry) => void
}

const SftpContextMenu = memo(function SftpContextMenu({
  contextMenu,
  onOpen,
  onPreview,
  onOpenInEditor,
  onDownload,
  onRename,
  onDelete,
  onChmod,
  onMove,
  onCopyPath,
  onCopyName,
  onFileInfo,
  onCopyFile,
  onCutFile,
  onDiskUsage,
  onFileHash,
  onCreateFile,
  onCreateDir,
  onPaste,
  onRefresh,
  onClose,
  clipboard,
  clipboardCount,
  isTrash,
  onRestore,
}: SftpContextMenuProps) {
  if (!contextMenu) return null

  const menuItem =
    'flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700'

  return (
    <div
      className="fixed z-50 max-h-[70vh] min-w-[160px] overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl"
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      {contextMenu.entry ? (
        <>
          {/* 回收站模式：仅显示恢复+删除+关闭 */}
          {isTrash ? (
            <>
              <button
                onClick={() => {
                  onRestore?.(contextMenu.entry!)
                  onClose()
                }}
                className={`${menuItem} text-emerald-400`}
              >
                <RotateCcw size={12} /> 恢复到 /tmp/
              </button>
              <div className="mx-2 my-1 border-t border-slate-700/50" />
              <button
                onClick={() => {
                  onDelete(contextMenu.entry!)
                }}
                className={`${menuItem} text-red-400`}
              >
                <Trash2 size={12} /> 永久删除
              </button>
              <button
                onClick={() => {
                  onCopyPath(contextMenu.entry!)
                  onClose()
                }}
                className={menuItem}
              >
                <Copy size={12} /> 复制路径
              </button>
              <button
                onClick={() => {
                  onFileInfo(contextMenu.entry!)
                  onClose()
                }}
                className={menuItem}
              >
                <Eye size={12} /> 文件信息
              </button>
            </>
          ) : (
            <>
              {isDirLike(contextMenu.entry) ? (
                <button
                  onClick={() => {
                    onOpen(contextMenu.entry!)
                    onClose()
                  }}
                  className={menuItem}
                >
                  <Folder size={12} /> 打开
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      onPreview(contextMenu.entry!)
                      onClose()
                    }}
                    className={menuItem}
                  >
                    <Eye size={12} /> 预览
                  </button>
                  {!isBinaryFile(contextMenu.entry.name) && (
                    <button
                      onClick={async () => {
                        const entry = contextMenu.entry!
                        onClose()
                        await onOpenInEditor(entry)
                      }}
                      className={menuItem}
                    >
                      <Edit3 size={12} /> 在编辑器中打开
                    </button>
                  )}
                  <button
                    onClick={() => {
                      onDownload(contextMenu.entry!)
                    }}
                    className={menuItem}
                  >
                    <Download size={12} /> 下载
                  </button>
                </>
              )}
              <div className="mx-2 my-1 border-t border-slate-700/50" />
              <button
                onClick={() => {
                  onRename(contextMenu.entry!)
                  onClose()
                }}
                className={menuItem}
              >
                <Edit3 size={12} /> 重命名
              </button>
              <button
                onClick={() => {
                  onDelete(contextMenu.entry!)
                }}
                className={`${menuItem} text-red-400`}
              >
                <Trash2 size={12} /> 删除
              </button>
              <button
                onClick={() => {
                  onChmod(contextMenu.entry!)
                  onClose()
                }}
                className={menuItem}
              >
                <Edit3 size={12} /> 权限
              </button>
              <button
                onClick={() => {
                  onMove(contextMenu.entry!)
                  onClose()
                }}
                className={menuItem}
              >
                <Edit3 size={12} /> 移动到…
              </button>
              <div className="mx-2 my-1 border-t border-slate-700/50" />
              <button
                onClick={() => {
                  onCopyPath(contextMenu.entry!)
                  onClose()
                }}
                className={menuItem}
              >
                <Copy size={12} /> 复制路径
              </button>
              <button
                onClick={() => {
                  onCopyName(contextMenu.entry!)
                  onClose()
                }}
                className={menuItem}
              >
                <Copy size={12} /> 复制文件名
              </button>
              <button
                onClick={() => {
                  onFileInfo(contextMenu.entry!)
                  onClose()
                }}
                className={menuItem}
              >
                <Eye size={12} /> 文件信息
              </button>
              <div className="mx-2 my-1 border-t border-slate-700/50" />
              <button
                onClick={() => {
                  onCopyFile([contextMenu.entry!])
                  onClose()
                }}
                className={menuItem}
              >
                <Copy size={12} /> 复制文件
              </button>
              <button
                onClick={() => {
                  onCutFile([contextMenu.entry!])
                  onClose()
                }}
                className={menuItem}
              >
                <Edit3 size={12} /> 剪切文件
              </button>
              <div className="mx-2 my-1 border-t border-slate-700/50" />
              <button
                onClick={() => {
                  onDiskUsage(contextMenu.entry!)
                  onClose()
                }}
                className={menuItem}
              >
                <HardDrive size={12} /> 磁盘使用
              </button>
              {!isDirLike(contextMenu.entry!) && (
                <button
                  onClick={() => {
                    onFileHash(contextMenu.entry!)
                    onClose()
                  }}
                  className={menuItem}
                >
                  <Binary size={12} /> 文件哈希
                </button>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <button
            onClick={() => {
              onCreateFile()
              onClose()
            }}
            className={menuItem}
          >
            <FilePlus size={12} /> 新建文件
          </button>
          <button
            onClick={() => {
              onCreateDir()
              onClose()
            }}
            className={menuItem}
          >
            <FolderPlus size={12} /> 新建文件夹
          </button>
          <div className="mx-2 my-1 border-t border-slate-700/50" />
          {clipboard && (
            <button
              onClick={() => {
                onPaste()
                onClose()
              }}
              className={`${menuItem} text-amber-400`}
            >
              <Save size={12} /> 粘贴 {clipboardCount} 项
            </button>
          )}
          <button
            onClick={() => {
              onRefresh()
              onClose()
            }}
            className={menuItem}
          >
            <RefreshCw size={12} /> 刷新
          </button>
        </>
      )}
    </div>
  )
})

export default SftpContextMenu
