import { describe, it, expect } from 'vitest'
import { contrastRatio, deltaE2000, deltaEAsSeen, labAsSeen, linearRgbToLab } from './colorScience'

describe('contrastRatio (WCAG 2)', () => {
  it('spans 1 to 21', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 6)
  })

  it('is symmetric and matches a known pair', () => {
    // #767676 on white is the classic 4.54:1.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2)
    expect(contrastRatio('#FFFFFF', '#767676')).toBeCloseTo(4.54, 2)
  })
})

describe('deltaE2000', () => {
  // Reference pairs from Sharma, Wu & Dalal (2005).
  it.each([
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
    [[50, 2.5, 0], [50, 3.2972, 0], 1.0],
  ] as const)('%j vs %j = %d', (a, b, expected) => {
    expect(deltaE2000([...a], [...b])).toBeCloseTo(expected, 4)
    expect(deltaE2000([...b], [...a])).toBeCloseTo(expected, 4)
  })
})

describe('labAsSeen', () => {
  it('white stays white for every vision, and normal vision is plain L*a*b*', () => {
    for (const vision of ['normal', 'protanopia', 'deuteranopia', 'tritanopia'] as const) {
      const [L] = labAsSeen('#FFFFFF', vision)
      expect(L).toBeCloseTo(100, 1)
    }
    expect(labAsSeen('#808080', 'normal')).toEqual(linearRgbToLab([0.2158605, 0.2158605, 0.2158605]).map((v) => expect.closeTo(v, 4)))
  })

  it('red and green that differ plainly look much closer to a protanope', () => {
    const normal = deltaEAsSeen('#D62728', '#2CA02C', 'normal')
    const protan = deltaEAsSeen('#D62728', '#2CA02C', 'protanopia')
    expect(protan).toBeLessThan(normal / 2)
  })
})
