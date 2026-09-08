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
  mergedPlacementWeight,
} from './cargoValidation'
import { normalizeProject } from '@/store/projects'
import { useCalculator } from '@/store/calculator'
import type { Project } from '@/store/projects'

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
})

// Regression: a cross-item pipe merge (two CargoItems with matching
// dimensions but different weight — reconcileCrossItemMerge in page.tsx
// never required weight to match) used to leave the target placement's
// weight untouched while bumping its layers, silently corrupting the
// stack's real total weight in either direction.
describe('mergedPlacementWeight', () => {
  it('is a no-op for a same-item merge (both sides already share one weight)', () => {
    expect(mergedPlacementWeight(500, 2, 500, 3)).toBe(500)
  })
  it('layer-weights a cross-item merge so total weight is preserved', () => {
    // target: 800kg/layer x 2 layers = 1600kg. dragged: 500kg/layer x 3 layers = 1500kg.
    // merged: 5 layers, total 3100kg -> 620kg/layer.
    const merged = mergedPlacementWeight(800, 2, 500, 3)
    expect(merged).toBeCloseTo(620, 6)
    expect((merged ?? 0) * 5).toBeCloseTo(1600 + 1500, 6)
  })
  it('treats a missing weight as 0 on either side', () => {
    expect(mergedPlacementWeight(undefined, 2, 500, 3)).toBeCloseTo((0 * 2 + 500 * 3) / 5, 6)
    expect(mergedPlacementWeight(500, 2, undefined, 3)).toBeCloseTo((500 * 2 + 0 * 3) / 5, 6)
  })
  it('falls back to targetWeight when total layers is zero (degenerate input)', () => {
    expect(mergedPlacementWeight(500, 0, 500, 0)).toBe(500)
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
