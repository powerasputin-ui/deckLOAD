import { describe, it, expect } from 'vitest'
import { statusItems, type StatusLineInput } from './statusLine'

const base: StatusLineInput = {
  utilization: 0.812,
  weightKg: 16_600,
  placedUnits: 22,
  totalUnits: 22,
  tripCount: 1,
}

const texts = (s: StatusLineInput) => statusItems(s).map((i) => i.text)

describe('status line', () => {
  it('shows load, weight and units for a single trip without vessel data', () => {
    expect(texts(base)).toEqual(['81%', '16.6 т', '22/22 ед.'])
  })

  it('names the vessel limit next to the weight and flags going over it', () => {
    expect(texts({ ...base, maxDeckCargoT: 2550 })[1]).toBe('16.6 из 2550 т')
    const over = statusItems({ ...base, maxDeckCargoT: 10 }).find((i) => i.id === 'weight')!
    expect(over.tone).toBe('danger')
  })

  it('counts trips only when there is more than one', () => {
    expect(texts({ ...base, tripCount: 2 })).toContain('2 рейса')
    expect(texts({ ...base, tripCount: 5 })).toContain('5 рейсов')
  })

  it('shows GM with its verdict, and marks an estimate', () => {
    expect(texts({ ...base, gm: { valueM: 2.771, ok: true, estimated: false } })).toContain('GM 2.77 м ✓')
    expect(texts({ ...base, gm: { valueM: 0.1, ok: false, estimated: true } })).toContain('GM ≈0.10 м ✕')
  })

  it('leads each item to its section', () => {
    const targets = Object.fromEntries(
      statusItems({ ...base, tripCount: 2, gm: { valueM: 1, ok: true, estimated: false } }).map((i) => [i.id, i.target])
    )
    expect(targets).toEqual({ load: 'placement', weight: 'vessel', units: 'cargo', trips: 'placement', gm: 'checks' })
  })
})
