import { describe, expect, it } from 'vitest'
import { keptByVariants } from './variantKeep'

// Stage 4, group A (spec 8.2): what «Подобрать варианты» leaves in place.

describe('keptByVariants', () => {
  it('keeps a locked stack and re-arranges an unlocked one', () => {
    const kept = keptByVariants([{ id: 'a', locked: true }, { id: 'b' }], [])
    expect(kept.map((p) => p.id)).toEqual(['a'])
  })

  it('keeps a stack with a clearance zone or lashing points, locked or not', () => {
    const placements = [{ id: 'zone', clearanceMargin: { top: 1, right: 0, bottom: 0, left: 0 } }, { id: 'lashed' }, { id: 'free' }]
    const kept = keptByVariants(placements, [{ placementId: 'lashed' }, {}])
    expect(kept.map((p) => p.id)).toEqual(['zone', 'lashed'])
  })

  it('leaves out a quarantined record: it isn\'t on the deck', () => {
    expect(keptByVariants([{ id: 'q', locked: true, malformed: true }], [])).toEqual([])
    // Repaired from its composition, it stands again.
    expect(keptByVariants([{ id: 'r', locked: true, malformed: true, composition: [] }], []).map((p) => p.id)).toEqual(['r'])
  })
})
