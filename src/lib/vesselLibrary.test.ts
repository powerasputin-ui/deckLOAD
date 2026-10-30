import { describe, it, expect } from 'vitest'
import { appliedVessel, appliedVesselOf, isBuiltInVessel, libraryFile, vesselDataLine, vesselFromDeck } from './vesselLibrary'
import { VESSEL_TEMPLATES } from './vesselTemplates'
import { readLibraryFile } from '@/store/vesselLibrary'
import type { DeckConfig } from '@/store/calculator'

// Revision 2026-10-30 (spec 8.1): the user's own vessels in the library.

const kuznetsov = VESSEL_TEMPLATES.find((t) => t.id === 'aleksey-kuznetsov')!

// The user's own deck, in centimetres.
const own: DeckConfig = {
  width: 1600,
  length: 4000,
  unit: 'cm',
  gap: 10,
  boardOffset: 20,
  clearance: 300,
  maxDeckCargoT: 1200,
  outline: [{ x: 0, y: 0 }, { x: 1600, y: 0 }, { x: 1600, y: 4000 }, { x: 0, y: 3000 }],
  restrictionZones: [{ id: 'crane', name: 'Кран', shapeType: 'rect', x: 100, y: 200, width: 300, length: 400 }],
  loadZones: [{ id: 'aft', x: 0, y: 0, width: 1600, length: 1000, maxLoadPerArea: 5 }],
  powerSockets: [{ id: 's', x: 0, y: 100, label: '1' }],
  annotations: [{ id: 'a', kind: 'note', text: 'Кран', x: 1, y: 1 }],
  backgroundImage: 'data:image/jpeg;base64,AAAA',
  vessel: kuznetsov.vessel,
  shipFrame: { originOffsetFromMidshipsM: 20, heightAboveBaselineM: 7.5 },
  deckForwardIsPositiveY: false,
} as DeckConfig

describe('a vessel saved from a calculation', () => {
  it('takes the deck, its obstacles, zones and limits in metres, and the vessel\'s data — not what belongs to the plan', () => {
    const v = vesselFromDeck(own, { id: 'user-1', label: 'Нептун', note: 'Формуляр, ред. 2' })
    expect(v).toMatchObject({
      id: 'user-1',
      label: 'Нептун',
      note: 'Формуляр, ред. 2',
      deck: { width: 16, length: 40, outline: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 40 }, { x: 0, y: 30 }] },
      restrictionZones: [{ id: 'crane', name: 'Кран', x: 1, y: 2, width: 3, length: 4 }],
      loadZones: [{ id: 'aft', x: 0, y: 0, width: 16, length: 10, maxLoadPerArea: 5 }],
      limits: { maxDeckCargoT: 1200, maxStackHeightM: 3 },
      vessel: kuznetsov.vessel,
      shipFrame: { originOffsetFromMidshipsM: 20, heightAboveBaselineM: 7.5 },
      deckForwardIsPositiveY: false,
    })
    expect(v.savedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    for (const key of ['powerSockets', 'annotations', 'backgroundImage', 'lashingPoints']) expect(v).not.toHaveProperty(key)
  })

  // The choice of a disputed deck strength is made anew for each operation.
  it('keeps a library vessel\'s disputed deck strength to be chosen again, without the zone the last choice made', () => {
    const deck = {
      ...own,
      unit: 'm',
      width: 16.9,
      length: 49.1,
      outline: undefined,
      vesselTemplateId: kuznetsov.id,
      vesselInfo: appliedVesselOf(kuznetsov),
      deckStrengthChoiceTPerM2: 5,
      loadZones: [{ id: 'whole', x: 0, y: 0, width: 16.9, length: 49.1, maxLoadPerArea: 5 }],
    } as DeckConfig
    const v = vesselFromDeck(deck, { id: 'user-2', label: 'Кузнецов, наш', note: '' })
    expect(v.limits?.deckStrengthTPerM2).toEqual(kuznetsov.limits!.deckStrengthTPerM2)
    expect(v.loadZones).toEqual([])
  })

  it('says what its data covers', () => {
    expect(vesselDataLine({})).toBe('Без данных остойчивости')
    expect(vesselDataLine(kuznetsov)).toBe('Остойчивость: гидростатика 1 точка · предел · без KN · высота палубы 8.40 м')
    expect(vesselDataLine({ vessel: kuznetsov.vessel, shipFrame: {} })).toMatch(/высота палубы не задана$/)
  })
})

describe('the vessel a calculation was made for', () => {
  it('is its own copy, else — saved before calculations kept one — the built-in vessel it names', () => {
    const copy = { label: 'Нептун', bowFromData: true }
    expect(appliedVessel({ vesselInfo: copy, vesselTemplateId: kuznetsov.id })).toBe(copy)
    expect(appliedVessel({ vesselTemplateId: kuznetsov.id })).toEqual(appliedVesselOf(kuznetsov))
    // A user's vessel deleted from the library and no copy: the own deck.
    expect(appliedVessel({ vesselTemplateId: 'user-gone' })).toBeUndefined()
    expect(appliedVessel({})).toBeUndefined()
  })
})

describe('the library as a file', () => {
  it('reads back what it wrote, and refuses what is not a library', () => {
    const v = vesselFromDeck(own, { id: 'user-1', label: 'Нептун', note: '' })
    const read = readLibraryFile(libraryFile([v]))
    expect(read).toEqual({ vessels: [JSON.parse(JSON.stringify(v))] })
    expect(readLibraryFile('{not json')).toEqual({ error: 'Файл повреждён или это не JSON' })
    expect(readLibraryFile(JSON.stringify({ projects: [] }))).toEqual({ error: 'Это не файл библиотеки судов DeckLoad' })
    // The built-in vessels are the app's own, and anything not a vessel is dropped.
    expect(readLibraryFile(libraryFile([kuznetsov]))).toEqual({ error: 'В файле нет судов' })
    expect(readLibraryFile(JSON.stringify({ format: 'deckload-vessels', version: 1, vessels: [{ id: 'x' }, v] }))).toMatchObject({ vessels: [{ id: 'user-1' }] })
    expect(isBuiltInVessel(kuznetsov.id)).toBe(true)
    expect(isBuiltInVessel('user-1')).toBe(false)
  })
})
