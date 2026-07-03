/**
 * CodeMirrorEditor.tsx
 *
 * 基于 CodeMirror 6 的代码编辑器组件。
 * 语言包按需动态加载，仅加载当前文件需要的语言扩展。
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  indentOnInput,
  bracketMatching,
  foldGutter,
} from '@codemirror/language'
import { autocompletion, completionKeymap, closeBrackets } from '@codemirror/autocomplete'
import { searchKeymap } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { Eye, EyeOff, Loader2, Save, Download, Sparkles, X, Check, Copy } from 'lucide-react'
import MarkdownPreview from './MarkdownPreview'
import { useFileStore } from '../stores/file-store'
import { useAiStore } from '../stores/ai-store'
import { getWsClientSync } from '../services/websocket'
import { pluginSandboxManager } from '../services/pluginSandboxManager'
import { aiCodeAction, ACTION_LABELS, ACTION_ICONS } from '../services/ai-operations'
import type { AiCodeAction, AiCodeActionResult } from '../services/ai-operations'

// ── 语言包动态加载器 ──
// 使用懒加载映射，避免在首屏加载所有 CodeMirror 语言包
const languageLoaders: Record<string, () => Promise<any>> = {
  javascript: () => import('@codemirror/lang-javascript'),
  typescript: () => import('@codemirror/lang-javascript'),
  jsx: () => import('@codemirror/lang-javascript'),
  tsx: () => import('@codemirror/lang-javascript'),
  python: () => import('@codemirror/lang-python'),
  json: () => import('@codemirror/lang-json'),
  jsonc: () => import('@codemirror/lang-json'),
  markdown: () => import('@codemirror/lang-markdown'),
  mdx: () => import('@codemirror/lang-markdown'),
  html: () => import('@codemirror/lang-html'),
  css: () => import('@codemirror/lang-css'),
  scss: () => import('@codemirror/lang-css'),
  less: () => import('@codemirror/lang-less'),
  vue: () => import('@codemirror/lang-vue'),
  xml: () => import('@codemirror/lang-xml'),
  sql: () => import('@codemirror/lang-sql'),
  yaml: () => import('@codemirror/lang-yaml'),
  yml: () => import('@codemirror/lang-yaml'),
  rust: () => import('@codemirror/lang-rust'),
  go: () => import('@codemirror/lang-go'),
  java: () => import('@codemirror/lang-java'),
  c: () => import('@codemirror/lang-cpp'),
  cpp: () => import('@codemirror/lang-cpp'),
  php: () => import('@codemirror/lang-php'),
  liquid: () => import('@codemirror/lang-liquid'),
  wast: () => import('@codemirror/lang-wast'),
}

/** 动态加载语言扩展 */
async function loadLanguageExtension(lang: string) {
  const loader = languageLoaders[lang] || languageLoaders['javascript']!
  const mod = await loader()
  // 每个语言包导出对应的语言函数，名称与包名相关
  // javascript -> javascript(), python -> python(), json -> json(), 等
  if (lang === 'typescript' || lang === 'tsx' || lang === 'jsx') {
    return mod.javascript({
      typescript: lang === 'typescript' || lang === 'tsx',
      jsx: lang === 'jsx' || lang === 'tsx',
    })
  }
  if (lang === 'scss' || lang === 'less') {
    // CSS 扩展：less() 或 css()
    const cssMod = await import('@codemirror/lang-css')
    return cssMod.css()
  }
  if (lang === 'c' || lang === 'cpp') {
    return mod.cpp()
  }
  if (lang === 'jsonc' || lang === 'json5') {
    return mod.json()
  }
  if (lang === 'mdx') {
    return mod.markdown()
  }
  if (lang === 'yml') {
    return mod.yaml()
  }
  // 默认调用包中同名的导出函数
  const exportName = lang === 'c' || lang === 'cpp' ? 'cpp' : lang
  if (typeof mod[exportName] === 'function') {
    return mod[exportName]()
  }
  if (typeof mod.default === 'function') {
    return mod.default()
  }
  return []
}

export default function CodeMirrorEditor() {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [langLoading, setLangLoading] = useState(false)
  const fileStore = useFileStore()
  const aiConfig = useAiStore((s) => s.config)
  const activeTab = fileStore.openTabs.find((t) => t.id === fileStore.activeTabId)
  const wsClient = getWsClientSync()
  const [aiMenuOpen, setAiMenuOpen] = useState(false)
  const [aiProcessing, setAiProcessing] = useState<AiCodeAction | null>(null)
  const [aiResult, setAiResult] = useState<AiCodeActionResult | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiActionName, setAiActionName] = useState<AiCodeAction | null>(null)
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [markdownPreview, setMarkdownPreview] = useState(false)
  const isMarkdown =
    activeTab?.language === 'markdown' ||
    activeTab?.name.endsWith('.md') ||
    activeTab?.name.endsWith('.mdx')

  const saveFile = useCallback(async () => {
    if (!activeTab || !activeTab.content) return
    const tab = fileStore.openTabs.find((t) => t.id === activeTab.id)
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
  const getSelectedText = useCallback((): string => {
    const view = viewRef.current
    if (!view) return ''
    const sel = view.state.selection.main
    if (sel.empty) return ''
    return view.state.sliceDoc(sel.from, sel.to - sel.from)
  }, [])

  const replaceSelectedText = useCallback((newText: string) => {
    const view = viewRef.current
    if (!view) return
    const sel = view.state.selection.main
    if (sel.empty) return
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: newText },
    })
  }, [])

  const openAiMenu = useCallback(() => {
    const selected = getSelectedText()
    if (!selected.trim()) return
    setAiMenuOpen(true)
  }, [getSelectedText])

  const handleAiAction = useCallback(
    async (action: AiCodeAction) => {
      if (!aiConfig.enabled || !aiConfig.apiKey) return
      const view = viewRef.current
      if (!view) return
      const selected = getSelectedText()
      if (!selected.trim()) return

      setAiMenuOpen(false)
      setAiProcessing(action)
      setAiActionName(action)
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
    },
    [aiConfig, getSelectedText, activeTab?.language],
  )

  const applyAiResult = useCallback(() => {
    if (!aiResult) return
    replaceSelectedText(aiResult.modified)
    setAiModalOpen(false)
    setAiResult(null)
  }, [aiResult, replaceSelectedText])

  const copyAiResult = useCallback(() => {
    if (!aiResult) return
    navigator.clipboard.writeText(aiResult.modified)
  }, [aiResult])

  // 初始化编辑器（语言包动态加载）
  useEffect(() => {
    if (!containerRef.current || !activeTab) return

    let cancelled = false
    setLangLoading(true)

    // 延迟加载语言扩展，避免阻塞首次渲染
    const initEditor = async () => {
      const langExt = await loadLanguageExtension(activeTab.language)
      if (cancelled || !containerRef.current) return

      // 如果已存在 editor view，先销毁
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }

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
            {
              key: 'Mod-s',
              run: () => {
                saveFile()
                return true
              },
            },
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
            '.cm-scroller': {
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: '13px',
            },
            '.cm-gutters': {
              backgroundColor: 'transparent',
              borderRight: '1px solid rgba(51,65,85,0.3)',
            },
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
      setLangLoading(false)
    }

    initEditor()

    return () => {
      cancelled = true
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
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
              <span
                className={`text-[11px] ${saveMsg.includes('失败') ? 'text-red-400' : 'text-emerald-400'}`}
              >
                {saveMsg}
              </span>
            )}
            <button
              onClick={saveFile}
              disabled={saving}
              className="btn-primary flex items-center gap-1 px-2 py-1 text-[11px]"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              保存 (Ctrl+S)
            </button>
          </div>
        </div>
      )}

      {/* 编辑器工具栏 */}
      <div className="flex items-center justify-between border-b border-slate-700/30 px-2 py-1">
        <span className="flex items-center gap-1 text-[10px] text-slate-600">
          {langLoading && <Loader2 size={10} className="animate-spin" />}
          {activeTab.language}
        </span>
        <div className="flex items-center gap-1">
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
              {aiMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAiMenuOpen(false)} />
                  <div className="absolute top-full right-0 z-50 mt-1 w-36 rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl">
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
          {isMarkdown && (
            <button
              onClick={() => setMarkdownPreview((v) => !v)}
              className={`btn-icon ${markdownPreview ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}
              title={markdownPreview ? '返回编辑' : '预览 Markdown'}
            >
              {markdownPreview ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
          <button
            onClick={() => {
              const tab = useFileStore
                .getState()
                .openTabs.find((t) => t.id === useFileStore.getState().activeTabId)
              if (!tab?.content) return
              const blob = new Blob([tab.content], { type: 'text/plain' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = tab.name
              a.click()
              URL.revokeObjectURL(url)
            }}
            className="btn-icon text-slate-500 hover:text-slate-300"
            title="下载文件"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {/* 编辑器 / 预览容器 */}
      {activeTab?.language === 'image' ? (
        <div
          className="flex flex-1 items-center justify-center overflow-auto bg-slate-900/50"
          style={{ minHeight: 0 }}
        >
          <img
            src={activeTab.content}
            alt={activeTab.name}
            className="max-h-full max-w-full object-contain"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
              const p = document.createElement('p')
              p.className = 'text-sm text-red-400'
              p.textContent = '图片加载失败'
              e.currentTarget.parentElement?.appendChild(p)
            }}
          />
        </div>
      ) : markdownPreview && isMarkdown ? (
        <div className="flex-1 overflow-auto" style={{ minHeight: 0 }}>
          <MarkdownPreview content={activeTab?.content || ''} className="h-full" />
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 overflow-auto" style={{ minHeight: 0 }} />
      )}

      {/* AI 结果模态框 */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="mx-4 max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
                {aiProcessing ? (
                  <>
                    <Loader2 size={16} className="text-smartbox-400 animate-spin" />
                    AI 处理中...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} className="text-smartbox-400" />
                    {aiResult && aiActionName && ACTION_LABELS[aiActionName]}
                  </>
                )}
              </span>
              <button
                onClick={() => {
                  setAiModalOpen(false)
                  setAiResult(null)
                  setAiError(null)
                }}
                className="btn-icon text-slate-500 hover:text-slate-300"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4">
              {aiProcessing && !aiResult && !aiError && (
                <div className="flex flex-col items-center py-8">
                  <Loader2 size={32} className="text-smartbox-400 animate-spin" />
                  <p className="mt-3 text-sm text-slate-500">正在调用 AI API...</p>
                </div>
              )}
              {aiError && (
                <div className="rounded-lg bg-red-500/10 p-4 text-sm text-red-400">{aiError}</div>
              )}
              {aiResult && (
                <div className="space-y-4">
                  {aiResult.explanation && (
                    <div>
                      <h4 className="mb-1 text-xs font-medium text-slate-500">说明</h4>
                      <div className="rounded-lg bg-slate-800/50 p-3 text-xs whitespace-pre-wrap text-slate-300">
                        {aiResult.explanation}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-slate-600">
                      代码行数: {aiResult.original.split('\n').length} →{' '}
                      {aiResult.modified.split('\n').length}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <h4 className="mb-1 text-xs font-medium text-slate-600">原始代码</h4>
                      <pre className="max-h-60 overflow-auto rounded-lg bg-slate-800/30 p-3 font-mono text-xs leading-relaxed text-slate-400">
                        <code>{aiResult.original}</code>
                      </pre>
                    </div>
                    <div>
                      <h4 className="mb-1 text-xs font-medium text-emerald-400">修改后</h4>
                      <pre className="max-h-60 overflow-auto rounded-lg bg-slate-800/50 p-3 font-mono text-xs leading-relaxed text-slate-200">
                        <code>{aiResult.modified}</code>
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
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
