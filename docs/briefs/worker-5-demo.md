# worker-5 — demo mode (Phase 5)

Plan sections: §3 Phase 5, decisions D9, D10, D19; risk table rows on Pyodide.

## Day-1 spike (do this first, report result to leader via mailbox)
In `src/demo/pyodide.worker.ts` (Vite worker, `new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' })`):
`import { loadPyodide } from 'pyodide'`? — prefer loading from CDN to keep the bundle small: `importScripts` is not available in module workers, so use `const { loadPyodide } = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/pyodide/v<VER>/full/pyodide.mjs')` with `indexURL` set to the same folder. Pin `<VER>` to the current release (check `https://cdn.jsdelivr.net/pyodide/` — npm `pyodide` latest is 314.0.6, i.e. Python 3.14). Then `await pyodide.loadPackage('micropip')`, `micropip.install('django')` (latest Django requires Python ≥ 3.12 — fine; if the wheel fails on 3.14, pin `django==5.2.*`). Bootstrap (`public/py/bootstrap.py`, fetched as text and run):
```python
import django, os, sys, types
from django.conf import settings
settings.configure(DEBUG=True, SECRET_KEY='demo', USE_TZ=True, INSTALLED_APPS=[], DEFAULT_AUTO_FIELD='django.db.models.AutoField',
    DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}})
django.setup()
```
Rebuild (`build(models_py, rows)`): write `/app/demo_v{n}/__init__.py`, `/app/demo_v{n}/models.py` (with `app_label = 'demo_v{n}'` injected into each `Meta` — or set `default_app_config`), `sys.path.insert(0, '/app')`, `from django.apps import apps; apps.set_installed_apps(['demo_v{n}'])`, close the connection to get a fresh `:memory:` DB (`from django.db import connection; connection.close()`), then `with connection.schema_editor() as se: for m in apps.get_app_config('demo_v{n}').get_models(): se.create_model(m)` in `topologicalTables` order (pass order from JS). Prove a second rebuild (`demo_v2`) works with a changed schema. If `set_installed_apps` misbehaves, fall back to terminating and recreating the worker per rebuild (D10). Record boot time and both approaches in the mailbox report.

## Deliverables
1. `src/core/fake/index.ts`: `generateFakeData(schema, rowsPerTable, seed)` with `@faker-js/faker` (`import { faker } from '@faker-js/faker/locale/en'`, `faker.seed(seed)`), tables in `topologicalTables` order, FK values drawn from already generated parent pks, unique columns deduped, enums from `schema.enums`, not-null honoured, pk `increment` → 1..N, heuristics by column name (`email`, `first_name/last_name/name/username/title`, `price|amount|total` → decimal, `*_at|*_date` → dates, `url`, `phone`, `description|body|content` → paragraphs, `is_*|*_flag` → boolean, `status` → enum/choice). `<>` refs → also produce join rows for the implicit M2M table Django creates (`{app}_{model}_{field}` — ask the worker for the actual `db_table` of the M2M through model and insert there).
2. `src/demo/client.ts`: typed message protocol `boot | build | sql | orm | reset | status` with progress events `{ stage: 'download'|'install'|'bootstrap'|'tables'|'seed'|'ready', pct?, message }` and results `{ columns, rows, rowcount, sql?, stdout?, error? }`. Promise-based request/response with ids.
3. `public/py/runtime.py`: `run_sql(query)` via `connection.cursor()` (returns columns/rows, or rowcount for non-SELECT); `run_orm(code)` executes in a namespace with all models + `Q, F, Count, Sum, Avg, Max, Min, Prefetch, timezone`; evaluate the last statement if it is an expression: `QuerySet` → `list(qs.values())` (cap 1000) + `str(qs.query)`; model instance → `model_to_dict`; list of instances → list of dicts; else `repr`. Capture stdout via `contextlib.redirect_stdout`; tracebacks → `error`. JSON-safe conversion (Decimal/datetime/UUID → str).
4. `src/demo/DemoPanel.tsx` (export `DemoPanel` from `src/demo/index.ts`): "Start demo (≈15 MB, first time only)" button → progress bar with stage text; seed controls (rows per table 5–200 slider, seed input, Regenerate, Reset); tabs **SQL** (CodeMirror SQL-ish textarea is fine, Ctrl+Enter runs) and **ORM** (python editor — reuse `@/editors` `CodeMirrorEditor` if present, else a textarea) with a snippet dropdown (`Model.objects.all()`, `.filter(...)`, `.annotate(Count(...))`, `.select_related`); results grid (virtualised over 500 rows — simple windowing is fine); "Generated SQL" block with `CopyButton`. Banner "Schema changed — Rebuild" when `store.version` advances past the version last built. Detect mobile/iOS → show "Demo needs a desktop browser".
5. Uses `generateDjango(schema).text` (worker-4; while stub, use a hand-written models.py fixture to develop).

## Done when (Playwright `tests/e2e/demo.spec.ts`, chromium; mark `test.slow()`)
- Start demo → status reaches Ready ≤ 60 s; `SELECT count(*) FROM users` equals the slider value; `User.objects.filter(email__contains='@').count()` returns an int and shows SQL; bad Python shows the traceback and the panel keeps working; rebuild after a schema change succeeds twice in a row; `PRAGMA foreign_key_check` returns no rows (assert in test via SQL tab).
- `tests/unit/fake.test.ts`: deterministic for a seed; FK values reference existing parents; unique columns unique; row counts match.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; demo chunks are lazy (`import('./DemoPanel')` from the shell — export a `lazy` wrapper too).
