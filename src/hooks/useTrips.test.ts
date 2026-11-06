import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTrips } from './useTrips'
import { useCalculator } from '@/store/calculator'
import type { CargoItem, PinnedPlacement } from '@/lib/packing'

// Spec 2026-11-06, 6: a platform doesn't sail with its cargo — its deck is
// one, after the supply run; what leaves with the vessel isn't on it.

const deck = { ...useCalculator.getState().deck, width: 8, length: 20, unit: 'm' as const, gap: 0, boardOffset: 0, clearance: 0, outline: undefined, restrictionZones: [], loadZones: [] }
// 4 × 5 m: four to a deck of 8 × 20 m.
const block = (over: Partial<CargoItem> = {}): CargoItem => ({ id: 'a', name: 'Блок', width: 4, length: 10, height: 1, quantity: 6, color: '#000', allowRotation: false, weight: 1000, ...over })

const trips = (d: typeof deck, items: CargoItem[], pins: Record<number, PinnedPlacement[]> = {}) =>
  renderHook(() =>
    useTrips({ mode: 'auto', deck: d, items, manualPlacements: [], pinnedPlacementsByTrip: pins, sortStrategy: 'area-desc', globalRotation: false, separationRulesInUnit: [] })
  ).result.current

describe('useTrips on a platform', () => {
  it('a vessel takes what doesn\'t fit on another trip; a platform leaves it unplaced', () => {
    expect(trips(deck, [block()]).shownTrips).toHaveLength(2)
    const platform = trips({ ...deck, objectKind: 'fixed' }, [block()])
    expect(platform.shownTrips).toHaveLength(1)
    expect(platform.lastTrip.placedCount).toBe(4)
    expect(platform.lastTrip.requestedCount - platform.lastTrip.placedCount).toBe(2)
  })

  it('cargo leaving with the vessel isn\'t on the deck, nor its pinned stacks', () => {
    const leaving = block({ id: 'b', name: 'Отгрузка', quantity: 1, platformStatus: 'outgoing' })
    const pin = { id: 'pin-b', itemId: 'b', x: 0, y: 0, width: 4, length: 10, layers: 1 } as unknown as PinnedPlacement
    const r = trips({ ...deck, objectKind: 'semi-sub' }, [block({ quantity: 2 }), leaving], { 0: [pin] })
    expect(r.result.placed.map((p) => p.itemId)).toEqual(['a', 'a'])
    expect(r.result.requestedCount).toBe(2)
  })
})
