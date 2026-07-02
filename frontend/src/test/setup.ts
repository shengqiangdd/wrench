import '@testing-library/jest-dom'
import { act } from 'react'

// ─── React 19 CJS act 补丁 ───
// react-dom/test-utils 在 CJS 环境下 require('react').act 返回 undefined
// 手动将 React.act 指向正确的 act 实现
if (typeof (act as any) === 'function' && !(globalThis as any).React?.act) {
  const React = require('react') as typeof import('react')
  Object.defineProperty(React, 'act', {
    value: act,
    writable: true,
    configurable: true,
  })
}

// ─── Global mocks for jsdom ───

// Mock localStorage for Zustand persist middleware
const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { Object.keys(store).forEach(k => delete store[k]) },
    get length() { return Object.keys(store).length },
    key: (index: number) => Object.keys(store)[index] ?? null,
  },
  writable: true,
  configurable: true,
})

// Mock URL.createObjectURL and revokeObjectURL for jsdom
if (typeof URL.createObjectURL === 'undefined') {
  let blobId = 0
  URL.createObjectURL = (_blob: Blob) => `blob:mock-${++blobId}`
}
if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = (_url: string) => { /* no-op in jsdom */ }
}

// Mock ResizeObserver for jsdom (used by VirtualList)
if (typeof ResizeObserver === 'undefined') {
  class MockResizeObserver {
    private callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }
    observe(_target: Element) {
      // Trigger callback immediately with default content rect
      this.callback([], this)
    }
    unobserve(_target: Element) {}
    disconnect() {}
  }
  globalThis.ResizeObserver = MockResizeObserver
}
