// The vessel library the user keeps (spec 8.1, revision 2026-10-30): their
// own vessels beside the built-in ones, saved from a calculation's deck,
// renamed, updated, deleted, and passed to colleagues as a file.
//
// A calculation keeps a copy of what it took from the library (AppliedVessel,
// deckForVessel): editing or deleting a vessel in the library leaves every
// calculation made with it as it was — a plan already signed never changes
// its figures behind anyone's back.
import type { DeckConfig } from '@/store/calculator'
import { isWholeDeckZone, type LoadZone, type RestrictionZone } from './packing'
import { convertLength } from './units'
import { fmtNumber, pluralRu } from './utils'
import { VESSEL_TEMPLATES, vesselTemplateById, type VesselTemplate } from './vesselTemplates'

// What a calculation remembers of the library vessel applied to it, copied
// at the time: the name, where its data comes from, the deck strength its
// sources disagree on, its stack height limit, and whether its data gives
// the bow.
export interface AppliedVessel {
  label: string
  note?: string
  deckStrengthTPerM2?: { min: number; max: number; sources: string }
  maxStackHeightM?: number
  bowFromData: boolean
}

export function appliedVesselOf(tpl: VesselTemplate): AppliedVessel {
  return {
    label: tpl.label,
    note: tpl.note || undefined,
    deckStrengthTPerM2: tpl.limits?.deckStrengthTPerM2,
    maxStackHeightM: tpl.limits?.maxStackHeightM,
    bowFromData: tpl.deckForwardIsPositiveY !== undefined,
  }
}

// The vessel the calculation was made for: its own copy, or — for one saved
// before calculations kept a copy — the built-in vessel it names.
export function appliedVessel(deck: Pick<DeckConfig, 'vesselInfo' | 'vesselTemplateId'>): AppliedVessel | undefined {
  if (deck.vesselInfo) return deck.vesselInfo
  const tpl = vesselTemplateById(deck.vesselTemplateId)
  return tpl ? appliedVesselOf(tpl) : undefined
}

export const USER_VESSEL_PREFIX = 'user-'

export function isBuiltInVessel(id: string): boolean {
  return VESSEL_TEMPLATES.some((t) => t.id === id)
}

export function newUserVesselId(): string {
  return `${USER_VESSEL_PREFIX}${crypto.randomUUID()}`
}

// The vessel a calculation's deck describes, as the library keeps it — in
// metres: the deck's size and shape, its obstacles and load zones, its
// limits, the vessel's stability data, the deck's place on the hull and its
// bow. What belongs to a plan stays out: cargo, marks, sockets, lashing
// points, the deck's photo (too large for the browser's storage).
export function vesselFromDeck(deck: DeckConfig, entry: { id: string; label: string; note: string }): VesselTemplate {
  const m = (v: number) => convertLength(v, deck.unit, 'm')
  const point = (p: { x: number; y: number }) => ({ x: m(p.x), y: m(p.y) })
  const zone = <Z extends { x: number; y: number; width: number; length: number }>(z: Z): Z => ({ ...z, x: m(z.x), y: m(z.y), width: m(z.width), length: m(z.length) })
  const applied = appliedVessel(deck)
  const limits: NonNullable<VesselTemplate['limits']> = {
    deckStrengthTPerM2: applied?.deckStrengthTPerM2,
    maxDeckCargoT: deck.maxDeckCargoT,
    maxStackHeightM: deck.clearance > 0 ? m(deck.clearance) : undefined,
    tenFootContainerCapacity: deck.tenFootContainerCapacity,
  }
  return {
    id: entry.id,
    label: entry.label,
    note: entry.note,
    deck: { width: m(deck.width), length: m(deck.length), outline: deck.outline?.map(point) },
    restrictionZones: deck.restrictionZones?.map((z: RestrictionZone) => ({ ...zone(z), ...(z.outline ? { outline: z.outline.map(point) } : {}) })),
    // The zone over the whole deck a disputed deck strength's choice made
    // is that choice's: it is made anew for each operation (VesselCard).
    loadZones: deck.loadZones
      ?.filter((z: LoadZone) => !(applied?.deckStrengthTPerM2 && isWholeDeckZone(z, deck.width, deck.length)))
      .map((z: LoadZone) => zone(z)),
    vessel: deck.vessel,
    shipFrame: deck.shipFrame,
    // The bow as the deck shows it: the user's own deck has no other.
    deckForwardIsPositiveY: deck.deckForwardIsPositiveY ?? true,
    limits: Object.values(limits).some((v) => v !== undefined) ? limits : undefined,
    savedAt: new Date().toISOString(),
  }
}

// What a vessel's data covers, in a line for its row and the save dialog:
// «Остойчивость: гидростатика 1 точка · предел · без KN · высота палубы 8.4 м».
export function vesselDataLine(tpl: Pick<VesselTemplate, 'vessel' | 'shipFrame'>): string {
  const v = tpl.vessel
  if (!v) return 'Без данных остойчивости'
  const points = v.hydrostatics.points.length
  const height = tpl.shipFrame?.heightAboveBaselineM
  return [
    `Остойчивость: гидростатика ${points === 0 ? 'не задана' : `${points} ${pluralRu(points, 'точка', 'точки', 'точек')}`}`,
    v.limit && v.limit.rows.length > 0 ? 'предел' : 'без предела',
    v.knCurves ? 'KN' : 'без KN',
    height !== undefined && height > 0 ? `высота палубы ${fmtNumber(height)} м` : 'высота палубы не задана',
  ].join(' · ')
}

// The library as a file (spec 8.1): the user's own vessels, for a colleague
// or another browser.
export const LIBRARY_FILE_FORMAT = 'deckload-vessels'

export function libraryFile(vessels: readonly VesselTemplate[]): string {
  return JSON.stringify({ format: LIBRARY_FILE_FORMAT, version: 1, vessels }, null, 2)
}
