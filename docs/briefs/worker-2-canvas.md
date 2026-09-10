# worker-2 — canvas (Phase 2 + M4/M5)

Plan sections: §3 Phase 2, M4 keyboard editing, M5 hover highlighting.

## Deliverables (`src/canvas/**`, export `Canvas` from `src/canvas/index.ts`)
1. `Canvas.tsx`: `<ReactFlowProvider>` + `<ReactFlow>` fed from the store. Nodes = tables (`type: 'table'`), position from `layout[tableId]` (default: auto-place unmatched tables with elkjs layered layout, or a simple grid fallback if elk is slow to wire up). Edges = refs (`type: 'ref'`), `source=fk table`, `sourceHandle=${tableId}:${columnId}`, target likewise. `onNodesChange` → `setTablePosition` on drag end. Controls, MiniMap, Background.
2. `TableNode.tsx`: header (name, note icon, header color), one `ColumnRow` per column: name, type, badges PK / FK / U / NN. Each row has `<Handle type="source" position={Right} id=…>` and `<Handle type="target" position={Left} id=…>` (same id both sides is fine with different `type`). Selected table shows a ring.
3. `RefEdge.tsx`: smoothstep/bezier edge with a small label for kind (`1..*`, `1..1`, `*..*`), click selects ref; a floating mini toolbar for selected edge: kind select, on_delete select, delete.
4. `onConnect`: build a `Ref` (`kind: '>'`, fk on source) via `update('canvas', …)`. `isValidConnection`: reject same column, same table+column pair already linked, and target/source that is not a single column. If the fk column type differs from the target pk type, still allow but add a `canvas` diagnostic warning.
5. `Toolbar.tsx`: Add table (creates `newTable({name: 'table_N', columns:[newIdColumn()]})` at viewport centre → `setTablePosition`), Auto-layout (elkjs `layered`, direction RIGHT, node sizes from DOM measurements), Fit view, Undo/Redo (`undo()`/`redo()` from store), Delete selected. Shortcuts: `Ctrl+Shift+T` add table, `Ctrl+Z`/`Ctrl+Shift+Z`, `Delete`, `F2` rename, `Escape` clear selection.
6. `Inspector.tsx` (right side of the canvas as an overlay panel when something is selected): table name, note, class name (`table.django.className`), header color; column list with drag-reorder and per-row name / type combobox (autocomplete over `int bigint smallint varchar(255) text boolean timestamp timestamptz date time decimal(10,2) float double uuid json jsonb` + enum names) / pk / unique / not null / increment / default / note; add / remove column; delete table. **Keyboard (M4):** `Enter` on last column adds a row and focuses its name; `Tab`/`Shift+Tab` cycle name → type → flags → next row; `Escape` blurs; `Delete` on an empty new row removes it.
7. **M5 highlight:** hovering a node or edge sets `setHighlight(connected table ids)` and adds `highlighted`/`dimmed` classes (others fade to 30 %); click keeps it; `Escape` clears; double-click a node zooms to it + neighbours.
8. All edits go through `update('canvas', draft => …)`. Never touch `dbmlText`/`djangoText`.

## Done when (Playwright `tests/e2e/canvas.spec.ts`, using data-testids you add)
- Add table → node appears; add column → row appears; drag handle A→B → edge appears and `useSchemaStore.getState().schema.refs.length === 1` (expose store on `window.__erd` in dev/test builds — coordinate with worker-6 or do it in `Canvas.tsx` guarded by `import.meta.env.DEV || import.meta.env.MODE === 'test'`).
- Change type in inspector → row updates; reload → positions preserved (worker-6 persists layout; until then assert store).
- Undo reverts the last patch.
- Keyboard-only: after clicking "Add table", create 3 columns without the mouse → 3 columns in the schema.
- Hover a table → exactly its connected edges/nodes get `highlighted`.
- Unit tests for pure helpers (`elk layout adapter`, `connection validation`) in `src/canvas/*.test.ts`.
Until `parseDbml` lands you can load `src/examples/blog.dbml` through a temporary hand-built Schema in a test fixture — do not block on worker-1.
