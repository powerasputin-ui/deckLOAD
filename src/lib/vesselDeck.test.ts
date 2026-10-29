import { describe, expect, it } from 'vitest'
import { deckForVessel, deckForVesselDrops, isDefaultCalculationName } from './vesselDeck'
import { VESSEL_TEMPLATES } from './vesselTemplates'
import type { DeckConfig } from '@/store/calculator'

// Stage 4, group C (spec 8.1): a library vessel applied to a calculation.

const kuznetsov = VESSEL_TEMPLATES.find((t) => t.id === 'aleksey-kuznetsov')!
const commander = VESSEL_TEMPLATES.find((t) => t.id === 'olympic-commander')!

const old: DeckConfig = {
  width: 8,
  length: 20,
  unit: 'm',
  gap: 0.3,
  boardOffset: 0.5,
  clearance: 2,
  maxDeckCargoT: 100,
  outline: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 20 }],
  restrictionZones: [{ id: 'z', name: 'Кран', shapeType: 'rect', x: 1, y: 1, width: 1, length: 1 }],
  loadZones: [{ id: 'l', x: 0, y: 0, width: 8, length: 20, maxLoadPerArea: 3 }],
  powerSockets: [{ id: 's', x: 0, y: 1, label: '1' }],
  lashingPoints: [{ id: 'p', x: 1, y: 1 }],
  annotations: [{ id: 'a', kind: 'note', text: 'Кран', x: 1, y: 1 }],
  backgroundImage: 'data:image/jpeg;base64,AAAA',
  backgroundImageOpacity: 0.5,
  vesselMotion: { ax: 0.3, ay: 0.5, az: 0.3, friction: 0.3, preset: 'open-sea' },
  icing: true,
  deckStrengthChoiceTPerM2: 5,
  vesselTemplateId: 'old',
} as DeckConfig

describe('deckForVessel', () => {
  it('replaces what belongs to the vessel and keeps the calculation\'s own settings', () => {
    const deck = deckForVessel(kuznetsov, old)
    expect(deck).toMatchObject({
      width: kuznetsov.deck.width,
      length: kuznetsov.deck.length,
      clearance: 3,
      maxDeckCargoT: 2550,
      tenFootContainerCapacity: 14,
      vessel: kuznetsov.vessel,
      shipFrame: kuznetsov.shipFrame,
      vesselTemplateId: 'aleksey-kuznetsov',
      // Kept.
      unit: 'm',
      gap: 0.3,
      boardOffset: 0.5,
      vesselMotion: old.vesselMotion,
      icing: true,
    })
    expect(deck.deckStrengthChoiceTPerM2).toBeUndefined()
    // The old deck's outline and obstacles go with it: Kuznetsov's deck is a
    // plain rectangle without obstacles.
    expect(deck.outline).toBeUndefined()
    expect(deck.restrictionZones).toBeUndefined()
  })

  it('drops what was tied to the old deck', () => {
    const deck = deckForVessel(kuznetsov, old)
    for (const key of ['backgroundImage', 'backgroundImageOpacity', 'loadZones', 'powerSockets', 'lashingPoints', 'annotations'] as const) {
      expect(deck[key]).toBeUndefined()
    }
  })

  it('brings the vessel\'s figures over in the deck\'s unit', () => {
    const deck = deckForVessel(commander, { ...old, unit: 'cm' })
    expect(deck.width).toBeCloseTo(commander.deck.width * 100)
    expect(deck.length).toBeCloseTo(commander.deck.length * 100)
    const hatch = commander.restrictionZones![0]
    expect(deck.restrictionZones![0]).toMatchObject({ x: hatch.x * 100, y: hatch.y * 100, width: hatch.width * 100, length: hatch.length * 100 })
    // No stack height in the vessel's data: the deck doesn't limit it.
    expect(deck.clearance).toBe(0)
  })
})

describe('deckForVesselDrops', () => {
  it('says what the old deck loses, the positions in the current mode\'s words', () => {
    expect(deckForVesselDrops(old, { mode: 'auto', count: 12 })).toEqual([
      'фото палубы',
      '1 зона нагрузки',
      '1 розетка',
      '1 точка крепления',
      '1 метка',
      '12 закреплений',
    ])
    expect(deckForVesselDrops({ ...old, backgroundImage: undefined }, { mode: 'manual', count: 3 }).at(-1)).toBe('3 ручные позиции')
    expect(deckForVesselDrops({ width: 8, length: 20, unit: 'm', gap: 0, boardOffset: 0, clearance: 0 }, { mode: 'auto', count: 0 })).toEqual([])
  })
})

describe('isDefaultCalculationName', () => {
  it('knows a calculation still named as it was created', () => {
    expect(isDefaultCalculationName('Расчёт 3')).toBe(true)
    expect(isDefaultCalculationName('Демо-расчёт')).toBe(false)
    expect(isDefaultCalculationName('Рейс 12, трубы')).toBe(false)
  })
})
