/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['web-tree-sitter'] },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/@dbml/')) return 'dbml'
          if (id.includes('node_modules/@xyflow/')) return 'xyflow'
          if (id.includes('node_modules/@codemirror/') || id.includes('node_modules/codemirror/')) return 'codemirror'
          if (id.includes('node_modules/@faker-js/')) return 'faker'
          if (id.includes('node_modules/web-tree-sitter/')) return 'tree-sitter'
          if (id.includes('node_modules/elkjs/')) return 'elk'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    coverage: { provider: 'v8', include: ['src/core/**'], reporter: ['text', 'html'] },
  },
})
