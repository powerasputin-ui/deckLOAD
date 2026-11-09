import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { GzChart } from './GzChart'
import type { GZCurveResult } from '@/lib/stability'

// Audit 2026-11-09: a GZ curve drawn upside down, or back to front, passed
// every test. What the chart draws is checked here by its geometry — the
// points' order and heights against its own axis — not by pixels.

const gz: GZCurveResult = {
  curve: [
    { heelDeg: 0, GZ: 0 },
    { heelDeg: 10, GZ: 0.3 },
    { heelDeg: 20, GZ: 0.6 },
    { heelDeg: 30, GZ: 0.8 },
    { heelDeg: 40, GZ: 0.5 },
    { heelDeg: 50, GZ: -0.1 },
  ],
  maxGZ: 0.8,
  angleOfMaxGZ: 30,
  angleOfVanishingStability: 48,
  areaUnder30Deg: 0.2,
  areaUnder40Deg: 0.3,
  area30to40: 0.1,
  knOutOfRange: false,
}

const pointsOf = (container: HTMLElement) =>
  container
    .querySelector('polyline')!
    .getAttribute('points')!
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number) as [number, number])

describe('GzChart', () => {
  it('draws the heel left to right, in the curve\'s order', () => {
    const { container } = render(<GzChart gz={gz} />)
    const xs = pointsOf(container).map(([x]) => x)
    expect(xs).toHaveLength(6)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
    // Evenly, as the angles are.
    expect(xs[2] - xs[1]).toBeCloseTo(xs[1] - xs[0], 9)
  })

  it('draws a larger arm higher, the peak highest and a negative arm under the zero line', () => {
    const { container } = render(<GzChart gz={gz} />)
    const ys = pointsOf(container).map(([, y]) => y)
    // SVG's y grows downward: higher on the chart is a smaller y.
    expect(ys[1]).toBeLessThan(ys[0])
    expect(ys[3]).toBe(Math.min(...ys))
    // The zero line is the strong one; the 50° arm is below it.
    const zero = Number(container.querySelector('line.stroke-line-strong')!.getAttribute('y1'))
    expect(ys[0]).toBeCloseTo(zero, 9)
    expect(ys[5]).toBeGreaterThan(zero)
    // In proportion: 0.8 m twice as far above zero as 0.4 m would be, so
    // 0.6 m sits three quarters of the way.
    expect((zero - ys[2]) / (zero - ys[3])).toBeCloseTo(0.75, 9)
  })

  it('names the peak and lists every angle in its table', () => {
    const { container, getByText } = render(<GzChart gz={gz} />)
    expect(getByText('макс. 0.80 м при 30°')).toBeTruthy()
    const rows = Array.from(container.querySelectorAll('table[aria-label="Кривая GZ"] tbody tr')).map((tr) => tr.textContent)
    expect(rows).toEqual(['00', '100.30', '200.60', '300.80', '400.50', '50-0.10'])
  })
})
