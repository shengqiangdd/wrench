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
]

const isAnalyze = process.env.ANALYZE === 'true'
const buildTimestamp = Date.now()

export default defineConfig({
  build: {
    minify: 'esbuild',
    sourcemap: process.env.NODE_ENV === 'production' ? false : true,
    esbuildOptions: {
      drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (isExternal(id, 'xterm') || isExternal(id, '@xterm')) return 'vendor-xterm'
          for (const pkg of cmCore) {
            if (isExternal(id, pkg)) return 'vendor-cm-core'
          }
          for (const pkg of cmLangsCommon) {
            if (isExternal(id, pkg)) return 'vendor-cm-langs'
          }
          for (const pkg of cmLangsExtra) {
            if (isExternal(id, pkg)) return 'vendor-cm-langs-extra'
          }
          if (isExternal(id, 'react-router')) return 'vendor-router'
          if (isExternal(id, 'zustand')) return 'vendor-state'
          if (isExternal(id, 'lucide-react')) return 'vendor-lucide'
        },
      },
    },
    reportCompressedSize: true,
    chunkSizeWarningLimit: 1000,
  },
  plugins: [
    // React Compiler 仅在生产环境启用（dev 模式下 Oxc+HMR 与 Babel 不兼容）
    react({
      babel: process.env.NODE_ENV === 'production' ? {
        plugins: [
          ['babel-plugin-react-compiler', { target: '19' }],
        ],
      } : undefined,
    }),
    tailwindcss(),
    createHtmlPlugin({
      inject: {
        data: {
          buildVersion: `v${process.env.npm_package_version || '0.1.0'}`,
          buildTime: new Date(buildTimestamp).toISOString(),
        },
      },
    }),
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
