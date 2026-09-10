import { describe, it, expect } from 'vitest'
import {
  sanitizeCargoWidth,
  sanitizeCargoLength,
  sanitizeCargoHeight,
  sanitizeCargoQuantity,
  sanitizeCargoWeight,
  sanitizeCargoMaxLayers,
  sanitizeCargoMaxStackHeightM,
  wouldExceedDeckCapacity,
} from './cargoValidation'
import { normalizeProject } from '@/store/projects'
import { useCalculator } from '@/store/calculator'
import type { Project } from '@/store/projects'
import type { CompositionCatalogItem } from './placementComposition'

describe('sanitizeCargoWidth', () => {
  it('keeps a valid positive number', () => {
    expect(sanitizeCargoWidth(5)).toBe(5)
  })
  it('falls back on NaN/Infinity/negative/zero/non-number', () => {
    expect(sanitizeCargoWidth(NaN, 2)).toBe(2)
    expect(sanitizeCargoWidth(Infinity, 2)).toBe(2)
    expect(sanitizeCargoWidth(-1, 2)).toBe(2)
    expect(sanitizeCargoWidth(0, 2)).toBe(2)
    expect(sanitizeCargoWidth('5', 2)).toBe(2)
    expect(sanitizeCargoWidth(undefined, 2)).toBe(2)
  })
})

describe('sanitizeCargoLength', () => {
  it('keeps a valid positive number', () => {
    expect(sanitizeCargoLength(3.5)).toBe(3.5)
  })
  it('falls back on invalid input', () => {
    expect(sanitizeCargoLength(NaN, 1)).toBe(1)
    expect(sanitizeCargoLength(-4, 1)).toBe(1)
  })
})

describe('sanitizeCargoHeight', () => {
  it('keeps a valid non-negative number, including 0', () => {
    expect(sanitizeCargoHeight(0)).toBe(0)
    expect(sanitizeCargoHeight(2.2)).toBe(2.2)
  })
  it('falls back on NaN/Infinity/negative', () => {
    expect(sanitizeCargoHeight(NaN, 1)).toBe(1)
    expect(sanitizeCargoHeight(Infinity, 1)).toBe(1)
    expect(sanitizeCargoHeight(-1, 1)).toBe(1)
  })
})

describe('sanitizeCargoQuantity', () => {
  it('keeps a valid non-negative integer, including 0', () => {
    expect(sanitizeCargoQuantity(0, 5)).toBe(0)
    expect(sanitizeCargoQuantity(4, 5)).toBe(4)
  })
  it('rounds a fractional value', () => {
    expect(sanitizeCargoQuantity(3.7, 5)).toBe(4)
  })
  it('falls back on NaN/negative/non-number', () => {
    expect(sanitizeCargoQuantity(NaN, 5)).toBe(5)
    expect(sanitizeCargoQuantity(-2, 5)).toBe(5)
    expect(sanitizeCargoQuantity('3', 5)).toBe(5)
    expect(sanitizeCargoQuantity(undefined, 5)).toBe(5)
  })
})

describe('sanitizeCargoWeight', () => {
  it('keeps a valid non-negative number, including 0', () => {
    expect(sanitizeCargoWeight(0)).toBe(0)
    expect(sanitizeCargoWeight(12.5)).toBe(12.5)
  })
  it('returns undefined on invalid input', () => {
    expect(sanitizeCargoWeight(NaN)).toBeUndefined()
    expect(sanitizeCargoWeight(-1)).toBeUndefined()
    expect(sanitizeCargoWeight('5')).toBeUndefined()
    expect(sanitizeCargoWeight(undefined)).toBeUndefined()
  })
})

describe('sanitizeCargoMaxLayers', () => {
  it('keeps a valid positive integer, flooring fractions', () => {
    expect(sanitizeCargoMaxLayers(3)).toBe(3)
    expect(sanitizeCargoMaxLayers(3.9)).toBe(3)
  })
  it('returns undefined on invalid input (including 0)', () => {
    expect(sanitizeCargoMaxLayers(0)).toBeUndefined()
    expect(sanitizeCargoMaxLayers(-1)).toBeUndefined()
    expect(sanitizeCargoMaxLayers(NaN)).toBeUndefined()
    expect(sanitizeCargoMaxLayers(undefined)).toBeUndefined()
  })
  // Regression: `value > 0` used to be checked BEFORE flooring, so any
  // fraction strictly between 0 and 1 passed the check and then floored
  // down to a stored 0 — violating the function's own "positive integer or
  // undefined" contract silently.
  it('returns undefined for a fraction between 0 and 1 (does not floor to a stored 0)', () => {
    expect(sanitizeCargoMaxLayers(0.1)).toBeUndefined()
    expect(sanitizeCargoMaxLayers(0.9)).toBeUndefined()
    expect(sanitizeCargoMaxLayers(0.999)).toBeUndefined()
  })
  it('still floors a fraction >= 1 down to the integer part', () => {
    expect(sanitizeCargoMaxLayers(1.9)).toBe(1)
    expect(sanitizeCargoMaxLayers(2.1)).toBe(2)
  })
})

describe('sanitizeCargoMaxStackHeightM', () => {
  it('keeps a valid positive number', () => {
    expect(sanitizeCargoMaxStackHeightM(2.4)).toBe(2.4)
  })
  it('returns undefined on invalid input (including 0)', () => {
    expect(sanitizeCargoMaxStackHeightM(0)).toBeUndefined()
    expect(sanitizeCargoMaxStackHeightM(-1)).toBeUndefined()
    expect(sanitizeCargoMaxStackHeightM(NaN)).toBeUndefined()
  })
})

// This is the shared arithmetic behind maxDeckCargoT's hard limit (contract
// A: hard limit in both AUTO and MANUAL). Pulled out to a pure function
// specifically because the same check kept getting re-implemented inline in
// page.tsx call sites and some were simply forgotten (onPlace's AUTO
// branch, the preset branch in either mode, the pinned "+" layer button) —
// a bug class a page.tsx-only implementation can't be unit-tested against,
// since page.tsx has no test file of its own.
describe('wouldExceedDeckCapacity', () => {
  it('allows when under the limit', () => {
    expect(wouldExceedDeckCapacity([{ weight: 3000, layers: 1 }], 2000, 10)).toBe(false) // 3000+2000=5000 < 10000
  })
  it('blocks when the addition would push over the limit', () => {
    expect(wouldExceedDeckCapacity([{ weight: 9000, layers: 1 }], 2000, 10)).toBe(true) // 9000+2000=11000 > 10000
  })
  it('allows landing exactly on the limit (not strictly over)', () => {
    expect(wouldExceedDeckCapacity([{ weight: 8000, layers: 1 }], 2000, 10)).toBe(false) // exactly 10000
  })
  it('never blocks when maxDeckCargoT is undefined (no limit configured)', () => {
    expect(wouldExceedDeckCapacity([{ weight: 999999, layers: 1 }], 999999, undefined)).toBe(false)
  })
  it('multiplies each placement by its own layers, not a flat count', () => {
    // 3 placements: 2000*3 + 1000*1 + 500*2 = 6000+1000+1000 = 8000, +1000 new = 9000 < 10000
    const placements = [{ weight: 2000, layers: 3 }, { weight: 1000, layers: 1 }, { weight: 500, layers: 2 }]
    expect(wouldExceedDeckCapacity(placements, 1000, 10)).toBe(false)
    expect(wouldExceedDeckCapacity(placements, 2001, 10)).toBe(true) // 8000+2001=10001 > 10000
  })
  it('treats a missing weight as 0 and a missing/zero layers as 1', () => {
    expect(wouldExceedDeckCapacity([{ layers: 5 }], 0, 10)).toBe(false) // weight defaults to 0
    expect(wouldExceedDeckCapacity([{ weight: 9000 }], 500, 10)).toBe(false) // layers defaults to 1: 9000*1+500=9500
  })
  // Regression: `currentKg + NaN > maxKg` is `false` in JS — a NaN/Infinity/
  // negative addedWeightKg used to silently pass as "does not exceed",
  // defeating the point of a function documented as THE hard-limit check.
  it('treats invalid addedWeightKg as exceeding the limit, not as passing it', () => {
    expect(wouldExceedDeckCapacity([], NaN, 10)).toBe(true)
    expect(wouldExceedDeckCapacity([], Infinity, 10)).toBe(true)
    expect(wouldExceedDeckCapacity([], -1, 10)).toBe(true)
  })
  it('treats invalid maxDeckCargoT (but not undefined) as exceeding the limit', () => {
    expect(wouldExceedDeckCapacity([], 100, NaN)).toBe(true)
    expect(wouldExceedDeckCapacity([], 100, -5)).toBe(true)
  })

  // Round 17 (capacity verification). Found via the review's own
  // investigate-first scenario 6: a composed placement's top-level
  // `weight`/`layers` are only a backward-compatible AVERAGE fallback (see
  // PlacedItem.composition's doc comment) — nothing keeps them in sync for
  // a hand-built or merge-produced composed placement outside the one path
  // (Round 16's removeItem) that happens to bother. Before this fix, a
  // composed placement with no `.weight` of its own contributed exactly
  // 0 kg here — this suite pins that this now uses `composition` (the
  // actual source of physical truth) instead.
  describe('composition-aware weight (Round 17)', () => {
    const A: CompositionCatalogItem = { id: 'A', weight: 500, height: 1.0 }
    const B: CompositionCatalogItem = { id: 'B', weight: 800, height: 2.0 }
    const catalog = [A, B]

    it('a composed placement with NO top-level .weight set is resolved from composition (real weight 3400kg), not treated as 0', () => {
      const composed = { itemId: 'A', layers: 5, composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }] }
      // 3400 (composed) + 1000 (new) = 4400 > 4000 -> exceeds
      expect(wouldExceedDeckCapacity([composed], 1000, 4, catalog)).toBe(true)
      // 3400 + 500 = 3900 <= 4000 -> does not exceed
      expect(wouldExceedDeckCapacity([composed], 500, 4, catalog)).toBe(false)
    })

    it('landing exactly on the limit with a composed placement is still allowed (not strictly over)', () => {
      const composed = { itemId: 'A', layers: 5, composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }] }
      // 3400 + 600 = 4000 exactly
      expect(wouldExceedDeckCapacity([composed], 600, 4, catalog)).toBe(false)
      expect(wouldExceedDeckCapacity([composed], 601, 4, catalog)).toBe(true)
    })

    it('composition takes priority over a stale/wrong top-level .weight, not added on top of it', () => {
      // If this were double-counting weight+composition, this would exceed
      // (3400 + 999999 + anything); it must use composition alone (3400).
      const composedWithStaleWeight = { itemId: 'A', layers: 5, weight: 999999, composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }] }
      expect(wouldExceedDeckCapacity([composedWithStaleWeight], 500, 4, catalog)).toBe(false) // 3400+500=3900<4000
    })

    it('dormancy: an uncomposed placement is completely unaffected — identical to the pre-Round-17 behavior, catalog ignored', () => {
      expect(wouldExceedDeckCapacity([{ weight: 3000, layers: 1 }], 2000, 10, catalog)).toBe(false)
      expect(wouldExceedDeckCapacity([{ weight: 9000, layers: 1 }], 2000, 10, catalog)).toBe(true)
      // Catalog omitted entirely (defaults to []) — must behave the same
      // for uncomposed placements, which never touch it.
      expect(wouldExceedDeckCapacity([{ weight: 3000, layers: 1 }], 2000, 10)).toBe(false)
    })

    it('mixed composed + uncomposed placements on the same deck sum correctly', () => {
      const composed = { itemId: 'A', layers: 5, composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }] } // 3400kg
      const uncomposed = { itemId: 'C', weight: 600, layers: 1 } // 600kg
      // 3400 + 600 = 4000 current, +0 new = exactly at the 4000kg (4t) limit
      expect(wouldExceedDeckCapacity([composed, uncomposed], 0, 4, catalog)).toBe(false)
      expect(wouldExceedDeckCapacity([composed, uncomposed], 1, 4, catalog)).toBe(true)
    })
  })
})

// Regression: normalizeProject (persistence layer) and updateItem (live
// layer) used to duplicate these rules by hand in two places that could
// silently drift apart. Now that both call the same cargoValidation
// functions, garbage input must sanitize identically through either path.
describe('normalizeProject and updateItem agree on garbage CargoItem input', () => {
  it('produces the same sanitized values for the same garbage patch', () => {
    const garbage = {
      width: -5,
      length: NaN,
      height: Infinity,
      quantity: -3,
      weight: 'heavy',
      maxLayers: 0,
      maxStackHeightM: -2,
    }

    const project: Project = {
      id: 'p1',
      name: 'Test',
      updatedAt: Date.now(),
      deck: {} as Project['deck'],
      items: [
        {
          id: 'i1',
          name: 'Junk item',
          color: '#000',
          allowRotation: true,
          ...garbage,
        } as unknown as Project['items'][number],
      ],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      mode: 'auto',
    } as unknown as Project

    const normalized = normalizeProject(project)
    const normalizedItem = normalized.items[0]

    useCalculator.setState({
      items: [
        {
          id: 'i1',
          name: 'Junk item',
          color: '#000',
          allowRotation: true,
          width: 1,
          length: 1,
          height: 0,
          quantity: 1,
        },
      ],
    } as unknown as Partial<ReturnType<typeof useCalculator.getState>>)
    useCalculator.getState().updateItem('i1', garbage as never)
    const liveItem = useCalculator.getState().items.find((it) => it.id === 'i1')!

    expect(liveItem.weight).toBe(normalizedItem.weight)
    expect(liveItem.maxLayers).toBe(normalizedItem.maxLayers)
    expect(liveItem.maxStackHeightM).toBe(normalizedItem.maxStackHeightM)
    // width/length/height/quantity are required fields: updateItem drops an
    // invalid patch value (keeping the item's prior value) instead of
    // substituting normalizeProject's load-time fallback — so those are
    // intentionally NOT compared 1:1 here, only the optional fields are.
  })
})
