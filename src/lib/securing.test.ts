import { describe, it, expect } from 'vitest'
import {
  bOverGmFactor,
  cssAccelerations,
  lengthSpeedFactor,
  rowAt,
  securingBalance,
  CSS_AY_ON_DECK_HIGH,
  CSS_AZ,
  type SecuringLashing,
  type SecuringStack,
} from './securing'

// The CSS Code's annex 13 balance of forces (decided 2026-11-07).

describe('the annex\'s accelerations', () => {
  it('corrects for length and speed by table 3\'s own formula: 1.00 at 100 m and 15 kn', () => {
    expect(lengthSpeedFactor(100, 15)).toBeCloseTo(1.0, 3)
    // Table 3 itself: 1.20 at 50 m and 9 kn, 1.12 at 70 m and 12 kn, 0.70 at 120 m and 9 kn.
    expect(lengthSpeedFactor(50, 9)).toBeCloseTo(1.2, 2)
    expect(lengthSpeedFactor(70, 12)).toBeCloseTo(1.12, 2)
    expect(lengthSpeedFactor(120, 9)).toBeCloseTo(0.7, 2)
  })

  it('corrects across for B/GM by table 4, taking the smaller B/GM\'s factor between columns', () => {
    expect(bOverGmFactor(3)).toBe(2.64)
    expect(bOverGmFactor(6.9)).toBe(1.74)
    expect(bOverGmFactor(7)).toBe(1.56)
    expect(bOverGmFactor(12.99)).toBe(1.05)
    expect(bOverGmFactor(13)).toBe(1)
    expect(bOverGmFactor(40)).toBe(1)
  })

  it('reads table 2 at a place along the ship by the larger neighbouring column, the worst with no place', () => {
    expect(rowAt(CSS_AY_ON_DECK_HIGH, 0.5)).toBe(6.7)
    expect(rowAt(CSS_AY_ON_DECK_HIGH, 0.55)).toBe(6.8)
    expect(rowAt(CSS_AY_ON_DECK_HIGH, 0.02)).toBe(7.1)
    expect(rowAt(CSS_AZ, 0.95)).toBe(9.2)
    expect(rowAt(CSS_AZ, undefined)).toBe(9.2)
  })

  it('gives on deck, high, at midships for 100 m, 15 kn and B/GM 13: the table as it is', () => {
    const r = cssAccelerations({ lengthM: 100, breadthM: 20, speedKn: 15, gmM: 20 / 13 }, 0.5)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.accelerations.ay).toBeCloseTo(6.7, 2)
    expect(r.accelerations.ax).toBeCloseTo(3.8, 2)
    expect(r.accelerations.az).toBeCloseTo(4.3, 2)
  })

  it('says what is missing, and where the tables don\'t reach', () => {
    expect(cssAccelerations({ lengthM: 80, breadthM: 16 }, 0.5)).toEqual({ status: 'missing', missing: ['скорость', 'GM'] })
    expect(cssAccelerations({ lengthM: 40, breadthM: 12, speedKn: 10, gmM: 1 }, 0.5)).toMatchObject({ status: 'outside' })
    expect(cssAccelerations({ lengthM: 80, breadthM: 16, speedKn: 8, gmM: 1 }, 0.5)).toMatchObject({ status: 'outside' })
    // B/GM 2.5: a stiffer vessel than the tables cover.
    expect(cssAccelerations({ lengthM: 80, breadthM: 15, speedKn: 12, gmM: 6 }, 0.5)).toMatchObject({ status: 'outside' })
  })
})

describe('the balance of forces', () => {
  // A 2 × 2 × 2 m box of 10 t, its centre 1 m up, on timber (μ 0.3); two
  // lashings from its port corners to the deck 2 m to port, at 45°, MSL 10 t.
  const box: SecuringStack = { massKg: 10_000, x: 0, y: 0, width: 2, length: 2, heightM: 2, cgHeightM: 1 }
  const toPort = (cornerY: number, over: Partial<SecuringLashing> = {}): SecuringLashing => ({
    cornerX: 0,
    cornerY,
    anchorX: -2,
    anchorY: cornerY,
    mslKg: 10_000,
    verticalAngleDeg: 45,
    ...over,
  })
  const a = { ax: 3, ay: 6, az: 4 }

  it('adds wind and sloshing, 1 kN/m² each, to the inertia', () => {
    const r = securingBalance(box, [], a, 0.3)
    // 10 t × 6 m/s² + wind 2 × 2 m + sloshing 2 × 2 m.
    expect(r.forces.fy).toBeCloseTo(68, 9)
    expect(r.forces.fx).toBeCloseTo(38, 9)
    expect(r.forces.fz).toBeCloseTo(40, 9)
  })

  it('counts a lashing only against the push it holds: the port lashings hold the box from starboard, not from port', () => {
    const r = securingBalance(box, [toPort(0), toPort(2)], a, 0.3)
    const toStarboard = r.balances.find((b) => b.kind === 'sliding' && b.toward === '+x')!
    const toPortSide = r.balances.find((b) => b.kind === 'sliding' && b.toward === '-x')!
    // Friction 0.3 × 98.1 kN; each lashing CS = 98.1 / 1.5 = 65.4 kN at
    // f = 0.3 · sin 45° + cos 45° = 0.919.
    const friction = 0.3 * 10 * 9.81
    const each = (98.1 / 1.5) * (0.3 * Math.SQRT1_2 + Math.SQRT1_2)
    expect(toStarboard.capacity).toBeCloseTo(friction + 2 * each, 6)
    expect(toStarboard.ok).toBe(true)
    // Pushed to port, both go slack: friction alone, 29 of 68 kN.
    expect(toPortSide.capacity).toBeCloseTo(friction, 6)
    expect(toPortSide.ok).toBe(false)
    expect(r.ok).toBe(false)
    expect(r.worst).toBe(toPortSide)
  })

  it('lessens the friction along the ship by the vertical acceleration', () => {
    const r = securingBalance(box, [], a, 0.3)
    const along = r.balances.find((b) => b.kind === 'sliding' && b.toward === '+y')!
    expect(along.capacity).toBeCloseTo(0.3 * (98.1 - 40), 6)
  })

  it('counts a lashing at its calculated strength, MSL / 1.5', () => {
    const flat = (mslKg: number) =>
      securingBalance({ ...box, massKg: 1000 }, [toPort(0, { mslKg, verticalAngleDeg: 0 })], { ax: 0, ay: 1, az: 0 }, 0).balances.find(
        (b) => b.kind === 'sliding' && b.toward === '+x'
      )!.capacity
    expect(flat(1500)).toBeCloseTo((1500 * 9.81) / 1000 / 1.5, 9)
  })

  it('leaves a lashing steeper than 60° out of sliding, but not out of tipping', () => {
    const steep = securingBalance({ ...box, heightM: 4, cgHeightM: 2 }, [toPort(0, { verticalAngleDeg: 70 })], a, 0.3)
    expect(steep.balances.find((b) => b.kind === 'sliding' && b.toward === '+x')!.capacity).toBeCloseTo(0.3 * 98.1, 6)
    const tipping = steep.balances.find((b) => b.kind === 'tipping' && b.toward === '+x')!
    expect(tipping.capacity).toBeGreaterThan(98.1)
  })

  it('tips over the edge it is pushed to, held by its weight\'s lever and 0.9 of the lashings\'', () => {
    // A tall narrow box: 1 m across, 4 m high, centre 2 m up.
    const tall: SecuringStack = { ...box, width: 1, heightM: 4, cgHeightM: 2 }
    const lashing = toPort(0)
    const r = securingBalance(tall, [lashing], a, 0.3)
    const t = r.balances.find((b) => b.kind === 'tipping' && b.toward === '+x')!
    // 10·6·2 + wind 2·4 at 2 m + sloshing 2·2 at 1 m.
    expect(t.demand).toBeCloseTo(120 + 16 + 4, 6)
    // The lashing's corner is 1 m from the starboard edge, made fast 2 m up
    // (2 m to the anchor at 45°): c = 1 · sin 45° + 2 · cos 45°.
    const c = 1 * Math.SQRT1_2 + 2 * Math.SQRT1_2
    expect(t.capacity).toBeCloseTo(0.5 * 98.1 + 0.9 * (98.1 / 1.5) * c, 6)
  })

  it('leaves out of tipping a lashing under 45° to the deck and more than 45° off the transverse', () => {
    const tall: SecuringStack = { ...box, width: 1, heightM: 4, cgHeightM: 2 }
    // 60° off the transverse, 30° to the deck.
    const skew = toPort(0, { anchorX: -1, anchorY: Math.sqrt(3), verticalAngleDeg: 30 })
    const t = securingBalance(tall, [skew], a, 0.3).balances.find((b) => b.kind === 'tipping' && b.toward === '+x')!
    expect(t.capacity).toBeCloseTo(0.5 * 98.1, 9)
  })

  it('lashed across only, it slides along: friction alone holds 17 of 38 kN', () => {
    const r = securingBalance(box, [toPort(0), toPort(2), toPort(0, { anchorX: 4, cornerX: 2 }), toPort(2, { anchorX: 4, cornerX: 2 })], a, 0.3)
    expect(r.balances.filter((b) => !b.ok).map((b) => `${b.kind}${b.toward}`)).toEqual(['sliding+y', 'sliding-y'])
  })

  it('a heavier stack on the same lashings can fail where a lighter one holds', () => {
    // A lashing from each corner outward, 45° off the transverse.
    const diagonal = (cornerX: number, cornerY: number): SecuringLashing => ({
      cornerX,
      cornerY,
      anchorX: cornerX === 0 ? -2 : 4,
      anchorY: cornerY === 0 ? -2 : 4,
      mslKg: 10_000,
      verticalAngleDeg: 45,
    })
    const lashings = [diagonal(0, 0), diagonal(0, 2), diagonal(2, 0), diagonal(2, 2)]
    const light = securingBalance({ ...box, massKg: 10_000 }, lashings, a, 0.3)
    expect(light.ok).toBe(true)
    // Two of them each way: 65.4 kN × (0.3 · sin 45° + cos 45° · cos 45°).
    const each = (98.1 / 1.5) * (0.3 * Math.SQRT1_2 + 0.5)
    expect(light.balances.find((b) => b.kind === 'sliding' && b.toward === '+x')!.capacity).toBeCloseTo(0.3 * 98.1 + 2 * each, 6)
    expect(light.balances.find((b) => b.kind === 'sliding' && b.toward === '-y')!.capacity).toBeCloseTo(0.3 * (98.1 - 40) + 2 * each, 6)
    // 40 t: 248 kN across against 118 + 93.
    expect(securingBalance({ ...box, massKg: 40_000 }, lashings, a, 0.3).ok).toBe(false)
  })
})
