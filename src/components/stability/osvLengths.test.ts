import { describe, it, expect } from 'vitest'
import { osvOutsideItsLengths } from './StabilityResults'

// IS Code 2008 part B 2.4: supply vessels of 24 to 100 m.
describe('the supply-vessel criteria outside their lengths', () => {
  it('flags a vessel longer than 100 m or shorter than 24 m, only with those criteria picked', () => {
    expect(osvOutsideItsLengths({ criteriaSet: 'osv-b245', lengthBpp: 120 })).toBe(true)
    expect(osvOutsideItsLengths({ criteriaSet: 'osv-b245', lengthBpp: 20 })).toBe(true)
    expect(osvOutsideItsLengths({ criteriaSet: 'osv-b245', lengthBpp: 77.2 })).toBe(false)
    expect(osvOutsideItsLengths({ criteriaSet: 'osv-b245', lengthBpp: 100 })).toBe(false)
    expect(osvOutsideItsLengths({ criteriaSet: 'is-code-a', lengthBpp: 120 })).toBe(false)
    expect(osvOutsideItsLengths({ lengthBpp: 120 })).toBe(false)
    // No length entered: nothing to say yet.
    expect(osvOutsideItsLengths({ criteriaSet: 'osv-b245', lengthBpp: 0 })).toBe(false)
  })
})
