import { describe, it, expect, beforeEach } from 'vitest'
import { matchLashingCarryover } from './placementCarryover'
import { useCalculator } from './calculator'

// Audit 2026-11-09: matchLashingCarryover returning nothing at all passed
// every test — the lashing points of a repacked plan were never checked.

const at = (id: string, itemId: string, x: number, y: number) => ({ id, itemId, x, y })

describe('matchLashingCarryover', () => {
  beforeEach(() => {
    useCalculator.setState({
      deck: {
        ...useCalculator.getState().deck,
        lashingPoints: [
          { id: 'p1', x: 0.5, y: 0.5, placementId: 'old-a', cornerX: 1, cornerY: 1, mslKg: 4000 },
          { id: 'p2', x: 9, y: 9, placementId: 'old-b', cornerX: 8, cornerY: 8, mslKg: 4000 },
          { id: 'loose', x: 5, y: 5 },
        ],
      },
    })
  })

  it('carries nothing when no old placement has a lashing point', () => {
    useCalculator.setState({ deck: { ...useCalculator.getState().deck, lashingPoints: [{ id: 'loose', x: 5, y: 5 }] } })
    expect(matchLashingCarryover([at('old-a', 'box', 1, 1)], [at('new-1', 'box', 2, 2)])).toEqual([])
  })

  it('takes each secured placement to the nearest new one of the same cargo, with how far it moved', () => {
    const old = [at('old-a', 'box', 1, 1), at('old-b', 'crate', 8, 8), at('old-c', 'box', 4, 4)]
    const fresh = [at('new-far', 'box', 9, 1), at('new-near', 'box', 2, 1), at('new-crate', 'crate', 7, 9)]
    expect(matchLashingCarryover(old, fresh)).toEqual([
      { oldId: 'old-a', newId: 'new-near', dx: 1, dy: 0 },
      { oldId: 'old-b', newId: 'new-crate', dx: -1, dy: 1 },
    ])
  })

  it('never takes another cargo\'s placement, and gives each new one to one old one only', () => {
    useCalculator.setState({
      deck: {
        ...useCalculator.getState().deck,
        lashingPoints: [
          { id: 'p1', x: 0, y: 0, placementId: 'old-a', cornerX: 1, cornerY: 1, mslKg: 4000 },
          { id: 'p2', x: 0, y: 3, placementId: 'old-b', cornerX: 1, cornerY: 3, mslKg: 4000 },
        ],
      },
    })
    const old = [at('old-a', 'box', 1, 1), at('old-b', 'box', 1, 3)]
    // One box left, and a crate right where the second box stood.
    const fresh = [at('new-box', 'box', 1, 2), at('new-crate', 'crate', 1, 3)]
    expect(matchLashingCarryover(old, fresh)).toEqual([{ oldId: 'old-a', newId: 'new-box', dx: 0, dy: 1 }])
  })

  it('moves the points with their cargo, corner and deck point alike, once remapped', () => {
    const matches = matchLashingCarryover([at('old-a', 'box', 1, 1)], [at('new-1', 'box', 3, 2)])
    // As the callers do: the new placements first, then the points.
    useCalculator.setState({
      manualPlacements: [{ id: 'new-1', itemId: 'box', name: 'box', x: 3, y: 2, width: 1, length: 1, layers: 1, rotated: false, color: '#000' }],
      pinnedPlacementsByTrip: {},
    })
    useCalculator.getState().remapLashingPointsForRedistribute(matches)
    const points = useCalculator.getState().deck.lashingPoints!
    expect(points.find((p) => p.id === 'p1')).toMatchObject({ placementId: 'new-1', x: 2.5, y: 1.5, cornerX: 3, cornerY: 2 })
    // A loose point stays as it is; one whose cargo is gone goes with it.
    expect(points.find((p) => p.id === 'loose')).toMatchObject({ x: 5, y: 5 })
    expect(points.find((p) => p.id === 'p2')).toBeUndefined()
  })
})
