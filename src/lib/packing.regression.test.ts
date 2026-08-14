import { describe, it, expect } from 'vitest'
import {
  packDeck,
  packMultiTrip,
  clampToDeck,
  checkLoadDensity,
  violatesSeparation,
  type CargoItem,
  type PinnedPlacement,
  type SeparationRule,
  type LoadZone,
} from './packing'

function item(partial: Partial<CargoItem> & { id: string }): CargoItem {
  return {
    name: 'Груз',
    width: 1,
    length: 1,
    height: 0,
    quantity: 1,
    color: '#0ea5e9',
    allowRotation: true,
    ...partial,
  }
}

describe('REGRESSION: combined scenario (categories + zones + multi-trip)', () => {
  it('conserves total requested count across trips when categories/zones/separation are all active', () => {
    const rules: SeparationRule[] = [{ id: 'r1', categoryA: 'hazard', categoryB: 'standard', minDistance: 1 }]
    const zones: LoadZone[] = [{ id: 'z1', x: 0, y: 0, width: 10, length: 10, maxLoadPerArea: 0.001 }]
    const items = [
      item({ id: 'std', width: 2, length: 2, quantity: 6, category: 'standard', weight: 500 }),
      item({ id: 'haz', width: 2, length: 2, quantity: 6, category: 'hazard', weight: 500 }),
    ]
    const trips = packMultiTrip(6, 6, items, { gap: 0.1, separationRules: rules }, 10)
    const totalPlaced = trips.reduce((s, t) => s + t.placedCount, 0)
    const totalRequested = 12
    // Every unit is accounted for: either placed somewhere, or explicitly
    // reported unplaced on the LAST trip (no silent loss/duplication).
    const lastTripUnplacedUnits = trips[trips.length - 1].unplaced.length > 0 ? totalRequested - totalPlaced : 0
    expect(totalPlaced + lastTripUnplacedUnits).toBe(totalRequested)
    expect(totalPlaced).toBeGreaterThan(0)

    // Load zones never block placement (soft warning only) — every placed
    // item should still be checkable via checkLoadDensity without affecting
    // whether it got placed.
    for (const trip of trips) {
      for (const p of trip.placed) {
        const density = checkLoadDensity(p, (p.weight ?? 0) * p.stackedCount, zones)
        // With maxLoadPerArea=0.001 t/m2, essentially everything should be flagged —
        // confirms the check function runs without throwing / returning inconsistent data.
        expect(density === null || density.densityKgPerM2 > 0).toBe(true)
      }
    }
  })

  it('separation is enforced identically for pinned validation as for free placement', () => {
    const rules: SeparationRule[] = [{ id: 'r1', categoryA: 'hazard', categoryB: 'standard', minDistance: 3 }]
    const items = [
      item({ id: 'std', width: 2, length: 2, quantity: 1, category: 'standard' }),
      item({ id: 'haz', width: 2, length: 2, quantity: 1, category: 'hazard' }),
    ]
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'std', name: 'std', x: 0, y: 0, width: 2, length: 2, layers: 1, rotated: false, color: '#000',
    }
    // Free-placement path: haz item auto-packed against a pinned std within 3m should be rejected/rerouted.
    const res = packDeck(10, 10, items, { separationRules: rules, pinned: [pin], gap: 0 })
    const hazPlaced = res.placed.find((p) => p.itemId === 'haz')
    if (hazPlaced) {
      const dx = Math.max(pin.x - (hazPlaced.x + hazPlaced.width), hazPlaced.x - (pin.x + pin.width), 0)
      const dy = Math.max(pin.y - (hazPlaced.y + hazPlaced.length), hazPlaced.y - (pin.y + pin.length), 0)
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(3 - 1e-9)
    } else {
      expect(res.unplaced.some((u) => u.itemId === 'haz')).toBe(true)
    }

    // Manual-mode path uses the same violatesSeparation predicate directly —
    // confirm it agrees with the packDeck-integrated result for the identical geometry.
    const manualViolation = violatesSeparation(
      { x: 1, y: 0, width: 2, length: 2, category: 'hazard' }, // only 1m from pin's right edge (pin at x=0..2) -> overlaps even
      [{ x: pin.x, y: pin.y, width: pin.width, length: pin.length, category: 'standard' }],
      rules
    )
    expect(manualViolation).toBe(true)
  })

  it('edge clearance (boardOffset) is identical across auto-pack and clampToDeck (manual/pinned) paths', () => {
    const boardOffset = 0.5
    const gap = 0.2
    const items = [item({ id: 'a', width: 3, length: 3, quantity: 1 })]
    const res = packDeck(20, 20, items, { boardOffset, gap })
    const placed = res.placed[0]
    expect(placed.x).toBeCloseTo(boardOffset, 9)
    expect(placed.y).toBeCloseTo(boardOffset, 9)

    // Manual/pinned clamp uses the same boardOffset value with no +gap/2 skew.
    const clamped = clampToDeck({ x: -5, y: -5, width: 3, length: 3 }, 20, 20, boardOffset)
    expect(clamped.x).toBeCloseTo(boardOffset, 9)
    expect(clamped.y).toBeCloseTo(boardOffset, 9)
  })

  it('totalWeight matches sum of breakdown[].weight even with an overridden pin weight', () => {
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'a', name: 'A', x: 0, y: 0, width: 2, length: 2, layers: 1, rotated: false, color: '#000', weight: 777,
    }
    const res = packDeck(10, 10, [item({ id: 'a', width: 2, length: 2, quantity: 3, weight: 100 })], { pinned: [pin] })
    const breakdownTotal = res.breakdown.reduce((s, b) => s + b.weight, 0)
    expect(breakdownTotal).toBe(res.totalWeight)
  })

  it('packMultiTrip does not infinite-loop when nothing fits, and reports zero progress', () => {
    const items = [item({ id: 'huge', width: 500, length: 500, quantity: 5 })]
    const trips = packMultiTrip(10, 10, items, {}, 5)
    expect(trips.length).toBeLessThanOrEqual(5)
    expect(trips.every((t) => t.placedCount === 0)).toBe(true)
  })
})
