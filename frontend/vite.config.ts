import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import compression from 'vite-plugin-compression'
import { createHtmlPlugin } from 'vite-plugin-html'
import bundleAnalyzer from 'vite-bundle-analyzer'
import path from 'path'

function isExternal(id: string, pkg: string) {
  return id.includes(`/node_modules/${pkg}/`)
}

// CodeMirror 核心包（基础 + 视图 + 编辑能力）
const cmCore = [
  '@codemirror/state', '@codemirror/view', '@codemirror/language',
  '@codemirror/commands', '@codemirror/search', '@codemirror/autocomplete',
  '@codemirror/theme-one-dark',
]
// CodeMirror 常用语言包（高频使用）
const cmLangsCommon = [
  '@codemirror/lang-css', '@codemirror/lang-html',
  '@codemirror/lang-javascript', '@codemirror/lang-json',
  '@codemirror/lang-markdown', '@codemirror/lang-python',
  '@codemirror/lang-sql', '@codemirror/lang-xml', '@codemirror/lang-yaml',
]
// CodeMirror 扩展语言包（低频使用）
const cmLangsExtra = [
  '@codemirror/lang-cpp', '@codemirror/lang-go',
  '@codemirror/lang-java', '@codemirror/lang-less', '@codemirror/lang-liquid',
  '@codemirror/lang-php', '@codemirror/lang-rust', '@codemirror/lang-vue',
  '@codemirror/lang-wast',
]

// 是否启用 bundle 分析（仅 ANALYZE=true 时激活）
const isAnalyze = process.env.ANALYZE === 'true'

// 构建时间戳，用于 HTML 注入
const buildTimestamp = Date.now()

export default defineConfig({
  build: {
    minify: 'esbuild',
    sourcemap: process.env.NODE_ENV === 'production' ? 'hidden' : true,
    esbuildOptions: {
      drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          // xterm.js 终端（新旧包名都归入同一 vendor）
          if (isExternal(id, 'xterm') || isExternal(id, '@xterm')) return 'vendor-xterm'
          // CodeMirror: 核心基础包单独打包
          for (const pkg of cmCore) {
            if (isExternal(id, pkg)) return 'vendor-cm-core'
          }
          // CodeMirror: 常用语言包（先加载）
          for (const pkg of cmLangsCommon) {
            if (isExternal(id, pkg)) return 'vendor-cm-langs'
          }
          // CodeMirror: 扩展语言包（低频按需）
          for (const pkg of cmLangsExtra) {
            if (isExternal(id, pkg)) return 'vendor-cm-langs-extra'
          }
          if (isExternal(id, 'react-router')) return 'vendor-router'
          if (isExternal(id, 'zustand')) return 'vendor-state'
          if (isExternal(id, 'lucide-react')) return 'vendor-lucide'
          if (isExternal(id, 'idb')) return 'vendor-idb'
        },
      },
    },
    // 报告 gzip 压缩后大小
    reportCompressedSize: true,
    // 分块大小警告阈值（增大以适配 CodeMirror 等大库）
    chunkSizeWarningLimit: 1000,
  },
  plugins: [
    react(),
    tailwindcss(),

    // HTML 注入：版本号 + 构建时间
    createHtmlPlugin({
      inject: {
        data: {
          buildVersion: `v${process.env.npm_package_version || '0.1.0'}`,
          buildTime: new Date(buildTimestamp).toISOString(),
        },
      },
    }),

    // gzip + brotli 压缩（生产环境）
    compression({
      algorithm: 'gzip',
      ext: '.gz',
      threshold: 1024,
      deleteOriginFile: false,
    }),
    compression({
      algorithm: 'brotliCompress',
      ext: '.br',
      threshold: 1024,
      deleteOriginFile: false,
    }),

    // Bundle 分析（仅在 ANALYZE=true 时启用）
    ...(isAnalyze ? [bundleAnalyzer()] : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
})
