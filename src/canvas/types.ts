import type { Edge, Node } from '@xyflow/react'

export type TableNodeType = Node<{ tableId: string }, 'table'>
export type RefEdgeType = Edge<{ refId: string }, 'ref'>

/** DBML types offered by the inspector's type combobox (enum names are appended at runtime). */
export const TYPE_SUGGESTIONS: readonly string[] = [
  'int',
  'bigint',
  'smallint',
  'varchar(255)',
  'text',
  'boolean',
  'timestamp',
  'timestamptz',
  'date',
  'time',
  'decimal(10,2)',
  'float',
  'double',
  'uuid',
  'json',
  'jsonb',
]

export const REF_ACTIONS = ['cascade', 'restrict', 'set null', 'set default', 'no action'] as const
