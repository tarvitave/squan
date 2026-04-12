import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

let version = '0.2.0'
try { version = JSON.parse(readFileSync('./client/package.json', 'utf-8')).version } catch {}

export default defineConfig({
  plugins: [react()],
  root: './client',
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: '../.vite/renderer/main_window',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/ws': {
        target: 'ws://127.0.0.1:3001',
        ws: true,
      },
    },
  },
})
