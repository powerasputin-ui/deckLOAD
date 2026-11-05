import { describe, expect, it } from 'vitest'
import { ownUnitsOfItem, unitsOfItemIn } from './ownPlacements'

// Spec 7.1, revision 2026-11-05: what «Убрать» / «Открепить» on a cargo's
// row would take off the deck.
const plain = (itemId: string, layers: number, extra: object = {}) => ({ itemId, layers, ...extra })

describe('the units of a cargo the user stood on the deck', () => {
  it('counts a mixed stack by its own segments, a plain stack at least one unit', () => {
    const list = [plain('a', 2), plain('b', 1), { itemId: 'a', layers: 5, composition: [{ itemId: 'a', layers: 2 }, { itemId: 'b', layers: 3 }] }, plain('a', 0)]
    expect(unitsOfItemIn(list, 'a')).toBe(5)
    expect(unitsOfItemIn(list, 'b')).toBe(4)
  })

  it('leaves out a record quarantined as malformed', () => {
    expect(unitsOfItemIn([plain('a', 3, { malformed: { reason: 'x' } }), plain('a', 1)], 'a')).toBe(1)
  })

  it('in manual mode is every placement of it; in auto only the pinned stacks the user locked, on every trip', () => {
    const manual = [plain('a', 2)]
    const pins = { 0: [plain('a', 1, { locked: true }), plain('a', 4)], 1: [plain('a', 2, { locked: true })] }
    expect(ownUnitsOfItem('a', 'manual', manual, pins)).toBe(2)
    expect(ownUnitsOfItem('a', 'auto', manual, pins)).toBe(3)
    expect(ownUnitsOfItem('b', 'auto', manual, pins)).toBe(0)
  })
})
