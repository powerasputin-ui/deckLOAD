import { beforeEach, describe, expect, it } from 'vitest'
import { clearCalculatorHistory, undoCalculator, useCalculator } from './calculator'
import type { CargoItem, ManualPlacement, PinnedPlacement } from '@/lib/packing'

// «Убрать» / «Открепить» on a cargo's row (spec 7.1, revision 2026-11-05).
const cargo = (id: string, quantity: number, weight: number): CargoItem => ({
  id, name: id, width: 1, length: 1, height: 1, quantity, color: '#000', allowRotation: true, weight,
})
const stack = (id: string, itemId: string, layers: number, extra: Partial<ManualPlacement> = {}): ManualPlacement => ({
  id, itemId, name: itemId, x: 0, y: 0, width: 1, length: 1, layers, rotated: false, color: '#000', ...extra,
})
const pin = (id: string, itemId: string, layers: number, locked: boolean): PinnedPlacement => ({
  ...stack(id, itemId, layers), ...(locked ? { locked: true } : {}),
})

const initial = useCalculator.getState()
const state = () => useCalculator.getState()

describe('taking a cargo off the deck', () => {
  beforeEach(() => {
    useCalculator.setState({ ...initial, items: [cargo('a', 5, 100), cargo('b', 3, 200)], manualPlacements: [], pinnedPlacementsByTrip: {}, selectedManualIds: [], selectedPinIds: [] })
    clearCalculatorHistory()
  })

  it('in manual mode takes every unit of it off: a mixed stack keeps its other cargo, its lashing points go', () => {
    useCalculator.setState({
      mode: 'manual',
      manualPlacements: [
        stack('m1', 'a', 2),
        stack('m2', 'b', 1),
        stack('m3', 'a', 5, { composition: [{ itemId: 'a', layers: 2 }, { itemId: 'b', layers: 3 }] }),
      ],
      selectedManualIds: ['m1', 'm2'],
      deck: { ...initial.deck, lashingPoints: [{ id: 'l1', x: 0, y: 0, placementId: 'm1' }, { id: 'l2', x: 0, y: 0, placementId: 'm2' }] } as typeof initial.deck,
    })
    expect(state().takeOffDeck('a')).toBe(4)
    const left = state().manualPlacements
    expect(left.map((p) => [p.id, p.itemId, p.layers, p.composition])).toEqual([
      ['m2', 'b', 1, undefined],
      ['m3', 'b', 3, undefined],
    ])
    expect(state().selectedManualIds).toEqual(['m2'])
    expect(state().deck.lashingPoints?.map((p) => p.id)).toEqual(['l2'])
    expect(state().items.map((it) => it.quantity)).toEqual([5, 3])
    // Nothing of it on the deck: nothing to take off.
    expect(state().takeOffDeck('a')).toBe(0)
  })

  it('in auto mode releases only the stacks the user pinned, on every trip; the packer\'s own stay', () => {
    useCalculator.setState({
      mode: 'auto',
      pinnedPlacementsByTrip: { 0: [pin('p1', 'a', 1, true), pin('p2', 'a', 2, false)], 1: [pin('p3', 'a', 1, true), pin('p4', 'b', 1, true)] },
    })
    expect(state().takeOffDeck('a')).toBe(2)
    const pins = state().pinnedPlacementsByTrip
    expect(pins[0].map((p) => p.id)).toEqual(['p2'])
    expect(pins[1].map((p) => p.id)).toEqual(['p4'])
  })

  it('comes back with an undo', () => {
    useCalculator.setState({ mode: 'manual', manualPlacements: [stack('m1', 'a', 2)] })
    clearCalculatorHistory()
    state().takeOffDeck('a')
    expect(state().manualPlacements).toEqual([])
    undoCalculator()
    expect(state().manualPlacements.map((p) => p.id)).toEqual(['m1'])
  })
})
