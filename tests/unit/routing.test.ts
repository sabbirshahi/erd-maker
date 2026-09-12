import { describe, it, expect } from 'vitest'
import { freeChannelX, CHANNEL_PAD, MAX_DETOUR, type Rect } from '@/canvas/routing'

const card = (x: number, y: number, width = 200, height = 120): Rect => ({ x, y, width, height })

describe('freeChannelX', () => {
  it('leaves a clear midpoint alone', () => {
    expect(freeChannelX(0, 0, 400, 0, [])).toBeUndefined()
    // A card well above the line is not in the way.
    expect(freeChannelX(0, 500, 400, 500, [card(150, 0)])).toBeUndefined()
  })

  it('steps around a card sitting in the channel', () => {
    // Midpoint 200 lands inside a card spanning x 150..350.
    const x = freeChannelX(0, 0, 400, 300, [card(150, 0, 200, 400)])
    expect(x).toBeDefined()
    expect(x).toBeLessThan(150 - CHANNEL_PAD)
  })

  it('picks the nearer side of the blocking card', () => {
    // Midpoint 200; the card's left edge (120) is closer than its right edge (300).
    const x = freeChannelX(0, 0, 400, 300, [card(120, 0, 160, 400)])
    expect(x).toBeLessThan(120)
  })

  it('keeps the straight line when every detour is too far', () => {
    const wall = card(-MAX_DETOUR * 2, -1000, MAX_DETOUR * 4, 2000)
    expect(freeChannelX(0, 0, 400, 300, [wall])).toBeUndefined()
  })
})
