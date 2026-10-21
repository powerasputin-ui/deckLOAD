import { describe, it, expect } from 'vitest'
import { pluralRu } from './utils'

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
