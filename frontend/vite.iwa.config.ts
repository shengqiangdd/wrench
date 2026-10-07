import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const frontendRoot = path.dirname(fileURLToPath(import.meta.url))
const iwaRoot = path.resolve(frontendRoot, '../browser-iwa')
const sshPort = Number(process.env.VITE_IWA_SSH_PORT ?? 22)
if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) {
  throw new Error('VITE_IWA_SSH_PORT must be an integer between 1 and 65535')
}

export default defineConfig({
  define: {
    __WRENCH_IWA_SSH_PORT__: JSON.stringify(sshPort),
  },
  root: iwaRoot,
  publicDir: path.join(iwaRoot, 'public'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      react: path.resolve(frontendRoot, 'node_modules/react'),
      'react-dom': path.resolve(frontendRoot, 'node_modules/react-dom'),
      '@xterm/xterm': path.resolve(frontendRoot, 'node_modules/@xterm/xterm'),
    },
  },
  build: {
    outDir: path.join(iwaRoot, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
  },
})
