# worker-3 — editors (Phase 3 + M1/M2 UI + M8)

Plan sections: §3 Phase 3, §2 sync rules, M1/M2 dialogs, M8 copy buttons.

## Deliverables (`src/editors/**`, export from `src/editors/index.ts`)
1. `CodeMirrorEditor.tsx`: thin React wrapper around CodeMirror 6 (`EditorState`, `EditorView`, basicSetup pieces from `codemirror`, `@codemirror/lint` `linter()`/`setDiagnostics`, `@codemirror/lang-python`). Props: `value`, `onChange(text)`, `extensions`, `diagnostics`, `onFocus/onBlur`, `readOnly`.
2. `dbml-language.ts`: `StreamLanguage.define` tokenizer for DBML — keywords `Table Ref Enum indexes Indexes Note Project TableGroup as`, settings in `[...]`, types, strings ('…', "…", '''…'''), backtick expressions, `//` and `/* */` comments, relation symbols `> < - <>`. Plus an autocompletion source for keywords and known table/column names from the store.
3. `DbmlEditor.tsx`: shows `dbmlText ?? generateDbml(schema)`. On change: debounce 300 ms → `parseDbml` → if no errors: `reconcile(store.schema, parsed)` → `commit('dbml', schema, { dbmlText: text })`; always `setDiagnostics('dbml', diags)` and paint them in the gutter. Subscribe to the store: when `version` changes and `origin !== 'dbml'` and `focus !== 'dbml'`, replace the document with `generateDbml(schema)` **preserving scroll and, when possible, cursor**. `onFocus → setFocus('dbml')`, `onBlur → setFocus(null)` + flush pending parse.
4. `DjangoEditor.tsx`: same pattern with `generateDjango(schema).text`, `parseDjango(text)` (async; call `initDjangoParser()` on first focus), `commit('django', …, { djangoText })`, diagnostics source `'django'`. Show the generator's diagnostics too (`setDiagnostics('typemap', …)`). Read-only toggle button (default editable once parseDjango is real; while `parseDjango` returns the stub error, show a "read-only until parser lands" badge — detect via a diagnostic message containing 'not implemented').
5. `ImportDialog.tsx` (M1): tabs "DBML" / "SQL" / "Django models.py"; paste area + file drop (`.dbml`, `.sql`, `.py`); dialect select for SQL (auto/postgres/mysql/mssql). Uses `importSql` → `parseDbml` → `commit('import', …)`; Django tab uses `parseDjango`. Errors shown inline with the failing line. After import, tables without layout are auto-placed (call a helper exported by worker-2 if available: `import('@/canvas').then(m => m.autoLayout?.())` — optional).
6. `ExportDialog.tsx` (M2): DBML / Postgres / MySQL / SQLite / Django models.py / JSON `{schema, layout}`; read-only CodeMirror preview; `CopyButton` (from `@/app/CopyButton` — if not yet present, implement a local copy button and swap later) + Download.
7. Every pane has a `CopyButton` with toast "Copied DBML" / "Copied models.py" (M8).

## Done when (Playwright `tests/e2e/editors.spec.ts`)
- Typing a `Table x { id int [pk] }` in the DBML editor shows a node within 500 ms.
- Adding a column via the inspector updates the DBML text; the DBML editor's caret does not move when it is unfocused and the change came from the canvas.
- A syntax error shows a lint marker on the right line and the canvas is unchanged; fixing it resyncs.
- Import SQL fixture (`tests/fixtures/sql/ecommerce.postgres.sql`) → tables appear; Export Postgres → text contains `CREATE TABLE`.
- Copy writes the pane text to the clipboard (Playwright clipboard permission is configured).
- Unit tests for `dbml-language.ts` tokenization and the debounced sync hook (`src/editors/*.test.ts`).
While `parseDbml`/`generateDbml` are stubs, build against the stub signatures; they land within the first hour from worker-1.
