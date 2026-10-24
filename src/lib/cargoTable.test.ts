import { describe, it, expect } from 'vitest'
import { cargoTotals, placedByItem, rangeOf } from './cargoTable'
import type { CargoItem, PlacedItem } from './packing'

// Stage 3, group A: what the cargo table shows besides each cargo's own
// fields (spec 7.4).

const placed = (itemId: string, layers: number, composition?: PlacedItem['composition']): PlacedItem =>
  ({ itemId, name: itemId, x: 0, y: 0, width: 1, length: 1, layers, stackedCount: layers, rotated: false, color: '#000', composition }) as PlacedItem

const item = (over: Partial<CargoItem>): CargoItem => ({
  id: 'a',
  name: 'A',
  width: 2,
  length: 3,
  height: 1,
  quantity: 1,
  color: '#000',
  allowRotation: true,
  ...over,
})

describe('placedByItem', () => {
  it('counts every unit and stack of a cargo, a mixed stack once for each cargo in it', () => {
    const counts = placedByItem([placed('a', 2), placed('a', 1), placed('b', 3, [{ itemId: 'b', layers: 1 }, { itemId: 'a', layers: 2 }])])
    expect(counts.get('a')).toEqual({ units: 5, stacks: 3 })
    expect(counts.get('b')).toEqual({ units: 1, stacks: 1 })
    expect(counts.get('c')).toBeUndefined()
  })
})

describe('cargoTotals', () => {
  it('adds the units, the weight of the weighed cargo and the footprint of every unit', () => {
    const totals = cargoTotals([item({ quantity: 4, weight: 2000 }), item({ id: 'b', quantity: 2, width: 1, length: 1 })])
    expect(totals).toEqual({ units: 6, weightKg: 8000, unweighed: 1, area: 4 * 6 + 2 * 1 })
  })
})

describe('rangeOf', () => {
  const ids = ['a', 'b', 'c', 'd']
  it('runs from the row clicked last to this one, either way', () => {
    expect(rangeOf(ids, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeOf(ids, 'd', 'a')).toEqual(['a', 'b', 'c', 'd'])
    expect(rangeOf(ids, 'x', 'c')).toEqual(['c'])
  })
})
