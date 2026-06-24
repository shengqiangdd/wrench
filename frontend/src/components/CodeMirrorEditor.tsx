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
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { php } from '@codemirror/lang-php'
import { less } from '@codemirror/lang-less'
import { vue } from '@codemirror/lang-vue'
import { liquid } from '@codemirror/lang-liquid'
import { wast } from '@codemirror/lang-wast'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { searchKeymap } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { closeBrackets } from '@codemirror/autocomplete'
import { useFileStore } from '../stores/file-store'
import { useAiStore } from '../stores/ai-store'
import { getWsClient } from '../services/websocket'
import { Loader2, Save, Sparkles, X, Check, Copy } from 'lucide-react'
import { pluginSandboxManager } from '../services/pluginSandboxManager'
import { aiCodeAction, computeDiffLines, ACTION_LABELS, ACTION_ICONS } from '../services/ai-operations'
import type { AiCodeAction, AiCodeActionResult } from '../services/ai-operations'

export default function CodeMirrorEditor() {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const fileStore = useFileStore()
  const aiConfig = useAiStore((s) => s.config)
  const activeTab = fileStore.openTabs.find(t => t.id === fileStore.activeTabId)
  const wsClient = getWsClient()
  const [aiMenuOpen, setAiMenuOpen] = useState(false)
  const [aiMenuPos, setAiMenuPos] = useState({ x: 0, y: 0 })
  const [aiProcessing, setAiProcessing] = useState<AiCodeAction | null>(null)
  const [aiResult, setAiResult] = useState<AiCodeActionResult | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiModalOpen, setAiModalOpen] = useState(false)

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

  // ─── AI 代码操作 ───

  /** 获取编辑器选中文本 */
  const getSelectedText = useCallback((): string => {
    const view = viewRef.current
    if (!view) return ''
    const sel = view.state.selection.main
    if (sel.empty) return ''
    return view.state.sliceDoc(sel.from, sel.to - sel.from)
  }, [])

  /** 替换选中文本 */
  const replaceSelectedText = useCallback((newText: string) => {
    const view = viewRef.current
    if (!view) return
    const sel = view.state.selection.main
    if (sel.empty) return
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: newText },
    })
  }, [])

  /** 打开 AI 操作菜单 */
  const openAiMenu = useCallback(() => {
    const selected = getSelectedText()
    if (!selected.trim()) return
    // 在按钮附近弹出菜单
    setAiMenuOpen(true)
  }, [getSelectedText])

  /** 执行 AI 操作 */
  const handleAiAction = useCallback(async (action: AiCodeAction) => {
    if (!aiConfig.enabled || !aiConfig.apiKey) return
    const view = viewRef.current
    if (!view) return
    const selected = getSelectedText()
    if (!selected.trim()) return

    setAiMenuOpen(false)
    setAiProcessing(action)
    setAiError(null)
    setAiResult(null)
    setAiModalOpen(true)

    try {
      const result = await aiCodeAction(
        action,
        selected,
        activeTab?.language || 'text',
        aiConfig.apiKey,
        aiConfig.model,
        aiConfig.baseUrl,
      )
      setAiResult(result)
    } catch (err: any) {
      setAiError(err.message || 'AI 操作失败')
    } finally {
      setAiProcessing(null)
    }
  }, [aiConfig, getSelectedText, activeTab?.language])

  /** 应用 AI 结果 */
  const applyAiResult = useCallback(() => {
    if (!aiResult) return
    replaceSelectedText(aiResult.modified)
    setAiModalOpen(false)
    setAiResult(null)
  }, [aiResult, replaceSelectedText])

  /** 复制 AI 结果 */
  const copyAiResult = useCallback(() => {
    if (!aiResult) return
    navigator.clipboard.writeText(aiResult.modified)
  }, [aiResult])

  // 构建 language extension
  const getLanguageExt = useCallback((lang: string) => {
    switch (lang) {
      case 'javascript': case 'typescript': case 'jsx': case 'tsx':
        return javascript({ typescript: lang === 'typescript' || lang === 'tsx', jsx: lang === 'jsx' || lang === 'tsx' })
      case 'python': return python()
      case 'json': case 'jsonc': case 'json5': return json()
      case 'markdown': case 'mdx': return markdown()
      case 'html': case 'xhtml': return html()
      case 'css': case 'scss': return css()
      case 'less': return less()
      case 'vue': return vue()
      case 'xml': case 'svg': case 'xsd': case 'xsl': return xml()
      case 'sql': case 'pgsql': case 'mysql': case 'sqlite': return sql()
      case 'yaml': case 'yml': return yaml()
      case 'rust': return rust()
      case 'go': return go()
      case 'java': return java()
      case 'c': case 'cpp': case 'cxx': case 'cc': case 'hpp': case 'hxx': return cpp()
      case 'php': return php()
      case 'liquid': return liquid()
      case 'wast': case 'wat': return wast()
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

      {/* 编辑器工具栏 */}
      <div className="flex items-center justify-between border-b border-slate-700/30 px-2 py-1">
        <span className="text-[10px] text-slate-600">
          {activeTab.language}
        </span>
        <div className="flex items-center gap-1">
          {/* AI 操作按钮 */}
          {aiConfig.enabled && aiConfig.apiKey && (
            <div className="relative">
              <button
                onClick={openAiMenu}
                disabled={!getSelectedText()?.trim()}
                className="btn-icon text-smartbox-400 hover:text-smartbox-300 disabled:opacity-30"
                title="AI 代码操作"
              >
                <Sparkles size={14} />
              </button>

              {/* AI 操作菜单 */}
              {aiMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setAiMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl">
                    {(Object.keys(ACTION_LABELS) as AiCodeAction[]).map((action) => (
                      <button
                        key={action}
                        onClick={() => handleAiAction(action)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                      >
                        <span>{ACTION_ICONS[action]}</span>
                        {ACTION_LABELS[action]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 编辑器容器 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        style={{ minHeight: 0 }}
      />

      {/* AI 结果模态框 */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="mx-4 max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            {/* 头部 */}
            <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
                {aiProcessing ? (
                  <>
                    <Loader2 size={16} className="animate-spin text-smartbox-400" />
                    AI 处理中...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} className="text-smartbox-400" />
                    {aiResult && ACTION_LABELS[aiProcessing!]}
                  </>
                )}
              </span>
              <button
                onClick={() => { setAiModalOpen(false); setAiResult(null); setAiError(null) }}
                className="btn-icon text-slate-500 hover:text-slate-300"
              >
                <X size={16} />
              </button>
            </div>

            {/* 内容 */}
            <div className="p-4">
              {/* 加载中 */}
              {aiProcessing && !aiResult && !aiError && (
                <div className="flex flex-col items-center py-8">
                  <Loader2 size={32} className="animate-spin text-smartbox-400" />
                  <p className="mt-3 text-sm text-slate-500">正在调用 AI API...</p>
                </div>
              )}

              {/* 错误 */}
              {aiError && (
                <div className="rounded-lg bg-red-500/10 p-4 text-sm text-red-400">
                  {aiError}
                </div>
              )}

              {/* AI 结果 */}
              {aiResult && (
                <div className="space-y-4">
                  {/* 说明 */}
                  {aiResult.explanation && (
                    <div>
                      <h4 className="mb-1 text-xs font-medium text-slate-500">说明</h4>
                      <div className="whitespace-pre-wrap rounded-lg bg-slate-800/50 p-3 text-xs text-slate-300">
                        {aiResult.explanation}
                      </div>
                    </div>
                  )}

                  {/* 差异统计 */}
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-slate-600">
                      代码行数: {aiResult.original.split('\n').length} → {aiResult.modified.split('\n').length}
                    </span>
                  </div>

                  {/* 代码对比预览 */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <h4 className="mb-1 text-xs font-medium text-slate-600">原始代码</h4>
                      <pre className="max-h-60 overflow-auto rounded-lg bg-slate-800/30 p-3 text-xs text-slate-400 font-mono leading-relaxed">
                        <code>{aiResult.original}</code>
                      </pre>
                    </div>
                    <div>
                      <h4 className="mb-1 text-xs font-medium text-emerald-400">修改后</h4>
                      <pre className="max-h-60 overflow-auto rounded-lg bg-slate-800/50 p-3 text-xs text-slate-200 font-mono leading-relaxed">
                        <code>{aiResult.modified}</code>
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            {aiResult && (
              <div className="flex items-center justify-end gap-2 border-t border-slate-700/50 px-4 py-3">
                <button
                  onClick={copyAiResult}
                  className="btn-secondary flex items-center gap-1 px-3 py-1.5 text-xs"
                >
                  <Copy size={12} />
                  复制结果
                </button>
                <button
                  onClick={applyAiResult}
                  className="btn-primary flex items-center gap-1 px-3 py-1.5 text-xs"
                >
                  <Check size={12} />
                  应用
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
