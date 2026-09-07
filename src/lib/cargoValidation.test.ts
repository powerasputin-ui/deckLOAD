import { describe, it, expect } from 'vitest'
import {
  sanitizeCargoWidth,
  sanitizeCargoLength,
  sanitizeCargoHeight,
  sanitizeCargoQuantity,
  sanitizeCargoWeight,
  sanitizeCargoMaxLayers,
  sanitizeCargoMaxStackHeightM,
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
