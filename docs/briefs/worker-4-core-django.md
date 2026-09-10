# worker-4 — core-django (Phase 4a + 4b + M6 data)

Plan sections: §2 mapping table (authoritative), §3 Phase 4a, 4b, M6 diagnostics, decisions D7, D8, D12–D16.

## Deliverables (`src/core/django/**`)
1. `typemap.ts`: single bidirectional table `{ dbmlPattern: RegExp | string, toDjango(type, col) => { field, kwargs }, fromDjango(field, kwargs) => dbmlType, lossy?: string }` covering every row of plan §2. Export `DJANGO_TYPE_CHOICES` for the inspector combobox.
2. `generate.ts`: `generateDjango(schema)` → Django 5.2+ `models.py`:
   - header `from django.db import models`; `TextChoices` classes for enums (`class PostStatus(models.TextChoices): DRAFT = 'draft', 'Draft'`).
   - classes in `topologicalTables` order; class name = `table.django?.className ?? tableNameToClassName(table.name)`.
   - D14: `id int [pk, increment]` omitted (Django implicit); `bigint [pk, increment]` → `id = models.BigAutoField(primary_key=True)`; other pk → `primary_key=True`.
   - FK columns (from `schema.refs`, `fkSide`): `ForeignKey('Target', on_delete=models.CASCADE|PROTECT|SET_NULL|SET_DEFAULT|DO_NOTHING, db_column='user_id', related_name=…, to_field=… when target isn't the pk)`. Field name = column name minus trailing `_id` (keep `db_column`). `-` → `OneToOneField`. `<>` → `ManyToManyField('Target')` on the `from` model. Multi-column FK → error diagnostic and the plain column is emitted.
   - not null → `null=False` (default, omit); nullable → `null=True, blank=True`; `unique=True`; defaults: `` `now()` `` → `auto_now_add=True`, literals → `default=…` (python literal), other backtick expressions → `db_default=models.RawSQL?` NO — emit as comment + warning diagnostic.
   - `note` → `help_text`; table note → docstring; `Meta`: `db_table = 'name'` always, `indexes = [models.Index(fields=[...])]`, `constraints = [models.UniqueConstraint(fields=[...], name=...)]`, composite pk → `pk = models.CompositePrimaryKey('a', 'b')` (and an error diagnostic if any FK targets it), `ordering`, `verbose_name`.
   - `table.django.passthrough` re-emitted verbatim (indented) at end of class; `column.django.extraKwargs` appended; `column.django.fieldType` overrides the mapped field.
   - Diagnostics: every `lossy` mapping → `info` with `lossy: true`, `source: 'typemap'`, `tableId/columnId` set; unknown type → `warning` (falls back to `TextField`); multi-column FK / FK→composite pk → `error`.
3. `parse.ts` (4b): `initDjangoParser()` loads `web-tree-sitter` (`Parser.init({ locateFile: () => '/tree-sitter/tree-sitter.wasm' })`) + `/tree-sitter/tree-sitter-python.wasm` (copy both wasm files into `public/tree-sitter/` — get `tree-sitter-python.wasm` from the `tree-sitter-python` npm package (`pnpm add -D tree-sitter-python`) or build note; `tree-sitter.wasm` from `web-tree-sitter`). `parseDjango(text)` walks the CST: `class_definition` with base `models.Model` → table; `expression_statement`/`assignment` `name = models.X(args, kw=...)` → column via typemap; `ForeignKey/OneToOneField/ManyToManyField` → refs (resolve target by class name, string or identifier; `'self'` supported); `class Meta` → db_table/indexes/constraints/unique_together/ordering; `TextChoices` classes → enums; `CompositePrimaryKey` → pk index; models without an explicit pk get `newIdColumn()` (D14). Anything else in the class body → `passthrough` (verbatim source slice). Unknown kwargs → `extraKwargs`. Syntax errors (`node.hasError`) → error diagnostics with line/col and **no schema**.
4. `index.ts` re-exports; keep signatures.

## Done when
- `tests/golden/<fixture>.py` snapshots for `tests/fixtures/*.dbml` (worker-1 lands fixtures; until then use `src/examples/blog.dbml` and your own inline fixtures) — reviewed for `db_table`, `on_delete`, choices, constraints, composite pk.
- `tests/unit/django.generate.test.ts`: fixture with `timestamptz`, multi-column FK, unknown type yields exactly 3 diagnostics (info/error/warning).
- `tests/unit/django.parse.test.ts`: for every golden file, `parseDjango(generateDjango(s).text)` deep-equals `s` ignoring ids; a class with a method + custom manager round-trips via passthrough; `Python syntax error` → no schema + diagnostic.
- vitest runs in node/jsdom: load wasm from `node_modules`/`public` via `fs` in tests (locateFile override), so tests do not need a browser.
- Coverage ≥ 90 % on `src/core/django`. `pnpm typecheck && pnpm lint && pnpm test` green. Land `generateDjango` FIRST (worker-3/6 need it), then the parser.
