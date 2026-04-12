import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'electron',
        'child_process',
        'path',
        'fs',
        'http',
        'os',
        'url',
      ],
    },
  },
  resolve: {
    conditions: ['node'],
  },
})
