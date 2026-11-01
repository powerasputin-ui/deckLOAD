import { describe, it, expect } from 'vitest'
import { fmtNumber, fmtTonnes, pluralRu } from './utils'

describe('pluralRu', () => {
  it('picks the Russian form by the last one or two digits', () => {
    const f = (n: number) => pluralRu(n, 'уходит', 'уходят(2-4)', 'уходят')
    expect(f(1)).toBe('уходит')
    expect(f(21)).toBe('уходит')
    expect(f(101)).toBe('уходит')
    expect(f(2)).toBe('уходят(2-4)')
    expect(f(24)).toBe('уходят(2-4)')
    expect(f(0)).toBe('уходят')
    expect(f(5)).toBe('уходят')
    expect(f(11)).toBe('уходят')
    expect(f(14)).toBe('уходят')
    expect(f(111)).toBe('уходят')
  })
})

// Audit 2026-11-01, F-UT-1: a weight that isn't a number showed as «NaN»,
// where fmtNumber shows «—».
describe('fmtTonnes', () => {
  it('shows tonnes to one decimal, and a dash for what isn\'t a number', () => {
    expect([fmtTonnes(16_600), fmtTonnes(2_550_000), fmtTonnes(0)]).toEqual(['16.6', '2550', '0'])
    expect([fmtTonnes(NaN), fmtTonnes(Infinity), fmtNumber(NaN)]).toEqual(['—', '—', '—'])
  })

  // A finite number past what can be scaled by 100 used to read «Infinity».
  it('writes a huge but finite number as itself', () => {
    expect([fmtNumber(1e308), fmtNumber(-1e308), fmtNumber(1.5e306)]).toEqual(['1e+308', '-1e+308', '1.5e+306'])
  })
})
