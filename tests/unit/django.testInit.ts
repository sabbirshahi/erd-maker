/**
 * Initialises the Django parser in vitest (node/jsdom) with the wasm files from public/, so tests
 * need no browser. Other workers' tests may import this. OWNER: worker-4.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initDjangoParser } from '@/core/django'

export function initDjangoParserForTests(): Promise<void> {
  const dir = resolve(process.cwd(), 'public/tree-sitter')
  return initDjangoParser({
    runtimeWasm: new Uint8Array(readFileSync(resolve(dir, 'tree-sitter.wasm'))),
    languageWasm: new Uint8Array(readFileSync(resolve(dir, 'tree-sitter-python.wasm'))),
  })
}
