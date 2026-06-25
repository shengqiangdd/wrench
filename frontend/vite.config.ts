import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

function isExternal(id: string, pkg: string) {
  return id.includes(`/node_modules/${pkg}/`)
}

// Codemirror 核心包（基础 + 视图 + 编辑能力）
const cmCore = ['@codemirror/state', '@codemirror/view', '@codemirror/language',
  '@codemirror/commands', '@codemirror/search', '@codemirror/autocomplete',
  '@codemirror/theme-one-dark']
// Codemirror 常用语言包（高频使用）
const cmLangsCommon = ['@codemirror/lang-css', '@codemirror/lang-html',
  '@codemirror/lang-javascript', '@codemirror/lang-json',
  '@codemirror/lang-markdown', '@codemirror/lang-python',
  '@codemirror/lang-sql', '@codemirror/lang-xml', '@codemirror/lang-yaml']
// Codemirror 扩展语言包（低频使用）
const cmLangsExtra = ['@codemirror/lang-cpp', '@codemirror/lang-go',
  '@codemirror/lang-java', '@codemirror/lang-less', '@codemirror/lang-liquid',
  '@codemirror/lang-php', '@codemirror/lang-rust', '@codemirror/lang-vue',
  '@codemirror/lang-wast']

export default defineConfig({
  build: {
    minify: 'esbuild',
    esbuildOptions: {
      drop: ['console'],
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 将大库拆为独立 chunk，提高缓存复用率
          if (isExternal(id, 'xterm')) return 'vendor-xterm'
          // Codemirror: 核心基础包单独打包
          for (const pkg of cmCore) {
            if (isExternal(id, pkg)) return 'vendor-cm-core'
          }
          // Codemirror: 常用语言包（先加载）
          for (const pkg of cmLangsCommon) {
            if (isExternal(id, pkg)) return 'vendor-cm-langs'
          }
          // Codemirror: 扩展语言包（低频按需）
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
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png', 'icons/icon.svg'],
      manifest: {
        name: '智盒 SmartBox',
        short_name: 'SmartBox',
        description: '智能工具集合 — SSH 终端、SFTP 文件管理、开发工具',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        orientation: 'portrait',
        categories: ['productivity', 'utilities', 'developer-tools'],
        screenshots: [],
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/api\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
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
