# DBridge

Browser-only entity-relationship diagram maker. Write **DBML**, drag tables on a **canvas**, and read
the equivalent **Django `models.py`** — all three views stay in sync. A **demo mode** boots real Django +
SQLite in the browser (Pyodide) so you can seed fake data and run SQL / ORM queries against your schema.

No backend. No accounts. Your work autosaves to `localStorage`, and **Share** puts the whole document in
the URL.

## Embedding

Add `?embed=1` to render the canvas alone — read-only, no top bar, no code panes, no problems
panel. Combine it with a share link to embed one specific diagram:

```html
<iframe src="https://your-deployment/?embed=1#d=…" width="100%" height="480" style="border:0"></iframe>
```

An embed writes **nothing** to the visitor's browser: no autosave, no project index, no theme, no
session key. That is enforced in the persistence layer rather than by hiding the buttons, so a
diagram on your blog can never touch a reader's own saved diagrams.

## Privacy

Your diagrams live in this browser. They are stored only in `localStorage`, and editing, autosave,
import, export and the Django demo all run locally — none of them send a schema anywhere.

**Sharing is the exception.** Pressing Share uploads the compressed diagram and gives you a short
`/s/<id>` link. The stored copy is deleted automatically after 7 days, and until then anyone holding
the link can read that diagram, so treat a share link as the secret it is. The app tells you this in
the toast at the moment you share.

Two things still never upload anything. Where no share storage is configured — local development,
CI, or a self-hosted build without it — Share falls back to the original behaviour and puts the
whole diagram inside a long `#d=…` link. And every `#d=…` link, including ones handed out before
short links existed, is decoded entirely in your browser with no network request at all.

The hosted build does count usage, and it is worth being precise about the difference: analytics
record *that* an action happened, never *what* it acted on. It uses [Plausible](https://plausible.io),
which is cookieless, sets no identifiers and needs no consent banner, and it collects:

- a pageview (URL path, referrer, browser, OS and country — the standard Plausible set)
- five events with fixed properties: `import` (`kind`), `export` (`format`), `share-created`
  (`tables`, a count), `example-opened` (`example`, the built-in example's id) and `demo-started`

That is the complete list. No table names, no column names, no DBML, no `models.py`, and no share-link
contents are ever sent — `TrackedEvent` in `src/app/analytics.ts` is a closed union, so sending
anything else is a type error rather than a judgement call.

Analytics load **only** when `VITE_ANALYTICS_DOMAIN` is set at build time. It is unset in development,
in CI and for the Playwright suite, and without it no script tag is added and no request is made. Run
your own build without that variable and the app makes no network calls at all beyond loading itself
(and Pyodide, if you open demo mode).

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

The site is static apart from one function, `api/share.ts`, which backs short share links.
`vercel.json` is already configured (framework Vite, `pnpm build`, output `dist`, SPA rewrite that
excludes `/api`, immutable caching for `/assets`).

1. Push the repository to GitHub.
2. In Vercel: **Add New → Project**, import the repo (Hobby plan is fine).
3. Framework preset **Vite** is auto-detected; keep build command `pnpm build` and output directory `dist`.
   Set the Node.js version to 24 in *Project Settings → General* if it is not the default.
4. Deploy. Every push to `main` redeploys; pull requests get preview URLs.

Or from a terminal: `npx vercel` (first run links the project), then `npx vercel --prod`.

### Share storage (optional)

Short `/s/<id>` links need somewhere to put the diagram. Without it the app still works and still
shares — `api/share.ts` answers `503`, and the client falls back to the original self-contained
`#d=…` link, which is long but needs no server. That is also what happens in local development and
in CI, so nothing below is required to run or test the project.

To turn short links on:

1. Vercel dashboard → your project → **Storage** → **Create** → a Redis store from the Marketplace
   (Upstash's free tier is enough). Redis is what enforces the 7-day expiry, using a key TTL, so
   there is no cleanup job to run.
2. Connect it to the project and let Vercel inject the environment variables. The function accepts
   either naming: `KV_REST_API_URL` + `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` +
   `UPSTASH_REDIS_REST_TOKEN`.
3. Redeploy. Nothing else changes.

Never commit those values — they are credentials, and this repository is public.

What the endpoint enforces: payloads are capped at 128 KB, ids carry 128 bits of entropy so they
cannot be guessed or walked, each address may create 20 links per 10 minutes, and no response or
log ever contains a payload. The write endpoint is unauthenticated by design — the rate limit, not
a key, is what keeps it from being used as free storage.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests, build and the Playwright suite on every
push and pull request.

## License

MIT — see [LICENSE](LICENSE).
