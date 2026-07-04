/**
 * PluginSandbox.tsx
 *
 * 插件的 iframe 沙箱容器。每个插件运行在独立的 iframe 中，
 * 通过 postMessage 与主应用通信，实现 DOM/CSS/全局变量隔离。
 *
 * 修复：避免 generateSandboxHTML 在每次渲染时都创建新 Blob URL，
 * 只在 manifest.id 或 pluginCode 变化时重建。
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import type { PluginManifest } from '../types/plugin'

// ── 消息类型定义 ──

interface SandboxMessage {
  source: 'smartbox-plugin-sandbox'
  pluginId: string
  seq: number
  type: string
  payload: Record<string, unknown>
}

/** lazy import 避免循环依赖 */
let _fileStore: any = null
function getFileStore() {
  if (!_fileStore) {
    // 动态 import，仅在需要时加载
    import('../stores/file-store').then((m) => {
      _fileStore = m.useFileStore
    })
  }
  return _fileStore
}

export interface PluginSandboxHandle {
  executeCommand: (commandId: string, args?: unknown[]) => void
  updateEditorContent: (content: string | null, language: string | null) => void
  destroy: () => void
  iframe: HTMLIFrameElement | null
  reload: (manifest: PluginManifest, pluginCode: string) => void
}

interface PluginSandboxProps {
  manifest: PluginManifest
  pluginCode: string
  onReady?: (handle: PluginSandboxHandle) => void
  onCommandRegistered?: (command: { id: string; label?: string; description?: string }) => void
  onPanelRegistered?: (panel: { id: string; name?: string }) => void
  onNotification?: (message: string, type: 'info' | 'success' | 'error') => void
  onError?: (error: string) => void
  editorContent?: string | null
  editorLanguage?: string | null
}

export default function PluginSandbox({
  manifest,
  pluginCode,
  onReady,
  onCommandRegistered,
  onPanelRegistered,
  onNotification,
  onError,
  editorContent,
  editorLanguage,
}: PluginSandboxProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const pendingRef = useRef<
    Map<
      number,
      {
        resolve: (v: unknown) => void
        reject: (e: Error) => void
        timer: ReturnType<typeof setTimeout>
      }
    >
  >(new Map())
  const handleRef = useRef<PluginSandboxHandle | null>(null)
  const handlersRegisteredRef = useRef(false)

  // ── 生成沙箱 HTML（只在 manifest.id 或 pluginCode 变化时重新生成） ──
  const generateSandboxHTML = useCallback(() => {
    const nonce = Math.random().toString(36).slice(2, 18)
    const styleBlock = `
      <style nonce="${nonce}">
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; background: transparent; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e2e8f0; overflow: auto; }
        #plugin-root { min-height: 100%; padding: 4px; }
      </style>
    `

    const safeId = JSON.stringify(manifest.id)
    const safeManifest = JSON.stringify(manifest)

    const script = `
(function() {
  'use strict';

  var messageSeq = 0;
  var pendingCalls = {};
  var isRegistered = false;

  function sendToHost(type, payload) {
    var seq = ++messageSeq;
    window.parent.postMessage({
      source: 'smartbox-plugin-sandbox',
      pluginId: ${safeId},
      seq: seq,
      type: type,
      payload: payload || {}
    }, '*');
    return seq;
  }

  window.addEventListener('message', function(event) {
    if (event.data && event.data.source === 'smartbox-host') {
      var msg = event.data;
      if (msg.seq && pendingCalls[msg.seq]) {
        var pending = pendingCalls[msg.seq];
        clearTimeout(pending.timer);
        delete pendingCalls[msg.seq];
        if (msg.error) { pending.reject(new Error(msg.error)); }
        else { pending.resolve(msg.result); }
      }
    }
  });

  // ── 受限 localStorage ──
  var STORAGE_PREFIX = 'smartbox_plugin_' + ${safeId} + '_';
  var MAX_STORAGE = 51200;

  function getStorageUsage() {
    var total = 0;
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) { total += (key.length + (localStorage.getItem(key) || '').length); }
    }
    return total;
  }

  var sandboxStorage = {
    getItem: function(key) { try { return localStorage.getItem(STORAGE_PREFIX + key); } catch(e) { return null; } },
    setItem: function(key, value) {
      try {
        var fullKey = STORAGE_PREFIX + key;
        var oldVal = localStorage.getItem(fullKey);
        var oldLen = oldVal ? oldVal.length : 0;
        var newLen = value ? value.length : 0;
        var usage = getStorageUsage() - oldLen + newLen;
        if (usage > MAX_STORAGE) { console.warn('[Sandbox] Storage quota exceeded'); return; }
        localStorage.setItem(fullKey, value);
      } catch(e) {}
    },
    removeItem: function(key) { try { localStorage.removeItem(STORAGE_PREFIX + key); } catch(e) {} },
    clear: function() {
      try {
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
        }
        keys.forEach(function(k) { localStorage.removeItem(k); });
      } catch(e) {}
    },
    get length() {
      var count = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.startsWith(STORAGE_PREFIX)) count++;
      }
      return count;
    }
  };

  // ── 编辑器内容缓存（由主应用推送） ──
  var _editorContent = null;
  var _editorLanguage = null;

  // ── 插件状态 ──
  var __commandHandlers__ = {};

  // ── 受限 API ──
  var pluginAPI = Object.freeze({
    registerCommand: function(idOrDef, secondArg) {
      // 兼容两种调用方式：
      // 方式1: registerCommand('id', { label, description, execute })
      // 方式2: registerCommand({ id, label, description }, handler)
      var id, label, desc, handler;
      if (typeof idOrDef === 'string') {
        id = idOrDef;
        label = (secondArg && secondArg.label) || id;
        desc = (secondArg && secondArg.description) || '';
        handler = (secondArg && secondArg.execute) || secondArg;
      } else {
        id = idOrDef.id;
        label = idOrDef.label || id;
        desc = idOrDef.description || '';
        handler = secondArg;
      }
      if (!id) return;
      __commandHandlers__[id] = handler;
      isRegistered = true;
      sendToHost('registerCommand', { command: { id: id, label: label, description: desc } });
    },
    getEditorContent: function() { return _editorContent; },
    setEditorContent: function(content) {
      sendToHost('setEditorContent', { content: content });
    },
    getCurrentFileLanguage: function() { return _editorLanguage; },
    showNotification: function(message, type) {
      sendToHost('showNotification', { message: String(message), type: type || 'info' });
    },
    storage: Object.freeze({
      get: function(key) { return sandboxStorage.getItem(key); },
      set: function(key, value) { sandboxStorage.setItem(key, value); },
      remove: function(key) { sandboxStorage.removeItem(key); },
      clear: function() { sandboxStorage.clear(); }
    }),
    getRootElement: function() { return document.getElementById('plugin-root'); },
    getPluginId: function() { return ${safeId}; },
    getPluginInfo: function() { return Object.freeze(JSON.parse('${safeManifest.replace(/'/g, "\\\\'")}')); }
  });

  window.SmartBox = Object.freeze({
    getPluginAPI: function() { return pluginAPI; }
  });

  // ── 接受主应用消息 ──
  window.addEventListener('message', function(event) {
    if (event.data && event.data.source === 'smartbox-host') {
      var msg = event.data;
      if (msg.type === 'executeCommand') {
        var handler = __commandHandlers__[msg.commandId];
        if (handler) {
          try { handler(msg.args || []); } catch(e) { console.error('[Plugin] Command error:', e); }
        }
      } else if (msg.type === 'editorContentUpdate') {
        // 主应用推送编辑器内容更新
        if (msg.content !== undefined) _editorContent = msg.content;
        if (msg.language !== undefined) _editorLanguage = msg.language;
      }
    }
  });

  // ── 请求当前编辑器内容（初始化缓存） ──
  sendToHost('getEditorContent', {});

  sendToHost('sandboxReady', {});

  // ── 执行插件代码 ──
  try {
    ${pluginCode}
  } catch(e) {
    sendToHost('pluginError', { error: e.message || String(e) });
  }
})();
`
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self'; img-src 'self' data: https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self' https:; font-src 'self' data:;"></head><body><div id="plugin-root"></div><script nonce="${nonce}">${script}</script></body></html>`
  }, [manifest.id, manifest.name, pluginCode])

  // ── 使用 srcdoc 而不是 blob URL（避免 Safari 的 blob: 限制）
  // ── 创建 iframe 并注入 HTML（只在内容变化时重建） ──
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    setLoading(true)
    setLoadError(null)
    setReady(false)

    try {
      const html = generateSandboxHTML()
      iframe.srcdoc = html

      return () => {
        // srcdoc 不需要清理
      }
    } catch (err: any) {
      const msg = err.message || 'Failed to create sandbox'
      setLoadError(msg)
      setLoading(false)
      onError?.(msg)
    }
    return
  }, [manifest.id, pluginCode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 消息监听（只在挂载时注册一次） ──
  useEffect(() => {
    if (handlersRegisteredRef.current) return
    handlersRegisteredRef.current = true

    // ── 消息类型校验 ──
    function handleMessage(event: MessageEvent) {
      // 验证消息来源和类型
      const data = event.data
      if (!data || typeof data !== 'object') return
      if (data.source !== 'smartbox-plugin-sandbox') return
      if (typeof data.pluginId !== 'string') return
      if (typeof data.type !== 'string') return
      if (!data.payload || typeof data.payload !== 'object') return

      switch (data.type) {
        case 'sandboxReady': {
          setReady(true)
          setLoading(false)
          onReady?.(handleRef.current!)
          break
        }
        case 'registerCommand': {
          const cmd = data.payload.command as any
          if (cmd?.id) {
            onCommandRegistered?.(cmd)
          }
          break
        }
        case 'showNotification': {
          const { message, type } = data.payload as any
          onNotification?.(message || '', type || 'info')
          break
        }
        case 'pluginError': {
          const error = data.payload.error as string
          setLoadError(error)
          setLoading(false)
          onError?.(error)
          break
        }
        case 'setEditorContent': {
          // 插件写入编辑器内容
          const fileStore = getFileStore()
          if (fileStore) {
            const state = fileStore.getState()
            const content = data.payload.content as string
            if (state.activeTabId && content !== undefined) {
              state.updateFileContent(state.activeTabId, content)
            }
          }
          break
        }
        case 'getEditorContent': {
          // 插件请求编辑器内容 → 回复
          const fileStore = getFileStore()
          if (fileStore) {
            const state = fileStore.getState()
            const activeTab = state.openTabs?.find((t: any) => t.id === state.activeTabId)
            const iframe = iframeRef.current
            if (iframe?.contentWindow) {
              iframe.contentWindow.postMessage(
                {
                  source: 'smartbox-host',
                  type: 'editorContentUpdate',
                  content: activeTab?.content ?? null,
                  language: activeTab?.language ?? null,
                },
                '*',
              )
            }
          }
          break
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
      handlersRegisteredRef.current = false
    }
  }, [onReady, onCommandRegistered, onNotification, onError])

  // ── 暴露 handle ──
  useEffect(() => {
    const handle: PluginSandboxHandle = {
      executeCommand: (commandId, args) => {
        const iframe = iframeRef.current
        iframe?.contentWindow?.postMessage(
          {
            source: 'smartbox-host',
            type: 'executeCommand',
            commandId,
            args: args || [],
          },
          '*',
        )
      },
      updateEditorContent: (content, language) => {
        const iframe = iframeRef.current
        iframe?.contentWindow?.postMessage(
          {
            source: 'smartbox-host',
            type: 'editorContentUpdate',
            content,
            language,
          },
          '*',
        )
      },
      destroy: () => {
        const iframe = iframeRef.current
        if (iframe) {
          iframe.src = 'about:blank'
        }
      },
      iframe: iframeRef.current,
      reload: (_newManifest, _newCode) => {},
    }
    handleRef.current = handle
  }, [])

  // ── 渲染 ──
  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-slate-900/50">
      {loading && !loadError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-2 h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
            <p className="text-xs text-slate-500">沙箱加载中...</p>
          </div>
        </div>
      )}

      {loadError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/80 p-4">
          <div className="max-w-xs text-center">
            <p className="mb-1 text-sm text-red-400">沙箱加载失败</p>
            <p className="text-xs text-slate-500">{loadError}</p>
          </div>
        </div>
      )}

      <iframe
        ref={iframeRef}
        title={`沙箱: ${manifest.name}`}
        className="h-full w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        style={{ background: 'transparent' }}
      />
    </div>
  )
}
