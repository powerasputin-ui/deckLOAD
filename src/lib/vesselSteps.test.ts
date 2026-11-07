import { describe, it, expect } from 'vitest'
import { firstOpenStep, requiredSteps, vesselSteps, type VesselStepsInput } from './vesselSteps'

// A new calculation's own deck, nothing on it.
const input = (over: Partial<VesselStepsInput> = {}, deck: Partial<VesselStepsInput['deck']> = {}): VesselStepsInput => ({
  fresh: false,
  checks: {},
  stability: { hasVessel: false },
  ...over,
  deck: { width: 8, length: 20, unitLabel: 'м', bow: 'справа', bowAssumed: false, zones: 0, obstacles: 0, photo: false, sockets: 0, lashingPoints: 0, marks: 0, ...deck },
})

describe('«Судно» as steps', () => {
  it('folds each block to a line of what it holds', () => {
    const s = vesselSteps(input({}, { obstacles: 2, photo: true, sockets: 1, lashingPoints: 5, marks: 0 }))
    expect(s.library).toEqual({ summary: 'Своя палуба', status: 'ok' })
    expect(s.deck).toEqual({ summary: '8 × 20 м · нос справа', status: 'ok' })
    // A new calculation has chosen neither yet.
    const fresh = vesselSteps(input({ fresh: true }))
    expect([fresh.library.status, fresh.deck.status]).toEqual([undefined, undefined])
    expect(s.card).toEqual({ summary: 'вес груза не ограничен', status: undefined })
    expect(s.zones).toEqual({ summary: 'нет', status: undefined })
    expect(s.stability).toEqual({ summary: 'нет данных судна' })
    expect([s.obstacles, s.photo, s.sockets, s.lashing, s.marks].map((x) => x.summary)).toEqual([
      '2 препятствия',
      'загружено',
      '1 розетка',
      '5 точек',
      'нет',
    ])
  })

  it('names the library vessel, its limits and its stability', () => {
    const s = vesselSteps(
      input(
        {
          vesselLabel: 'Алексей Кузнецов (IMO 9692648)',
          stability: { hasVessel: true, gm: { valueM: 1.904, status: 'warn', estimated: true, state: 'arrival' } },
        },
        { width: 16.9, length: 49.1, maxDeckCargoT: 2550, strength: { chosenTPerM2: 5, pending: false }, zones: 1 }
      )
    )
    expect(s.library).toEqual({ summary: 'Алексей Кузнецов (IMO 9692648)', status: 'ok' })
    expect(s.card).toEqual({ summary: 'до 2550 т · 5 т/м²', status: 'ok' })
    expect(s.zones).toEqual({ summary: '1 зона', status: 'ok' })
    expect(s.stability).toEqual({ summary: 'GM ≈1.90 м (приход)', status: 'warn' })
  })

  it('says in the folded line what needs looking at', () => {
    const pending = vesselSteps(input({ vesselLabel: 'X' }, { strength: { pending: true }, bowAssumed: true }))
    expect(pending.card).toEqual({ summary: 'вес груза не ограничен · прочность палубы не выбрана', status: 'warn' })
    // The deck strength left to choose is the card's to say, not the zones'.
    expect(pending.zones.status).toBeUndefined()
    expect(pending.deck.status).toBe('warn')
    const over = vesselSteps(input({ checks: { deckWeight: 'error', zones: 'error' } }, { maxDeckCargoT: 10, zones: 2 }))
    expect(over.card.status).toBe('error')
    expect(over.zones.status).toBe('error')
    const weightless = vesselSteps(input({ checks: { deckWeight: 'warn' } }, { maxDeckCargoT: 10 }))
    expect(weightless.card.status).toBe('warn')
    const noHeight = vesselSteps(input({ stability: { hasVessel: true, missing: 'Не задана высота палубы над килем' } }))
    expect(noHeight.stability).toEqual({ summary: 'не задана высота палубы над килем', status: 'warn' })
  })

  it('opens the first step with a problem, else the first step of a new calculation, else none', () => {
    expect(firstOpenStep(vesselSteps(input({ fresh: true })), true)).toBe('library')
    expect(firstOpenStep(vesselSteps(input()), false)).toBeUndefined()
    const pending = vesselSteps(input({ vesselLabel: 'X' }, { strength: { pending: true } }))
    expect(firstOpenStep(pending, true)).toBe('card')
    const noHeight = vesselSteps(input({ stability: { hasVessel: true, missing: 'Не задана высота палубы над килем' } }))
    expect(firstOpenStep(noHeight, false)).toBe('stability')
  })
})

// Spec 2026-11-06, 14: a platform's steps go from what it is, as a vessel's
// from the vessel.
describe('a platform\'s steps', () => {
  it('go from which one it is, its card and its manual\'s data to the deck, the zones and the day\'s report', () => {
    expect(requiredSteps('semi-sub')).toEqual(['library', 'card', 'semi-data', 'deck', 'zones', 'semi-report'])
    expect(requiredSteps('jack-up')).toEqual(['library', 'card', 'jack-data', 'deck', 'zones', 'jack-report'])
    expect(requiredSteps('fixed')).toEqual(['library', 'card', 'deck', 'zones'])
    expect(requiredSteps('vessel')).toEqual(['library', 'deck', 'card', 'zones', 'stability'])
  })

  it('say in the first one which it is: the saved one, or a new one and what the library keeps', () => {
    expect(vesselSteps(input({ kind: 'semi-sub', librarySaved: 2 })).library).toEqual({ summary: 'новая · в библиотеке 2' })
    expect(vesselSteps(input({ kind: 'semi-sub' })).library).toEqual({ summary: 'новая · в библиотеке нет' })
    expect(vesselSteps(input({ kind: 'semi-sub', vesselLabel: 'Полярная звезда', librarySaved: 1 })).library).toEqual({ summary: '«Полярная звезда»', status: 'ok' })
  })

  it('open a new one at its library when it keeps platforms of the kind, else at its card', () => {
    const fresh = (saved: number) => firstOpenStep(vesselSteps(input({ kind: 'semi-sub', fresh: true, librarySaved: saved })), true, 'semi-sub', saved)
    expect(fresh(0)).toBe('card')
    expect(fresh(3)).toBe('library')
    expect(firstOpenStep(vesselSteps(input({ kind: 'fixed', fresh: true })), true, 'fixed')).toBe('card')
    // A vessel's library always has the built-in vessels.
    expect(firstOpenStep(vesselSteps(input({ fresh: true })), true, 'vessel', 0)).toBe('library')
  })
})
