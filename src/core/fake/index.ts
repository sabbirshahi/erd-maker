import type { Schema } from '../schema'

export interface FakeTable {
  tableId: string
  /** SQL table name (schema-qualified if needed). */
  name: string
  columns: string[]
  rows: unknown[][]
}

export interface FakeDataset {
  /** Tables in FK-safe insert order (parents first). */
  tables: FakeTable[]
  seed: number
}

/**
 * Seeded fake rows for every table honouring FK order, uniqueness, not-null, enums, and
 * column-name heuristics (email, *name*, price|amount, *_at, url, phone...).
 * OWNER: worker-5 (demo). Stub.
 */
export async function generateFakeData(schema: Schema, rowsPerTable: number, seed = 42): Promise<FakeDataset> {
  void schema; void rowsPerTable
  return { tables: [], seed }
}
