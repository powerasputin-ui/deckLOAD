import { describe, it, expect } from 'vitest'
import { platformLoads, withUnweighed } from './platformLoads'
import { semiSubForPlan } from './semiSubPlan'
import { jackUpForPlan } from './jackUpPlan'
import { tripsOfProject } from './trips'
import type { CargoItem, PinnedPlacement } from './packing'
import type { DeckConfig } from '@/store/calculator'

// Audit 2026-11-07: what a platform's calculations read off the plan.

const deck = (over: Partial<DeckConfig> = {}): DeckConfig =>
  ({ width: 30, length: 40, unit: 'm', gap: 0, boardOffset: 0, clearance: 0, objectKind: 'semi-sub', shipFrame: { heightAboveBaselineM: 38 }, ...over }) as DeckConfig
const item = (over: Partial<CargoItem>): CargoItem => ({ id: 'x', name: 'Груз', width: 2, length: 2, height: 1, quantity: 1, color: '#000', allowRotation: false, weight: 10_000, ...over })
const trip = (d: DeckConfig, items: CargoItem[], pins: PinnedPlacement[] = []) =>
  tripsOfProject({ mode: 'auto', deck: d, items, manualPlacements: [], pinnedPlacementsByTrip: { 0: pins }, sortStrategy: 'area-desc', globalRotation: false, separationRules: [] })[0]

describe('platformLoads', () => {
  // Containers aboard, two high; a box arriving set on top of them.
  const onboard = item({ id: 'c', name: 'Контейнер', height: 2.5, quantity: 2, weight: 20_000, platformStatus: 'onboard' })
  const box = item({ id: 'b', name: 'Ящик', height: 1, quantity: 1, weight: 5_000 })
  const pile: PinnedPlacement = { id: 'p', itemId: 'c', name: 'Контейнер', color: '#000', x: 10, y: 10, width: 2, length: 2, layers: 3, rotated: false, composition: [{ itemId: 'c', layers: 2 }, { itemId: 'b', layers: 1 }] }

  it('takes a mixed pile by its parts: what arrives on top of cargo aboard counts, at its height', () => {
    const d = deck()
    const loads = platformLoads(d, trip(d, [onboard, box], [pile]), [onboard, box])
    // The box only: 5 t at 38 + 2 × 2.5 + 0.5 m — the containers are in the report.
    expect(loads.arriving).toEqual([{ weightT: 5, vcgM: 43.5, x: 11, y: 11 }])
  })

  it('and only its arriving part when the arriving cargo is at the bottom', () => {
    const d = deck()
    const under: PinnedPlacement = { ...pile, itemId: 'b', composition: [{ itemId: 'b', layers: 1 }, { itemId: 'c', layers: 2 }] }
    const loads = platformLoads(d, trip(d, [onboard, box], [under]), [onboard, box])
    expect(loads.arriving).toEqual([{ weightT: 5, vcgM: 38.5, x: 11, y: 11 }])
  })

  it('counts what arrives with no weight, and lets no check pass while it does', () => {
    const d = deck({
      semiSub: {
        operating: { draftM: 21, displacementT: 50_000, vdlMaxT: 5_000, kgLimit: [{ draftM: 21, kgMaxM: 21 }] },
        survival: { draftM: 17, displacementT: 45_000, vdlMaxT: 4_600, kgLimit: [{ draftM: 17, kgMaxM: 23 }] },
        ballastVcgM: 4,
        report: { draftM: 21, displacementT: 50_000, kgM: 20, vdlT: 4_000, ballastT: 9_000 },
        transfers: [],
      },
    })
    const pipes = item({ id: 'p', name: 'Трубы', width: 12, length: 2, weight: undefined, quantity: 3, maxLayers: 3 })
    const t = trip(d, [pipes])
    expect(platformLoads(d, t, [pipes]).unweighed).toBe(3)
    const r = semiSubForPlan(d, t, [pipes])!
    expect(r.unweighed).toBe(3)
    expect(r.checks.map((c) => c.status)).toEqual(['warn', 'warn', 'warn'])
    expect(r.checks.every((c) => c.detail.endsWith('без веса не учтено 3 ед.'))).toBe(true)
  })

  it('keeps a check over its limit over, with the cargo it couldn\'t count said', () => {
    const r = withUnweighed({ checks: [{ status: 'error' as const, detail: 'больше' }, { status: 'none' as const, detail: 'нет данных' }] }, 2)
    expect(r.checks).toEqual([
      { status: 'error', detail: 'больше · без веса не учтено 2 ед.' },
      { status: 'none', detail: 'нет данных · без веса не учтено 2 ед.' },
    ])
    expect(withUnweighed({ checks: [{ status: 'ok' as const, detail: 'ok' }] }, 0).checks[0].status).toBe('ok')
  })

  it('gives a jack-up the same parts, at their place for the legs', () => {
    const d = deck({
      objectKind: 'jack-up',
      jackUp: {
        mode: 'elevated',
        afloat: {},
        elevated: { maxLegLoadT: 5_000 },
        legs: [
          { id: 'a', name: 'Опора 1', fromSternM: 0, fromPortM: 0 },
          { id: 'b', name: 'Опора 2', fromSternM: 0, fromPortM: 30 },
          { id: 'c', name: 'Опора 3', fromSternM: 40, fromPortM: 15 },
        ],
        report: { vdlT: 1_000, legLoadsT: { a: 3_000, b: 3_000, c: 3_000 } },
        transfers: [],
      },
    })
    const r = jackUpForPlan(d, trip(d, [onboard, box], [pile]), [onboard, box])!
    expect(r.legs!.reduce((s, l) => s + l.addedT, 0)).toBeCloseTo(5, 9)
  })
})
