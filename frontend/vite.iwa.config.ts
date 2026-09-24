import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const frontendRoot = path.dirname(fileURLToPath(import.meta.url))
const iwaRoot = path.resolve(frontendRoot, '../browser-iwa')

export default defineConfig({
  root: iwaRoot,
  publicDir: path.join(iwaRoot, 'public'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      react: path.resolve(frontendRoot, 'node_modules/react'),
      'react-dom': path.resolve(frontendRoot, 'node_modules/react-dom'),
    },
  },
  build: {
    outDir: path.join(iwaRoot, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
  },
})
