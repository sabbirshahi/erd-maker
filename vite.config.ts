/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { createRequire } from 'node:module'

// The backup file and the crash screen both report which build produced them.
const { version } = createRequire(import.meta.url)('./package.json') as { version: string }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['web-tree-sitter'] },
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        // Vite 8 (Rolldown): `manualChunks` is a compat shim that ignored our @dbml/parse group and
        // folded it into the @dbml/core chunk, and `advancedChunks` is now deprecated in favour of
        // `codeSplitting`, which takes the same shape. The 15 MB SQL engine (@dbml/core) must stay
        // apart from the small DBML compiler (@dbml/parse): only src/core/sql loads @dbml/core, via
        // dynamic import().
        codeSplitting: {
          groups: [
            { name: 'dbml-core', test: /node_modules[\\/]@dbml[\\/]core[\\/]/ },
            { name: 'dbml-parse', test: /node_modules[\\/]@dbml[\\/]parse[\\/]/ },
            { name: 'xyflow', test: /node_modules[\\/]@xyflow[\\/]/ },
            { name: 'codemirror', test: /node_modules[\\/](@codemirror|codemirror)[\\/]/ },
            { name: 'faker', test: /node_modules[\\/]@faker-js[\\/]/ },
            { name: 'tree-sitter', test: /node_modules[\\/]web-tree-sitter[\\/]/ },
            { name: 'elk', test: /node_modules[\\/]elkjs[\\/]/ },
          ],
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
