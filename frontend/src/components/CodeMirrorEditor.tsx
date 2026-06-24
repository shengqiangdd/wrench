/**
 * CodeMirrorEditor.tsx
 *
 * 基于 CodeMirror 6 的代码编辑器组件。
 * 显示当前活跃标签页的文件内容，支持 8+ 种语言语法高亮。
 * 使用 IndexedDB 自动保存，Ctrl+S / 双击保存到远程。
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { xml } from '@codemirror/lang-xml'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { rust } from '@codemirror/lang-rust'
import { go } from '@codemirror/lang-go'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { searchKeymap } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { closeBrackets } from '@codemirror/autocomplete'
import { useFileStore } from '../stores/file-store'
import { getWsClient } from '../services/websocket'
import { Loader2, Save } from 'lucide-react'
import { pluginSandboxManager } from '../services/pluginSandboxManager'

export default function CodeMirrorEditor() {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const fileStore = useFileStore()
  const activeTab = fileStore.openTabs.find(t => t.id === fileStore.activeTabId)
  const wsClient = getWsClient()

  const saveFile = useCallback(async () => {
    if (!activeTab || !activeTab.content) return
    const tab = fileStore.openTabs.find(t => t.id === activeTab.id)
    if (!tab) return

    setSaving(true)
    setSaveMsg(null)

    // SFTP 文件保存到远程
    if (tab.source === 'sftp' && tab.sessionId) {
      try {
        const encoded = btoa(tab.content || '')
        await wsClient.request({
          type: 'sftp',
          connectionId: tab.sessionId,
          operation: 'writefile',
          path: tab.path,
          content: encoded,
        })
        fileStore.markTabClean(tab.id)
        setSaveMsg('已保存')
        setTimeout(() => setSaveMsg(null), 2000)
      } catch (err) {
        setSaveMsg('保存失败: ' + (err as Error).message)
        setTimeout(() => setSaveMsg(null), 3000)
      }
    }
    setSaving(false)
  }, [activeTab, fileStore, wsClient])

  // 构建 language extension
  const getLanguageExt = useCallback((lang: string) => {
    switch (lang) {
      case 'javascript': case 'typescript': case 'jsx': case 'tsx':
        return javascript({ typescript: lang === 'typescript' || lang === 'tsx', jsx: lang === 'jsx' || lang === 'tsx' })
      case 'python': return python()
      case 'json': return json()
      case 'markdown': return markdown()
      case 'html': return html()
      case 'css': case 'scss': case 'less': return css()
      case 'xml': case 'svg': return xml()
      case 'sql': return sql()
      case 'yaml': case 'yml': return yaml()
      case 'rust': return rust()
      case 'go': return go()
      default: return []
    }
  }, [])

  // 初始化编辑器
  useEffect(() => {
    if (!containerRef.current || !activeTab) return

    // 如果已存在 editor view，先销毁
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    const langExt = getLanguageExt(activeTab.language)

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const content = update.state.doc.toString()
        fileStore.updateFileContent(activeTab.id, content)
        // 同步到插件沙箱
        pluginSandboxManager.syncEditorContent(content, activeTab.language)
      }
    })

    const state = EditorState.create({
      doc: activeTab.content || '',
      extensions: [
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...searchKeymap,
          // Ctrl/Cmd + S 保存
          { key: 'Mod-s', run: () => { saveFile(); return true } },
        ]),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        foldGutter(),
        autocompletion(),
        syntaxHighlighting(defaultHighlightStyle),
        oneDark,
        langExt,
        placeholder('在此编辑文件...'),
        updateListener,
        EditorView.theme({
          '&': { backgroundColor: 'transparent', height: '100%' },
          '.cm-scroller': { fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: '13px' },
          '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid rgba(51,65,85,0.3)' },
          '&.cm-editor.cm-focused': { outline: 'none' },
          '.cm-activeLineGutter': { backgroundColor: 'rgba(56,189,248,0.1)' },
        }),
        EditorView.lineWrapping,
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [activeTab?.id]) // 只在标签切换时重建

  if (!activeTab) {
    return null
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 保存提示 */}
      {activeTab.source === 'sftp' && activeTab.isDirty && (
        <div className="flex items-center justify-between border-b border-slate-700/30 bg-slate-900/50 px-3 py-1">
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            未保存的更改
          </span>
          <div className="flex items-center gap-2">
            {saveMsg && (
              <span className={`text-[11px] ${saveMsg.includes('失败') ? 'text-red-400' : 'text-emerald-400'}`}>
                {saveMsg}
              </span>
            )}
            <button
              onClick={saveFile}
              disabled={saving}
              className="btn-primary flex items-center gap-1 px-2 py-1 text-[11px]"
            >
              {saving ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Save size={12} />
              )}
              保存 (Ctrl+S)
            </button>
          </div>
        </div>
      )}

      {/* 编辑器容器 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        style={{ minHeight: 0 }}
      />
    </div>
  )
}
