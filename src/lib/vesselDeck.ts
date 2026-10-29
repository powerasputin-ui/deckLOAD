// What applying a library vessel does to a deck (spec 8.1). It replaces what
// belongs to the vessel — the deck's size, outline and obstacles, its stack
// height and cargo limits, its stability data, frame and bow — drops what was
// tied to the old deck — the photo, load zones, sockets, lashing points and
// marks — and keeps the calculation's own settings: units, gaps, the voyage's
// conditions. The vessel's figures are in metres; they come over in the
// deck's unit. Pure, so the dialog can say what goes before anything does.
import type { DeckConfig } from '@/store/calculator'
import type { RestrictionZone } from './packing'
import { convertLength } from './units'
import { pluralRu } from './utils'
import type { VesselTemplate } from './vesselTemplates'

export function deckForVessel(tpl: VesselTemplate, current: DeckConfig): DeckConfig {
  const len = (m: number) => convertLength(m, 'm', current.unit)
  const point = (p: { x: number; y: number }) => ({ x: len(p.x), y: len(p.y) })
  const zone = (z: RestrictionZone): RestrictionZone => ({
    ...z,
    x: len(z.x),
    y: len(z.y),
    width: len(z.width),
    length: len(z.length),
    ...(z.outline ? { outline: z.outline.map(point) } : {}),
  })
  return {
    unit: current.unit,
    gap: current.gap,
    boardOffset: current.boardOffset,
    vesselMotion: current.vesselMotion,
    icing: current.icing,
    width: len(tpl.deck.width),
    length: len(tpl.deck.length),
    outline: tpl.deck.outline?.map(point),
    restrictionZones: tpl.restrictionZones?.map(zone),
    // The vessel's own approved figures bind as soon as it is applied — the
    // library already promises them: a stack no higher than allowed, no more
    // cargo than the deck takes.
    clearance: tpl.limits?.maxStackHeightM !== undefined ? len(tpl.limits.maxStackHeightM) : 0,
    maxDeckCargoT: tpl.limits?.maxDeckCargoT,
    tenFootContainerCapacity: tpl.limits?.tenFootContainerCapacity,
    vessel: tpl.vessel,
    shipFrame: tpl.shipFrame,
    deckForwardIsPositiveY: tpl.deckForwardIsPositiveY,
    vesselTemplateId: tpl.id,
    // A new vessel's deck strength is chosen anew when its sources disagree.
    deckStrengthChoiceTPerM2: undefined,
  }
}

// What the old deck loses, in words for the dialog: «фото палубы»,
// «2 зоны нагрузки», «12 закреплений»… The positions are the current mode's:
// the pins of every trip, or the stacks placed by hand.
export function deckForVesselDrops(current: DeckConfig, positions: { mode: 'auto' | 'manual'; count: number }): string[] {
  const count = (n: number, one: string, few: string, many: string) => (n > 0 ? [`${n} ${pluralRu(n, one, few, many)}`] : [])
  return [
    ...(current.backgroundImage ? ['фото палубы'] : []),
    ...count(current.loadZones?.length ?? 0, 'зона нагрузки', 'зоны нагрузки', 'зон нагрузки'),
    ...count(current.powerSockets?.length ?? 0, 'розетка', 'розетки', 'розеток'),
    ...count(current.lashingPoints?.length ?? 0, 'точка крепления', 'точки крепления', 'точек крепления'),
    ...count(current.annotations?.length ?? 0, 'метка', 'метки', 'меток'),
    ...(positions.mode === 'auto'
      ? count(positions.count, 'закрепление', 'закрепления', 'закреплений')
      : count(positions.count, 'ручная позиция', 'ручные позиции', 'ручных позиций')),
  ]
}

// A calculation still called what it was called at birth («Расчёт 3») takes
// the vessel's name.
export function isDefaultCalculationName(name: string): boolean {
  return /^Расчёт \d+$/.test(name.trim())
}
