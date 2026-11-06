import { describe, it, expect } from 'vitest'
import { jackUpForPlan } from './jackUpPlan'
import { packMultiTrip, type CargoItem } from './packing'
import { DEMO_DECK, type DeckConfig } from '@/store/calculator'
import type { JackUpData } from './jackUp'

// Spec 2026-11-06, 11.3: what arrives is what the plan places of the cargo
// «приход», each stack at its own place on the deck.

const legs: JackUpData['legs'] = [
  { id: 'a', name: 'Опора 1', fromSternM: 30, fromPortM: 30 },
  { id: 'b', name: 'Опора 2', fromSternM: 30, fromPortM: 0 },
  { id: 'c', name: 'Опора 3', fromSternM: 0, fromPortM: 0 },
  { id: 'd', name: 'Опора 4', fromSternM: 0, fromPortM: 30 },
]
const data: JackUpData = {
  mode: 'elevated',
  afloat: {},
  elevated: { vdlMaxT: 3_000, maxLegLoadT: 5_000 },
  legs,
  report: { vdlT: 2_000, legLoadsT: { a: 4_000, b: 4_000, c: 4_000, d: 4_000 } },
  transfers: [],
}
// A deck of 30 × 30 m, the bow at +y, the legs at its corners.
const deck = { ...DEMO_DECK, width: 30, length: 30, boardOffset: 0, gap: 0, objectKind: 'jack-up', jackUp: data, shipFrame: { heightAboveBaselineM: 20 } } as DeckConfig
const box = (over: Partial<CargoItem>): CargoItem => ({ id: 'x', name: 'Ящик', width: 2, length: 2, height: 2, quantity: 1, color: '#000', allowRotation: false, weight: 100_000, ...over })

function plan(items: CargoItem[], d: DeckConfig = deck) {
  const onDeck = items.filter((it) => it.platformStatus !== 'outgoing')
  const [trip] = packMultiTrip(d.width, d.length, onDeck, { gap: d.gap, boardOffset: d.boardOffset, clearance: d.clearance, unit: d.unit }, 1)
  return { trip, r: jackUpForPlan(d, trip, items)! }
}

describe('jackUpForPlan', () => {
  it('is a self-elevating unit\'s only', () => {
    expect(jackUpForPlan({ ...deck, objectKind: 'semi-sub' }, undefined, [])).toBeUndefined()
  })

  it('shares each arriving stack by where the plan put it; what is on board moves nothing', () => {
    const { trip, r } = plan([box({ id: 'in' }), box({ id: 'on', platformStatus: 'onboard' })])
    const stack = trip.placed.find((p) => p.itemId === 'in')!
    const cx = stack.x + stack.width / 2
    const cy = stack.y + stack.length / 2
    // On a square of legs at the deck's corners the share is a plane over
    // the deck: the corner (30; 30) takes 1/4 + (cx − 15)/60 + (cy − 15)/60.
    expect(r.legs![0].addedT).toBeCloseTo(100 * (0.25 + (cx - 15) / 60 + (cy - 15) / 60), 6)
    expect(r.legs!.reduce((s, l) => s + l.addedT, 0)).toBeCloseTo(100, 9)
    expect(r.vdlAfterT).toBe(2_100)
  })

  it('takes nothing off the legs for cargo leaving, but takes it off the VDL', () => {
    const { r } = plan([box({ id: 'out', platformStatus: 'outgoing', weight: 50_000 })])
    expect(r.legs!.map((l) => l.afterT)).toEqual([4_000, 4_000, 4_000, 4_000])
    expect(r.vdlAfterT).toBe(1_950)
  })

  it('afloat, gives the KG at the stacks\' height', () => {
    const afloat = { ...deck, jackUp: { ...data, mode: 'afloat' as const, report: { ...data.report, displacementT: 10_000, kgM: 10, draftM: 3 }, afloat: { tpcTPerCm: 25 } } }
    const { r } = plan([box({ id: 'in' })], afloat)
    // 100 t at 20 + 1 m: (100 000 + 2 100) / 10 100.
    expect(r.kgAfterM).toBeCloseTo(102_100 / 10_100, 9)
    expect(r.draftAfterM).toBeCloseTo(3.04, 9)
  })
})
