import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

function isExternal(id: string, pkg: string) {
  return id.includes(`/node_modules/${pkg}/`)
}

export default defineConfig({
  build: {
    minify: 'terser',
    terserOptions: {
      compress: { drop_console: true },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 将大库拆为独立 chunk，提高缓存复用率
          if (isExternal(id, 'xterm')) return 'vendor-xterm'
          if (isExternal(id, '@codemirror')) return 'vendor-codemirror'
          if (isExternal(id, 'codemirror')) return 'vendor-codemirror'
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
