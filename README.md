# DBridge

Browser-only entity-relationship diagram maker. Write **DBML**, drag tables on a **canvas**, and read
the equivalent **Django `models.py`** — all three views stay in sync. A **demo mode** boots real Django +
SQLite in the browser (Pyodide) so you can seed fake data and run SQL / ORM queries against your schema.

No backend. No accounts. Your work autosaves to `localStorage`, and **Share** puts the whole document in
the URL.

## Features

- DBML editor (dbdiagram.io dialect) with diagnostics, ⇄ canvas, ⇄ Django models (parse *and* generate)
- Import DBML, SQL DDL or `models.py`; export DBML, SQL, `models.py`, JSON (schema + layout) and PNG
- **Problems** panel: every parser/generator/type-map warning with jump-to-line and "lossy only" filter
- Examples gallery (blog, e-commerce, school, SaaS multi-tenant, Django auth) with generated thumbnails
- Undo/redo, dark mode, share links (`#d=…`, lz-string compressed), copy buttons on every artifact
- Demo: Django + SQLite in the browser, fake data, SQL and ORM query tabs

## Development

```bash
pnpm install
pnpm dev            # http://localhost:5173
pnpm typecheck      # tsc -b --noEmit
pnpm lint           # oxlint
pnpm test           # vitest unit tests
pnpm build          # production build → dist/
pnpm e2e:install    # once: download chromium for Playwright
pnpm e2e            # Playwright e2e against the production preview (port 4173)
```

Requires Node 24 and pnpm 10. Append `?e2e` to the URL to expose `window.__erd.store` for scripting.

## Architecture

The plan is the spec: `.omc/plans/erd-maker-plan.md` (§2 architecture, §3 phases, §4 acceptance criteria).
Contributor rules, ownership and component contracts live in [`AGENTS.md`](./AGENTS.md).

```
src/core/      pure TS: schema IR (schema.ts), DBML parse/generate, reconcile, SQL, Django, fake data
src/store/     zustand + zundo store — the only way to change the schema (commit / update)
src/canvas/    React Flow diagram
src/editors/   CodeMirror DBML + Django editors, Import/Export dialogs
src/demo/      Pyodide-powered Django demo panel
src/app/       shell, Problems panel, persistence, share links, theme, toast, examples gallery
src/examples/  bundled .dbml examples
```

Every view is a projection of the canonical IR in `src/core/schema.ts`. Views write through the store and
regenerate their text only when the change came from somewhere else, so a focused editor is never
overwritten.

## Deploy (Vercel)

The site is static; `vercel.json` is already configured (framework Vite, `pnpm build`, output `dist`,
SPA rewrite, immutable caching for `/assets`).

1. Push the repository to GitHub.
2. In Vercel: **Add New → Project**, import the repo (Hobby plan is fine).
3. Framework preset **Vite** is auto-detected; keep build command `pnpm build` and output directory `dist`.
   Set the Node.js version to 24 in *Project Settings → General* if it is not the default.
4. Deploy. Every push to `main` redeploys; pull requests get preview URLs.

Or from a terminal: `npx vercel` (first run links the project), then `npx vercel --prod`.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests, build and the Playwright suite on every
push and pull request.

## License

MIT
