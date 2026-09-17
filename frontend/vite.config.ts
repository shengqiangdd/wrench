import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import compression from 'vite-plugin-compression'
import { createHtmlPlugin } from 'vite-plugin-html'
import bundleAnalyzer from 'vite-bundle-analyzer'
import path from 'path'
import { brotliCompress, constants } from 'node:zlib'
import { promisify } from 'node:util'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'

const brotliCompressAsync = promisify(brotliCompress)

/** Generate .br assets without the shared mtime cache collision of two compression plugin instances. */
function brotliAssets() {
  return {
    name: 'wrench-brotli-assets',
    apply: 'build' as const,
    enforce: 'post' as const,
    async closeBundle() {
      const outDir = path.resolve(__dirname, 'dist')
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(outDir, { withFileTypes: true, recursive: true })
      } catch {
        return
      }
      const candidates = entries
        .filter((entry) => entry.isFile() && /\.(js|mjs|json|css|html)$/i.test(entry.name))
        .map((entry) => path.join(entry.parentPath ?? outDir, entry.name))
      await Promise.all(
        candidates.map(async (source) => {
          const target = `${source}.br`
          const [input, sourceStat] = await Promise.all([readFile(source), stat(source)])
          if (sourceStat.size < 1024) return
          const compressed = await brotliCompressAsync(input, {
            params: {
              [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
              [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
            },
          })
          await writeFile(target, compressed)
        }),
      )
    },
  }
}

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
          if (isExternal(id, 'idb')) return 'vendor-idb'
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
    brotliAssets(),
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
