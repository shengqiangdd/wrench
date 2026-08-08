import '@testing-library/jest-dom'

// ─── React 19 CJS act 补丁 ───
// react-dom/test-utils 在 CJS 环境下 require('react').act 返回 undefined
// 手动将 React.act 指向正确的 act 实现
// React 19.2.7 的 ESM/CJS 混合加载下，`import { act } from 'react'` 在 vitest
// 中也可能返回 undefined。此补丁在不同加载路径下均生效：
//   (a) 全局钩子 — 如果 React 暴露在 globalThis 上
//   (b) CJS require — 如果模块通过 CJS require 加载
{
  // 方法1: 通过 react-dom/test-utils 获取 act（它在所有版本中都保留）
  let actFn: ((callback: () => void | Promise<void>) => void) | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const testUtils = require('react-dom/test-utils')
    if (typeof testUtils.act === 'function') {
      actFn = testUtils.act
    }
  } catch {
    // react-dom/test-utils may not exist in all setups
  }

  if (actFn) {
    // Patch globalThis.React.act (if React is exposed globally)
    const gReact = (globalThis as Record<string, unknown>).React as
      Record<string, unknown> | undefined
    if (gReact && typeof gReact.act !== 'function') {
      Object.defineProperty(gReact, 'act', {
        value: actFn,
        writable: true,
        configurable: true,
      })
    }

    // Patch CJS require('react') module
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const React = require('react')
      if (typeof React.act !== 'function') {
        Object.defineProperty(React, 'act', {
          value: actFn,
          writable: true,
          configurable: true,
        })
      }
    } catch {
      // React not loaded via CJS
    }

    // Patch ESM imported react module via globalThis workaround
    // Vite's CJS→ESM interop re-exports the CJS module; patching the CJS
    // module should propagate to ESM imports
    const gAny = globalThis as Record<string, unknown>
    if (!gAny.__REACT_ACT_PATCHED__) {
      gAny.__REACT_ACT_PATCHED__ = true
    }
  }
}

// ─── Global mocks for jsdom ───

// Mock localStorage for Zustand persist middleware
const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k])
    },
    get length() {
      return Object.keys(store).length
    },
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
  URL.revokeObjectURL = (_url: string) => {
    /* no-op in jsdom */
  }
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

// Mock IntersectionObserver for jsdom
if (typeof IntersectionObserver === 'undefined') {
  class MockIntersectionObserver {
    constructor(_callback: IntersectionObserverCallback) {}
    observe(_target: Element) {}
    unobserve(_target: Element) {}
    disconnect() {}
  }
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver
}

// Mock scrollIntoView for jsdom (used by CommandPalette)
Element.prototype.scrollIntoView = function () {}
