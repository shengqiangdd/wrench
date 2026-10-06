import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
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
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/language',
  '@codemirror/commands',
  '@codemirror/search',
  '@codemirror/autocomplete',
  '@codemirror/theme-one-dark',
]
// CodeMirror 常用语言包（高频使用）
const cmLangsCommon = [
  '@codemirror/lang-css',
  '@codemirror/lang-html',
  '@codemirror/lang-javascript',
  '@codemirror/lang-json',
  '@codemirror/lang-markdown',
  '@codemirror/lang-python',
  '@codemirror/lang-sql',
  '@codemirror/lang-xml',
  '@codemirror/lang-yaml',
]
// CodeMirror 扩展语言包（低频使用）
const cmLangsExtra = [
  '@codemirror/lang-cpp',
  '@codemirror/lang-go',
  '@codemirror/lang-java',
  '@codemirror/lang-less',
  '@codemirror/lang-liquid',
  '@codemirror/lang-php',
  '@codemirror/lang-rust',
  '@codemirror/lang-vue',
]

const isAnalyze = process.env.ANALYZE === 'true'
const buildTimestamp = Date.now()

export default defineConfig({
  // 说明：这里原本有 `build.esbuildOptions.drop: ['console', 'debugger']`（生产丢弃 console / debugger）。
  // Vite 8 的 `build` 级没有 `esbuildOptions` 这个字段（它属于依赖预构建），所以那个选项一直是
  // **被静默忽略**的 —— 生产构建从来没有丢弃过 console（实测 dist 里仍有 161 处 console.* 调用）。
  //
  // 本轮**没有**恢复这个行为，理由有二：
  //   1) 它是「可调试性」的取舍 —— 丢掉客户端的 console.error/warn 会让人更难排查用户报的问题；
  //   2) 目前唯一可用的写法是顶层 `esbuild: { drop: [...] }`，而 Vite 8 已把它标为 deprecated
  //      （`Use oxc option instead`）。
  // 实测那条路确实有效（161 → 13 处，剩下的都是属性引用：xterm 的 logger 回退、prettier 插件内部、
  // 以及 PluginSandbox 对 console.log 的拦截 —— 都属预期保留），代价约 -15 KiB。
  // 要恢复就把 `esbuild: process.env.NODE_ENV === 'production' ? { drop: ['console','debugger'] } : undefined`
  // 加回来；想长期保留，最好等 Oxc 侧的等价选项。
  build: {
    minify: 'esbuild',
    sourcemap: process.env.NODE_ENV === 'production' ? false : true,
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
          // 其余模块交回打包器自己决定分块（显式返回，别让 noImplicitReturns 报「不是所有路径都有返回值」）
          return undefined
        },
      },
    },
    reportCompressedSize: true,
    chunkSizeWarningLimit: 1000,
  },
  plugins: [
    react(),
    // React Compiler 仅在生产环境启用（dev 模式下 Oxc+HMR 与 Babel 不兼容）。
    //
    // 注意：`@vitejs/plugin-react` 6 起**没有** `react({ babel })` 这个入口了 ——
    // 旧写法（`react({ babel: { plugins: [['babel-plugin-react-compiler', …]] } })`）
    // 是被静默忽略的，也就是「注释写着生产启用编译器、实际根本没启用」。
    // v6 的官方路径是 `babel()` 插件 + `reactCompilerPreset()`（见 plugin-react README）。
    ...(process.env.NODE_ENV === 'production' ? [babel({ presets: [reactCompilerPreset()] })] : []),
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
