import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { jsPDF } from 'jspdf'
import { buildPlanDrawing, hatch, PAPER_LABEL_SIZES, type PlanDrawing, type PlanShape } from './planDrawing'
import { drawPlanOnPdf } from './planToPdf'
import { cargoNumbers } from './cargoPalette'
import { computeZoneLoads, packMultiTrip, type CargoItem, type PlacedItem } from './packing'
import { autoPlacementKey } from './stackSelection'
import { deckForVessel } from './vesselDeck'
import { VESSEL_TEMPLATES } from './vesselTemplates'
import { createDemoItems, DEMO_DECK, type DeckConfig } from '@/store/calculator'
import { PlanShapes } from '@/components/report/PlanDrawingSvg'

// The scheme's box on an A4 landscape sheet: the width between the margins,
// about 60% of the height (spec 11).
const FRAME = { x: 28, y: 70, w: 786, h: 330 }

let next = 0
const genId = () => `id-${++next}`

function tripsOf(deck: DeckConfig, items: CargoItem[]) {
  return packMultiTrip(deck.width, deck.length, items, {
    gap: deck.gap,
    boardOffset: deck.boardOffset,
    clearance: deck.clearance,
    outline: deck.outline,
    restrictionZones: deck.restrictionZones,
    loadZones: deck.loadZones,
    unit: deck.unit,
  }).filter((t) => t.placedCount > 0)
}

function draw(deck: DeckConfig, items: CargoItem[], placed: PlacedItem[], extra: Partial<Parameters<typeof buildPlanDrawing>[0]> = {}) {
  return buildPlanDrawing({ deck, placed, numbers: cargoNumbers(items), frame: FRAME, ...extra })
}

const texts = (d: PlanDrawing) => d.shapes.filter((s): s is Extract<PlanShape, { kind: 'text' }> => s.kind === 'text')
const textOf = (d: PlanDrawing, t: string) => texts(d).find((s) => s.text === t)

// Spec 6.2's criterion, on paper: every stack's number is written — on the
// stack, over its group, or beside it — at 7 pt or more.
function expectEveryNumberWritten(d: PlanDrawing, placed: PlacedItem[]) {
  for (const p of placed) {
    const key = autoPlacementKey(p)
    const plan = d.labels.get(key)
    expect(plan?.kind !== 'none' || d.callouts.has(key), `${p.name} at ${p.x},${p.y}`).toBe(true)
    if (plan?.kind === 'own') expect(plan.fontSize).toBeGreaterThanOrEqual(7)
  }
  for (const g of d.groups) expect(g.fontSize).toBeGreaterThanOrEqual(7)
}

const typicalCargo = (): CargoItem[] => [
  { id: genId(), name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, quantity: 6, color: '#0ea5e9', allowRotation: true, weight: 2200 },
  { id: genId(), name: 'Паллета EUR', width: 1.2, length: 0.8, height: 0.14, quantity: 20, color: '#10b981', allowRotation: true, weight: 500 },
  { id: genId(), name: 'Обсадная труба', width: 9.5, length: 0.25, height: 0.25, quantity: 24, color: '#57534e', allowRotation: true, weight: 700, shape: 'cylinder' },
]

describe('buildPlanDrawing', () => {
  it('writes every number of the demo at 7 pt or more, the deck lying long side across the sheet', () => {
    const items = createDemoItems(genId)
    const deck = { ...DEMO_DECK } as DeckConfig
    const [trip] = tripsOf(deck, items)
    const d = draw(deck, items, trip.placed)
    expectEveryNumberWritten(d, trip.placed)
    // 8 × 20 m: the 20 m length runs along the sheet.
    expect(d.deck.w).toBeGreaterThan(d.deck.h)
    expect(d.deck.w / d.deck.h).toBeCloseTo(20 / 8, 5)
    expect(d.deck.x).toBeGreaterThanOrEqual(FRAME.x)
    expect(d.deck.x + d.deck.w).toBeLessThanOrEqual(FRAME.x + FRAME.w)
    expect(d.deck.y).toBeGreaterThanOrEqual(FRAME.y)
    expect(d.deck.y + d.deck.h).toBeLessThanOrEqual(FRAME.y + FRAME.h)
  })

  it.each(VESSEL_TEMPLATES.map((t) => [t.label, t] as const))('writes every number at 7 pt or more on %s with containers, pallets and pipe', (_, tpl) => {
    const items = typicalCargo()
    const deck = deckForVessel(tpl, { ...DEMO_DECK } as DeckConfig)
    const trips = tripsOf(deck, items)
    expect(trips.length).toBeGreaterThan(0)
    for (const t of trips) expectEveryNumberWritten(draw(deck, items, t.placed), t.placed)
  })

  it('names the hull sides where they are, with the deck dimensions and a scale bar', () => {
    const items = createDemoItems(genId)
    const deck = { ...DEMO_DECK, deckForwardIsPositiveY: true } as DeckConfig
    const d = draw(deck, items, tripsOf(deck, items)[0].placed)
    // Transposed with the bow at +y: the bow on the right edge, port on top.
    const bow = textOf(d, 'НОС')!
    const stern = textOf(d, 'КОРМА')!
    const port = textOf(d, 'ЛЕВЫЙ БОРТ')!
    const starboard = textOf(d, 'ПРАВЫЙ БОРТ')!
    expect(bow.x).toBeGreaterThan(d.deck.x + d.deck.w)
    expect(bow.vertical).toBe(true)
    expect(stern.x).toBeLessThan(d.deck.x)
    expect(port.y).toBeLessThan(d.deck.y)
    expect(starboard.y).toBeGreaterThan(d.deck.y + d.deck.h)
    // The dimensions: the length along the top, the width along the left.
    expect(textOf(d, '20 м')!.y).toBeLessThan(d.deck.y)
    expect(textOf(d, '8 м')!.vertical).toBe(true)
    // The scale bar under the deck, in whole grid steps (1 m for this deck).
    const bar = texts(d).find((t) => /^\d+ м$/.test(t.text) && t.y > d.deck.y + d.deck.h && t.anchor === 'start')
    expect(bar).toBeDefined()
  })

  it('turns the other way round when the bow is at −y', () => {
    const items = createDemoItems(genId)
    const deck = { ...DEMO_DECK, deckForwardIsPositiveY: false } as DeckConfig
    const d = draw(deck, items, tripsOf(deck, items)[0].placed)
    expect(textOf(d, 'НОС')!.x).toBeLessThan(d.deck.x)
    expect(textOf(d, 'КОРМА')!.x).toBeGreaterThan(d.deck.x + d.deck.w)
  })

  it('draws obstacles with their names and load zones with their limits; an overloaded zone marks its stacks', () => {
    const items: CargoItem[] = [{ id: genId(), name: 'Плита', width: 2, length: 2, height: 1, quantity: 1, color: '#000', allowRotation: false, weight: 30_000 }]
    const deck = {
      ...DEMO_DECK,
      restrictionZones: [{ id: 'z1', name: 'Кран', shapeType: 'rect', x: 5, y: 15, width: 2, length: 3 }],
      loadZones: [{ id: 'l1', x: 0, y: 0, width: 8, length: 20, maxLoadPerArea: 0.1 }],
    } as DeckConfig
    const [trip] = tripsOf(deck, items)
    const zoneLoads = computeZoneLoads(
      trip.placed.map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length, totalWeightKg: (p.weight ?? 0) * p.stackedCount })),
      deck.loadZones,
      deck.outline,
      deck.unit
    )
    expect(zoneLoads[0].exceeded).toBe(true)
    const d = draw(deck, items, trip.placed, { zoneLoads })
    expect(textOf(d, 'Кран')).toBeDefined()
    expect(texts(d).some((t) => t.text.startsWith('Зона 1 · ') && t.text.endsWith('из 0.1 т/м²'))).toBe(true)
    // The stack: a red outline and «!» in a red triangle.
    expect(d.shapes.some((s) => s.kind === 'rect' && s.stroke?.color === '#DC2626' && s.stroke.width > 1)).toBe(true)
    expect(textOf(d, '!')).toBeDefined()
  })

  it('marks stacks short of lashing and of unknown make-up', () => {
    const items = createDemoItems(genId)
    const deck = { ...DEMO_DECK } as DeckConfig
    const [trip] = tripsOf(deck, items)
    const container = trip.placed.find((p) => p.name === 'Контейнер 20ft')!
    const key = autoPlacementKey(container)
    const d = draw(deck, items, trip.placed, { lashingShort: new Set([key]), unknownMakeup: new Set([key]) })
    expect(d.shapes.some((s) => s.kind === 'rect' && s.fill === '#B45309')).toBe(true)
    expect(textOf(d, '?')).toBeDefined()
  })

  it('keeps the label sizes of paper: 12 pt down to 7', () => {
    expect(PAPER_LABEL_SIZES.numbers[0]).toBe(12)
    expect(PAPER_LABEL_SIZES.numbers[PAPER_LABEL_SIZES.numbers.length - 1]).toBe(7)
  })
})

describe('hatch', () => {
  it('cuts its lines to the polygon', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const lines = hatch(square, '#000', 1, 2, 45)
    expect(lines.length).toBeGreaterThan(5)
    for (const l of lines) {
      if (l.kind !== 'line') throw new Error('a line')
      for (const p of [l.from, l.to]) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-9)
        expect(p.x).toBeLessThanOrEqual(10 + 1e-9)
        expect(p.y).toBeGreaterThanOrEqual(-1e-9)
        expect(p.y).toBeLessThanOrEqual(10 + 1e-9)
      }
    }
  })
})

describe('the outputs', () => {
  const items = createDemoItems(genId)
  const deck = { ...DEMO_DECK } as DeckConfig
  const d = draw(deck, items, tripsOf(deck, items)[0].placed)

  it('draws into a PDF page as vector shapes and text', () => {
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
    drawPlanOnPdf(pdf, d, 'helvetica')
    const out = pdf.output()
    expect(out).toMatch(/ re\n/)
    expect(out).toMatch(/BT\n/)
  })

  it('draws as SVG with the same texts', () => {
    const svg = renderToStaticMarkup(<svg>{<PlanShapes shapes={d.shapes} />}</svg>)
    expect(svg).toContain('НОС')
    expect(svg).toContain('20 м')
  })
})
