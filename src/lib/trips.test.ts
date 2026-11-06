import { describe, it, expect } from 'vitest'
import { computeTrips, separationRulesInUnit, shownTripsOf, tripsOfProject } from './trips'
import type { CargoItem } from './packing'
import type { DeckConfig } from '@/store/calculator'

// The trips worked out from a calculation alone — the open one's and a
// saved one's (spec 2026-11-06, 13).

const deck: DeckConfig = { width: 6, length: 6, unit: 'm', gap: 0, boardOffset: 0, clearance: 0 }
const box = (over: Partial<CargoItem> = {}): CargoItem => ({ id: 'box', name: 'Ящик', width: 2, length: 2, height: 1, quantity: 12, color: '#000', allowRotation: false, weight: 1_000, ...over })
const input = { mode: 'auto' as const, deck, manualPlacements: [], pinnedPlacementsByTrip: {}, sortStrategy: 'area-desc' as const, globalRotation: false, separationRulesInUnit: [] }

describe('trips', () => {
  it('keeps separation distances in metres and gives them in the deck\'s unit', () => {
    expect(separationRulesInUnit([{ id: 'r', categoryA: 'a', categoryB: 'b', minDistance: 3 }], 'cm')[0].minDistance).toBe(300)
  })

  it('spills what one deck can\'t take into more trips', () => {
    expect(computeTrips({ ...input, items: [box()] }).map((t) => t.placedCount)).toEqual([9, 3])
  })

  it('doesn\'t show the empty trip the packing stops on', () => {
    const trips = computeTrips({ ...input, items: [box({ quantity: 1 }), box({ id: 'big', width: 10, length: 10, quantity: 1 })] })
    expect(trips.length).toBe(2)
    const { shownTrips, hasEmptyTrailingTrip } = shownTripsOf(trips, 'auto', {})
    expect(hasEmptyTrailingTrip).toBe(true)
    expect(shownTrips.length).toBe(1)
  })

  it('works out a saved calculation\'s trips as its screen shows them', () => {
    const shown = tripsOfProject({ ...input, items: [box({ quantity: 1 }), box({ id: 'big', width: 10, length: 10, quantity: 1 })], separationRules: [] })
    expect(shown.map((t) => t.placedCount)).toEqual([1])
  })
})
