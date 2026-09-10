/**
 * Handle ids encode `${tableId}:${columnId}:${side}`. Every column row renders two
 * `source`-type handles (left and right); the canvas runs in "loose" connection mode
 * so a drag from any handle can end on any other handle, and the edge picks the side
 * facing the other table.
 */
export type HandleSide = 'L' | 'R'

export interface HandleRef {
  tableId: string
  columnId: string
  side: HandleSide
}

export const handleId = (tableId: string, columnId: string, side: HandleSide): string =>
  `${tableId}:${columnId}:${side}`

export function parseHandleId(id: string | null | undefined): HandleRef | null {
  if (!id) return null
  const parts = id.split(':')
  if (parts.length !== 3) return null
  const [tableId, columnId, side] = parts
  if (!tableId || !columnId || (side !== 'L' && side !== 'R')) return null
  return { tableId, columnId, side }
}
