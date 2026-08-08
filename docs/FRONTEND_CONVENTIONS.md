# FRONTEND_CONVENTIONS.md — React 前端开发规范

> 本文档规定 Wrench 前端（React + TypeScript + Vite 8）的代码风格、模式与约束。

---

## 1. React 组件规范

### 1.1 函数式组件 + Hooks（唯一模式）

```tsx
// ✅ 正确模板
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button' // Vite 8 别名 '@' -> 'src'
import type { SomeType } from '@/types/ssh'

interface MyProps {
  connectionId: string
  onData: (data: string) => void
}

export default function MyComponent({ connectionId, onData }: MyProps) {
  const [data, setData] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await authedFetch(`/api/ssh/exec`, {
        method: 'POST',
        body: JSON.stringify({ connectionId, command: 'uptime' })
      })
      // ...
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  useEffect(() => {
    fetchData()
    // cleanup function for async requests
    let aborted = false
    return () => { aborted = true }
  }, [fetchData])

  return (
    <div className="flex flex-col gap-2 p-4">
      {loading && <span className="text-sm text-gray-500">Loading...</span>}
      {data && <pre className="bg-gray-900 p-2 rounded text-xs">{data}</pre>}
    </div>
  )
}
```

### 1.2 禁止模式

| ❌ 禁止 | ✅ 必须 |
|--------|--------|
| Class 组件 | 函数式组件 + Hooks |
| `let`/`var` 全局变量 | `useState`/`useReducer`/`useStore` |
| 内联样式 `style={{...}}` | Tailwind `className` |
| 硬编码 `string[]` 类型 | 定义 `interface` 或从 `types/` 导入 |

---

## 2. WebSocket 客户端标准用法

### 2.1 客户端模板（来自 `services/websocket.ts`）

```ts
// WebSocket 消息协议
interface WsMessage {
  type: string
  requestId?: string
  payload?: Record<string, unknown>
  error?: string
}

export class WsClient {
  private ws: WebSocket | null = null
  private status: WsStatus = 'disconnected'
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  // 连接（带心跳 + 指数退避重连）
  connect() {
    this.ws = new WebSocket(this.url)
    
    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.status = 'connected'
      this.startHeartbeat()
      this.dispatch({ type: 'connected' })
    }

    this.ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as WsMessage
      this.dispatch(data) // 分发到注册的 handlers
    }

    this.ws.onclose = () => {
      this.stopHeartbeat()
      this.status = 'disconnected'
      this.scheduleReconnect()
    }
  }

  // 心跳机制
  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30_000) // 30s 心跳
  }

  // 指数退避重连
  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts++))
    setTimeout(() => this.connect(), delay)
  }

  // 发送请求（带 requestId 匹配）
  sendRequest(type: string, payload: Record<string, unknown>) {
    const requestId = (++this.requestIdCounter).toString()
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, timer: setTimeout(() => reject(new Error('timeout')), 30_000) })
      this.ws?.send(JSON.stringify({ type, requestId, payload }))
    })
  }
}
```

### 2.2 认证集成（来自 `services/auth.ts`）

```ts
// 获取一次性令牌（POST /api/ws-token）
export async function getToken(): Promise<string> {
  if (_currentToken) return _currentToken
  return refreshToken()
}

export async function buildWsUrl(path: string): Promise<string> {
  const token = await getToken()
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${path}?token=${token}`
}
```

### 2.3 React Hook 用法

```tsx
// hooks/useWebSocket.ts
import { useEffect, useRef, useState } from 'react'
import { WsClient, type WsStatus } from '@/services/websocket'

export function useWebSocket(urlBuilder: () => Promise<string>) {
  const wsRef = useRef<WsClient | null>(null)
  const [status, setStatus] = useState<WsStatus>('disconnected')

  useEffect(() => {
    let aborted = false
    
    urlBuilder().then(url => {
      if (aborted) return
      const client = new WsClient(url)
      wsRef.current = client
      client.onStatus(setStatus).connect()
    })

    return () => {
      aborted = true
      wsRef.current?.disconnect()
    }
  }, [urlBuilder])

  return { status, client: wsRef.current }
}
```

---

## 3. CodeMirror 6 / xterm.js 集成注意事项

### 3.1 CodeMirror 6（来自 `components/CodeMirrorEditor.tsx`）

```tsx
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { useEffect, useRef } from 'react'

interface CodeMirrorEditorProps {
  value: string
  language?: string
  onChange?: (value: string) => void
}

export default function CodeMirrorEditor({ value, language, onChange }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  // 初始化 EditorView
  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: value,
      extensions: [
        ...getLanguageExtension(language), // 语法高亮
        ...(onChange ? [EditorView.updateListener.of(u => {
          if (u.docChanged) onChange(u.state.doc.toString())
        })] : []),
      ],
    })

    viewRef.current = new EditorView({
      state,
      parent: containerRef.current,
    })

    // ✅ 关键：组件卸载时销毁视图
    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, []) // 空依赖数组，只初始化一次

  // 更新 value（如果外部变化）
  useEffect(() => {
    if (viewRef.current && viewRef.current.state.doc.toString() !== value) {
      viewRef.current.dispatch(
        viewRef.current.state.changeByRange(() => ({
          changes: [{ from: 0, to: viewRef.current!.state.doc.length, insert: value }],
          effects: [],
        }))
      )
    }
  }, [value])

  return <div ref={containerRef} className="cm-editor-container" />
}
```

### 3.2 xterm.js（来自 `modules/ssh/` 相关组件）

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'

export function TerminalComponent({ connectionId }: { connectionId: string }) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!terminalRef.current) return

    // 初始化 Terminal
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'monospace',
      theme: getTheme(),
    })
    termRef.current = term

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)

    term.open(terminalRef.current)
    fitAddon.fit() // 窗口适配

    // WebSocket 集成（发送/接收数据）
    const ws = getWsClientSync()
    ws?.onMessage('data', data => {
      term.write(data as string)
    })

    // ✅ 关键：自动 resize
    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(terminalRef.current)

    // ✅ 关键：销毁时清理
    return () => {
      resizeObserver.disconnect()
      term.dispose() // 清理 WebGL/WebSocket 资源
      termRef.current = null
    }
  }, [])
}
```

### 3.3 Ref 使用原则

1. **实例存取**：`useRef<T | null>(null)` 存外部库实例（xterm、CodeMirror、WebSocket）
2. **变更检测**：`useEffect` 依赖数组控制何时重建
3. **生命周期**：`return () => instance.destroy()` 或 `.dispose()` 清理资源
4. **状态同步**：`useEffect` 监听外部 props 变化，手动同步到实例

---

## 4. Zustand Store 使用规范

### 4.1 Slice 模式（来自 `stores/slices/ui.slice.ts`）

```ts
// stores/slices/ui.slice.ts
import type { StateCreator } from 'zustand'
import type { UISlice } from '../types'

export const createUISlice: StateCreator<UISlice> = (set, get) => ({
  activeNav: 'ssh',
  setActiveNav: (nav) => set({ activeNav: nav }),
  
  toasts: [],
  addToast: (toast) => set(state => ({
    toasts: [...state.toasts, toast]
  })),
})

// stores/types.ts 导出类型
export interface UISlice {
  activeNav: NavId
  setActiveNav: (nav: NavId) => void
  toasts: ToastItem[]
  addToast: (toast: ToastItem) => void
}
```

### 4.2 持久化 Store（来自 `stores/ssh-store.ts`）

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useSshStore = create<SshState>()(
  persist(
    (set, get) => ({
      connections: [],
      addConnection: (conn) => {
        set(state => ({ connections: [...state.connections, conn] }))
        // 服务端同步
        get().pushToServer(conn)
      },
      syncFromServer: async () => { /* ... */ },
    }),
    {
      name: 'wrench-ssh-storage', // localStorage key
      partialize: (s) => ({ connections: s.connections }),
    }
  )
)
```

---

## 5. 样式规范

- **仅 Tailwind CSS v4**：禁止写入 `<style>`、`.module.css`、styled-components
- **颜色**：使用 CSS 变量（`hsl(var(--background))`）支持暗色/亮色主题
- **响应式**：移动端优先 `sm:` `md:` 断点
- **动画**：仅允许 `transition-*`，禁止 `@keyframes`（除非必要）

---

> **记住**：组件**轻薄**，状态**单向**，样式**声明式**。任何外部实例（WebSocket、编辑器、终端）都必须在 `useEffect` 里创建、在 cleanup 里销毁。