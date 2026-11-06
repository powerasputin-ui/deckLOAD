import { describe, it, expect } from 'vitest'
import { semiSubForPlan } from './semiSubPlan'
import { packMultiTrip, type CargoItem } from './packing'
import { DEMO_DECK, type DeckConfig } from '@/store/calculator'
import type { SemiSubData } from './semiSub'

// Spec 2026-11-06, 7.2: what arrives is what the plan places of the cargo
// «приход», at the heights the deck gives it; what leaves, the cargo
// «отгрузка», one tier high; what's on board moves nothing.

const data: SemiSubData = {
  operating: { draftM: 21, displacementT: 50_000, vdlMaxT: 5_000, kgLimit: [{ draftM: 21, kgMaxM: 21 }] },
  survival: { draftM: 17, displacementT: 45_000, vdlMaxT: 4_600, kgLimit: [{ draftM: 17, kgMaxM: 23 }] },
  ballastVcgM: 4,
  report: { draftM: 21, displacementT: 50_000, kgM: 20, vdlT: 4_000, ballastT: 9_000 },
  transfers: [],
}
const deck = { ...DEMO_DECK, width: 30, length: 40, objectKind: 'semi-sub', semiSub: data, shipFrame: { heightAboveBaselineM: 38 } } as DeckConfig
const box = (over: Partial<CargoItem>): CargoItem => ({ id: 'x', name: 'Ящик', width: 2, length: 2, height: 2, quantity: 1, color: '#000', allowRotation: true, weight: 10_000, ...over })

function plan(items: CargoItem[], d: DeckConfig = deck) {
  const onDeck = items.filter((it) => it.platformStatus !== 'outgoing')
  const [trip] = packMultiTrip(d.width, d.length, onDeck, { gap: d.gap, boardOffset: d.boardOffset, clearance: d.clearance, unit: d.unit }, 1)
  return semiSubForPlan(d, trip, items)
}

describe('semiSubForPlan', () => {
  it('is a semi-submersible\'s only', () => {
    expect(semiSubForPlan({ ...deck, objectKind: 'fixed' }, undefined, [])).toBeUndefined()
    expect(semiSubForPlan({ ...deck, objectKind: undefined }, undefined, [])).toBeUndefined()
  })

  it('counts what arrives at its height on the deck, what leaves, and nothing for what is on board', () => {
    const r = plan([
      box({ id: 'in', quantity: 2 }),
      box({ id: 'on', platformStatus: 'onboard', weight: 99_000 }),
      box({ id: 'out', platformStatus: 'outgoing', quantity: 3, weight: 5_000, height: 1 }),
    ])!
    // 2 × 10 t arriving at 38 + 1 m, 3 × 5 t leaving at 38 + 0.5 m.
    expect(r.netT).toBeCloseTo(20 - 15, 9)
    expect(r.momentTm).toBeCloseTo(20 * 39 - 15 * 38.5, 9)
    expect(r.vdlAfterT).toBeCloseTo(4_005, 9)
  })

  it('without the deck\'s height the KG isn\'t worked out', () => {
    const r = plan([box({ id: 'in' })], { ...deck, shipFrame: {} })!
    expect(r.kgOperatingM).toBeUndefined()
    expect(r.checks.find((c) => c.id === 'semi-kg')!.detail).toBe('Не задана высота палубы над основной плоскостью')
  })
})
