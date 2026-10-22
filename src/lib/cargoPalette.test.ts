import { describe, it, expect } from 'vitest'
import { CARGO_INK, CARGO_TONES, cargoNumbers, cargoToneForNumber } from './cargoPalette'
import { contrastRatio, deltaEAsSeen, type Vision } from './colorScience'
import { THEME_TOKENS } from './theme'

// Spec 9.2 and 14. Conditions: CIEDE2000; Machado 2009 at severity 1.0
// applied in linear RGB; the light-theme deck #E2E8EE.
const VISIONS: Vision[] = ['normal', 'protanopia', 'deuteranopia', 'tritanopia']
const DECK = THEME_TOKENS.light.deck
const n = CARGO_TONES.length

describe('cargo palette', () => {
  it('uses the deck the spec measured against', () => {
    expect(DECK).toBe('#E2E8EE')
  })

  it('every tone carries its number at 7:1 or more', () => {
    const low = CARGO_TONES.filter((t) => contrastRatio(CARGO_INK, t) < 7)
    expect(low).toEqual([])
  })

  it('adjacent numbers, 10 → 1 included, differ by ΔE2000 ≥ 13 under every colour vision', () => {
    const close: string[] = []
    for (const vision of VISIONS) {
      for (let i = 0; i < n; i++) {
        const d = deltaEAsSeen(CARGO_TONES[i], CARGO_TONES[(i + 1) % n], vision)
        if (d < 13) close.push(`${vision} ${i + 1}→${((i + 1) % n) + 1}: ${d.toFixed(1)}`)
      }
    }
    expect(close).toEqual([])
  })

  it('any two tones differ by ΔE2000 ≥ 9 with normal vision', () => {
    const close: string[] = []
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = deltaEAsSeen(CARGO_TONES[i], CARGO_TONES[j], 'normal')
        if (d < 9) close.push(`${i + 1}/${j + 1}: ${d.toFixed(1)}`)
      }
    }
    expect(close).toEqual([])
  })

  it('no tone blends into the empty deck: ΔE2000 ≥ 8 under every colour vision', () => {
    const close = VISIONS.flatMap((vision) =>
      CARGO_TONES.filter((t) => deltaEAsSeen(t, DECK, vision) < 8).map((t) => `${vision} ${t}`)
    )
    expect(close).toEqual([])
  })

  it('keeps out of the accent orange', () => {
    for (const tone of CARGO_TONES) {
      expect(deltaEAsSeen(tone, THEME_TOKENS.light.accent, 'normal')).toBeGreaterThan(20)
    }
  })
})

describe('cargo numbers and tones', () => {
  it('a cargo is numbered by its place in the list, and its tone follows the number', () => {
    const numbers = cargoNumbers([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect([...numbers]).toEqual([['a', 1], ['b', 2], ['c', 3]])
    expect(cargoToneForNumber(1)).toBe(CARGO_TONES[0])
    expect(cargoToneForNumber(10)).toBe(CARGO_TONES[9])
  })

  it('cargo 11 takes tone 1 again', () => {
    expect(cargoToneForNumber(11)).toBe(CARGO_TONES[0])
    expect(cargoToneForNumber(23)).toBe(CARGO_TONES[2])
  })
})
