# DBridge — Agent Guide

Browser-only ERD maker: **DBML** (dbdiagram.io language) ⇄ **canvas** ⇄ **Django models.py**, plus a **demo mode**
that runs real Django + SQLite in the browser via Pyodide. Zero backend; deployed as a static site on Vercel.

**The plan is the spec:** `/home/sabbirshahi/VibeCoding/.omc/plans/erd-maker-plan.md` (read it first; §2 architecture, §3 phases, §4 acceptance criteria).

## Commands

```bash
pnpm dev            # http://localhost:5173
pnpm typecheck      # tsc -b --noEmit   (must pass before every commit)
pnpm lint           # oxlint
pnpm test           # vitest (unit)     (must pass before every commit)
pnpm build          # production build
pnpm e2e            # playwright (chromium) — run `pnpm e2e:install` once
```

Node 24, pnpm 10, React 19, Vite 8, TypeScript 6, Tailwind 4 (`@import "tailwindcss"` — no tailwind.config), Zustand 5 + zundo, immer.
Path alias: `@/` → `src/`. No semicolons, single quotes (see `.prettierrc`).

## Non-negotiable contracts

- `src/core/schema.ts` is the canonical IR. **Do not change existing field names/types.** Adding optional fields is OK — announce it in your commit message.
- `src/store/schemaStore.ts` is the only way to change the schema (`commit` / `update`). Regenerate your view's text only when `origin !== you`. Never write into a focused text editor (`focus`).
- Stub modules define the function signatures the other workers depend on. **Keep the signatures**, replace the bodies:
  - `src/core/dbml/index.ts` — `parseDbml`, `generateDbml` (synchronous; built on `@dbml/parse`, never import `@dbml/core` here)
  - `src/core/reconcile.ts` — `reconcile(prev, next, { preserveDjango? })`
  - `src/core/sql/index.ts` — `importSql`, `exportSql` — **async** (`Promise<...>`): they `import('@dbml/core')` lazily so the 15 MB SQL engine stays out of the DBML editing path. `loadSqlEngine()` warms it up. Nothing outside `src/core/sql` may import `@dbml/core` (guarded by `tests/unit/dbml.bundle.test.ts`).
  - `src/core/django/index.ts` — `generateDjango`, `initDjangoParser`, `parseDjango`
  - `src/core/fake/index.ts` — `generateFakeData`
- Diagnostics go through `setDiagnostics(source, [...])`; use `diag()` from schema.ts. Lossy mappings set `lossy: true`.
- Node positions live in `layout` (store) — never in DBML.
- `src/core/**` is pure TypeScript: no React, no DOM, ≥ 90 % coverage.

## Ownership (one worker per area — do not edit another worker's files; message them instead)

| Worker | Area | Owns | Brief |
| --- | --- | --- | --- |
| worker-1 | core-dbml | `src/core/dbml/**`, `src/core/reconcile.ts`, `src/core/sql/**`, `tests/fixtures/**`, `tests/unit/dbml*`, `tests/unit/sql*`, `tests/unit/reconcile*` | `docs/briefs/worker-1-core-dbml.md` |
| worker-2 | canvas | `src/canvas/**`, `tests/e2e/canvas*` | `docs/briefs/worker-2-canvas.md` |
| worker-3 | editors | `src/editors/**`, `tests/e2e/editors*` | `docs/briefs/worker-3-editors.md` |
| worker-4 | core-django | `src/core/django/**`, `public/tree-sitter/**`, `tests/golden/**`, `tests/unit/django*` | `docs/briefs/worker-4-core-django.md` |
| worker-5 | demo | `src/demo/**`, `src/core/fake/**`, `public/py/**`, `tests/unit/fake*`, `tests/e2e/demo*` | `docs/briefs/worker-5-demo.md` |
| worker-6 | app shell | `src/app/**`, `src/App.tsx`, `src/main.tsx`, `src/index.css`, `src/examples/**`, `index.html`, `vercel.json`, `README.md`, `.github/**`, `tests/e2e/app*` | `docs/briefs/worker-6-app.md` |

Shared files (`package.json`, `vite.config.ts`, `tsconfig*.json`, `AGENTS.md`, `src/core/schema.ts`, `src/store/**`): edit minimally, only when necessary, and commit that change alone with a clear message so others can pull it.

## Component contracts (what the app shell imports)

```ts
// worker-2
export { Canvas } from '@/canvas'                 // <Canvas /> full-size, uses the store
// worker-3
export { DbmlEditor, DjangoEditor } from '@/editors'
export { ImportDialog, ExportDialog } from '@/editors'   // props: { open: boolean; onClose(): void }
// worker-5
export { DemoPanel } from '@/demo'                // <DemoPanel /> self-contained (boot button, tabs, results)
// worker-6 provides
export { toast } from '@/app/toast'               // toast(message: string, kind?: 'info' | 'error')
export { CopyButton } from '@/app/CopyButton'     // <CopyButton text={string | () => string} label="DBML" />
```

**`erd:goto` event (Problems panel → editors):** clicking a diagnostic row calls `select({tableId, columnId, refId})`
and, when the diagnostic has a `line`, dispatches `window.dispatchEvent(new CustomEvent('erd:goto', { detail: { view, line, col } }))`
with `view: 'dbml' | 'django'` (derived from `diagnostic.source`). The shell also switches the right pane to that tab.
Editors (worker-3) listen on `window` and scroll/place the cursor at `line`/`col` (1-based). Types: `GotoEventDetail` in `src/app/ProblemsPanel.tsx`.
Test hook: `window.__erd = { store: useSchemaStore }` is set in `main.tsx` in dev/test or when `location.search` includes `e2e`.

Until a component exists, the shell renders a placeholder; use `import()` guards if needed, but prefer landing a minimal real component early.

## Git protocol

Single shared working tree, `main` branch. Commit small and often, only your own files, after `pnpm typecheck && pnpm test` pass.
`git add <your paths>` — never `git add -A`. Message format: `<area>: <what>` e.g. `canvas: add column handles`.
If a commit of yours needs a shared-file change, do it in its own commit first.

## Definition of done (per worker)

Your brief's "Done when" list is satisfied, unit tests exist for pure logic, `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass, and you have posted a final summary (what shipped, what's missing) via the team mailbox to `leader`.
