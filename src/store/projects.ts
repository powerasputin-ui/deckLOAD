import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { toast } from 'sonner'
import type { CargoItem, CargoShape, ManualPlacement, SortStrategy, PinnedPlacement, SeparationRule, VesselMotionPreset, RestrictionZoneShape, StabilityOverride, ClearanceMargin, WireRopeType, AnnotationKind } from '@/lib/packing'
import { WIRE_ROPE_SPECS } from '@/lib/packing'
import type { PipeNestSpec } from '@/lib/pipeNest'
import type { VesselStabilityData, DeckShipFrame, KNCrossCurves, VariableWeightItem } from '@/lib/stability'
import type { DeckConfig, Mode, Unit } from './calculator'
import { DEMO_DECK, createDemoItems } from './calculator'

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  deck: DeckConfig
  items: CargoItem[]
  manualPlacements: ManualPlacement[]
  // Pinned placements keyed by trip index (multi-trip: each trip is its own deck).
  pinnedPlacementsByTrip: Record<number, PinnedPlacement[]>
  separationRules: SeparationRule[]
  mode: Mode
  sortStrategy: SortStrategy
  globalRotation: boolean
  showFreeSpace: boolean
  showGrid: boolean
  showLabels: boolean
  showCargoContents: boolean
}

export interface SaveSnapshotData {
  id: string
  deck: DeckConfig
  items: CargoItem[]
  manualPlacements: ManualPlacement[]
  pinnedPlacementsByTrip: Record<number, PinnedPlacement[]>
  separationRules: SeparationRule[]
  mode: Mode
  sortStrategy: SortStrategy
  globalRotation: boolean
  showFreeSpace: boolean
  showGrid: boolean
  showLabels: boolean
  showCargoContents: boolean
}

// Module-level (not React-state) pending-autosave buffer. page.tsx's autosave
// effect debounces by calling scheduleAutosave() on every relevant change
// instead of managing its own setTimeout — the point of hoisting this out of
// React is that switchTo/deleteProject/createProject below are plain store
// actions, not hooks, so they can synchronously flushPendingAutosave() the
// LAST edited project's data before they change `activeId`. Previously the
// only flush path was a `useEffect` cleanup keyed on `activeId`, which reran
// in the same commit as (and in an order relative to) the project-load
// effect that already overwrites the calculator store with the NEW project's
// data — by the time that cleanup ran, the pending timer was simply cleared,
// never saved, silently dropping up to 400ms of the previous project's edits
// on every project switch/delete/create. A `beforeunload`/`pagehide` flush
// closes the matching gap for closing/reloading the tab within that window.
let pendingAutosave: { id: string; data: SaveSnapshotData } | null = null
let pendingAutosaveTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleAutosave(data: SaveSnapshotData, save: (d: SaveSnapshotData) => void): void {
  pendingAutosave = { id: data.id, data }
  if (pendingAutosaveTimer) clearTimeout(pendingAutosaveTimer)
  pendingAutosaveTimer = setTimeout(() => {
    pendingAutosaveTimer = null
    flushPendingAutosave(save)
  }, 400)
}

export function flushPendingAutosave(save: (d: SaveSnapshotData) => void): void {
  if (pendingAutosaveTimer) {
    clearTimeout(pendingAutosaveTimer)
    pendingAutosaveTimer = null
  }
  if (pendingAutosave) {
    const { data } = pendingAutosave
    pendingAutosave = null
    save(data)
  }
}

if (typeof window !== 'undefined') {
  // `save` is resolved lazily from the live store rather than captured once,
  // since this listener is registered at module-load time, before the store
  // (defined below) exists.
  const flushOnLeave = () => flushPendingAutosave((d) => useProjects.getState().saveSnapshot(d))
  window.addEventListener('beforeunload', flushOnLeave)
  window.addEventListener('pagehide', flushOnLeave)
}

interface ProjectsState {
  projects: Project[]
  activeId: string | null
  hydrated: boolean

  hydrate: () => void
  createProject: (name?: string) => string
  renameProject: (id: string, name: string) => void
  deleteProject: (id: string) => void
  switchTo: (id: string) => void
  saveSnapshot: (data: SaveSnapshotData) => void
  duplicateProject: (id: string) => string | null
  importProject: (raw: unknown) => string | null
  getActive: () => Project | null
}

const STORAGE_KEY = 'deckload-projects'
const VALID_UNITS: Unit[] = ['m', 'cm', 'ft']
const VALID_MODES: Mode[] = ['auto', 'manual']
const VALID_SORTS: SortStrategy[] = ['area-desc', 'area-asc', 'width-desc', 'length-desc', 'quantity-desc', 'none']

function toFiniteNonNegative(value: unknown, fallback: number): number {
  const v = typeof value === 'number' ? value : fallback
  return Number.isFinite(v) && v >= 0 ? v : fallback
}

function toFinitePositive(value: unknown, fallback: number): number {
  const v = typeof value === 'number' ? value : fallback
  return Number.isFinite(v) && v > 0 ? v : fallback
}

function toPositiveInt(value: unknown, fallback: number): number {
  const v = typeof value === 'number' ? value : fallback
  if (!Number.isFinite(v) || v <= 0) return fallback
  return Math.max(1, Math.round(v))
}

function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const VALID_SHAPES = new Set<CargoShape>(['box', 'cylinder', 'circle', 'oval', 'triangle', 'diamond', 'custom', 'pipe-nest'])
function normalizeShape(value: unknown): CargoShape | undefined {
  return typeof value === 'string' && VALID_SHAPES.has(value as CargoShape) ? (value as CargoShape) : undefined
}

// A hand-drawn custom outline — dropped by this same allowlist-normalizer
// before this fix, which silently reverted every persisted 'custom'-shape
// item back to a plain box (and broke its precise collision) on the very
// next project load.
function normalizeOutline(value: unknown): { x: number; y: number }[] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined
  const points = value
    .map((p) => {
      if (!p || typeof p !== 'object') return null
      const x = (p as { x?: unknown }).x
      const y = (p as { y?: unknown }).y
      if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return null
      return { x, y }
    })
    .filter((p): p is { x: number; y: number } => p !== null)
  return points.length >= 3 ? points : undefined
}

// Coerce persisted load zones — dropped entirely before this fix, so old
// saved projects simply won't have this field (Array.isArray guards that).
function normalizeLoadZones(value: unknown): DeckConfig['loadZones'] {
  if (!Array.isArray(value)) return undefined
  const zones = value
    .map((z) => {
      const zone = z as Record<string, unknown>
      return {
        id: typeof zone.id === 'string' && zone.id ? zone.id : uuid(),
        x: toFiniteNonNegative(zone.x, 0),
        y: toFiniteNonNegative(zone.y, 0),
        width: toFinitePositive(zone.width, 1),
        length: toFinitePositive(zone.length, 1),
        maxLoadPerArea: toFinitePositive(zone.maxLoadPerArea, 5),
      }
    })
  return zones.length > 0 ? zones : undefined
}

const VALID_VESSEL_MOTION_PRESETS = new Set<VesselMotionPreset>(['open-sea', 'coastal', 'sheltered', 'custom'])

// Coerce persisted vessel motion (acceleration coefficients + friction used
// by the lashing check) — was never added to this allowlist, so it silently
// vanished on the very next project reload even though the feature itself
// worked fine in the same session (same bug class as loadZones/outline
// above before those were fixed).
function normalizeVesselMotion(value: unknown): DeckConfig['vesselMotion'] {
  if (!value || typeof value !== 'object') return undefined
  const vm = value as Record<string, unknown>
  const preset =
    typeof vm.preset === 'string' && VALID_VESSEL_MOTION_PRESETS.has(vm.preset as VesselMotionPreset)
      ? (vm.preset as VesselMotionPreset)
      : 'coastal'
  return {
    ax: toFiniteNonNegative(vm.ax, 0.2),
    ay: toFiniteNonNegative(vm.ay, 0.35),
    az: toFiniteNonNegative(vm.az, 0.2),
    friction: toFiniteNonNegative(vm.friction, 0.3),
    preset,
  }
}

// General finite-number coercion allowing negative values (LCG/TCG-style
// offsets legitimately go negative — unlike the length/weight fields above,
// which are always toFiniteNonNegative/toFinitePositive).
function toFinite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

const VALID_LONGITUDINAL_ORIGINS = new Set(['midships', 'aft-perpendicular'])

function normalizeVesselParticulars(value: unknown): VesselStabilityData['particulars'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const p = value as Record<string, unknown>
  const longitudinalOrigin =
    typeof p.longitudinalOrigin === 'string' && VALID_LONGITUDINAL_ORIGINS.has(p.longitudinalOrigin)
      ? (p.longitudinalOrigin as VesselStabilityData['particulars']['longitudinalOrigin'])
      : 'midships'
  return {
    name: toOptionalString(p.name),
    lengthBpp: toFiniteNonNegative(p.lengthBpp, 0),
    breadth: toFiniteNonNegative(p.breadth, 0),
    lightshipWeightKg: toFiniteNonNegative(p.lightshipWeightKg, 0),
    lightshipKG: toFiniteNonNegative(p.lightshipKG, 0),
    lightshipLCG: toFinite(p.lightshipLCG, 0),
    lightshipTCG: toFinite(p.lightshipTCG, 0),
    longitudinalOrigin,
    downfloodingAngleDeg:
      typeof p.downfloodingAngleDeg === 'number' && Number.isFinite(p.downfloodingAngleDeg) ? p.downfloodingAngleDeg : undefined,
  }
}

function normalizeVariableWeights(value: unknown): VariableWeightItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === 'object')
    .map((w) => ({
      id: typeof w.id === 'string' && w.id ? w.id : uuid(),
      name: typeof w.name === 'string' ? w.name : 'Танк',
      weightKg: toFiniteNonNegative(w.weightKg, 0),
      vcgM: toFiniteNonNegative(w.vcgM, 0),
      tcgM: toFinite(w.tcgM, 0),
      lcgM: toFinite(w.lcgM, 0),
      freeSurfaceMomentTm:
        typeof w.freeSurfaceMomentTm === 'number' && Number.isFinite(w.freeSurfaceMomentTm) ? w.freeSurfaceMomentTm : undefined,
    }))
}

function normalizeHydrostaticTable(value: unknown): VesselStabilityData['hydrostatics'] {
  if (!Array.isArray(value)) return { points: [] }
  const points = value
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null
      const pt = raw as Record<string, unknown>
      if (typeof pt.displacementKg !== 'number' || !Number.isFinite(pt.displacementKg)) return null
      if (typeof pt.KM !== 'number' || !Number.isFinite(pt.KM)) return null
      return {
        displacementKg: toFiniteNonNegative(pt.displacementKg, 0),
        draftM: toFiniteNonNegative(pt.draftM, 0),
        KM: toFiniteNonNegative(pt.KM, 0),
        LCB: typeof pt.LCB === 'number' && Number.isFinite(pt.LCB) ? pt.LCB : undefined,
        LCF: typeof pt.LCF === 'number' && Number.isFinite(pt.LCF) ? pt.LCF : undefined,
        MTC: typeof pt.MTC === 'number' && Number.isFinite(pt.MTC) && pt.MTC > 0 ? pt.MTC : undefined,
      }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
  return { points }
}

// Drops individual malformed KN rows (a row whose KNByAngle length doesn't
// match headingAngles) rather than discarding the whole table — one bad row
// shouldn't cost the user every other correctly-entered one.
function normalizeKNCrossCurves(value: unknown): KNCrossCurves | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.headingAngles) || raw.headingAngles.length === 0) return undefined
  const headingAngles = raw.headingAngles.filter((a): a is number => typeof a === 'number' && Number.isFinite(a))
  if (headingAngles.length === 0) return undefined
  if (!Array.isArray(raw.points)) return undefined
  const points = raw.points
    .map((p) => {
      if (!p || typeof p !== 'object') return null
      const pt = p as Record<string, unknown>
      if (typeof pt.displacementKg !== 'number' || !Number.isFinite(pt.displacementKg)) return null
      if (!Array.isArray(pt.KNByAngle) || pt.KNByAngle.length !== headingAngles.length) return null
      const KNByAngle = pt.KNByAngle.filter((k): k is number => typeof k === 'number' && Number.isFinite(k))
      if (KNByAngle.length !== headingAngles.length) return null
      return { displacementKg: pt.displacementKg, KNByAngle }
    })
    .filter((p): p is { displacementKg: number; KNByAngle: number[] } => p !== null)
  return points.length > 0 ? { headingAngles, points } : undefined
}

// particulars are the mandatory minimum — a vessel entry with no usable
// particulars isn't a usable vessel entry at all, so the whole thing
// normalizes to undefined rather than a half-populated shell.
function normalizeVessel(value: unknown): VesselStabilityData | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const particulars = normalizeVesselParticulars(v.particulars)
  if (!particulars) return undefined
  return {
    particulars,
    hydrostatics: normalizeHydrostaticTable((v.hydrostatics as Record<string, unknown> | undefined)?.points),
    knCurves: normalizeKNCrossCurves(v.knCurves),
    variableWeights: normalizeVariableWeights(v.variableWeights),
  }
}

function normalizeShipFrame(value: unknown): DeckShipFrame | undefined {
  if (!value || typeof value !== 'object') return undefined
  const f = value as Record<string, unknown>
  return {
    originOffsetFromCenterlineM: toFinite(f.originOffsetFromCenterlineM, 0),
    originOffsetFromMidshipsM: toFinite(f.originOffsetFromMidshipsM, 0),
    heightAboveBaselineM: toFiniteNonNegative(f.heightAboveBaselineM, 0),
  }
}

function normalizeStabilityOverride(value: unknown): StabilityOverride | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as Record<string, unknown>
  const vcgAboveDeckM = typeof o.vcgAboveDeckM === 'number' && Number.isFinite(o.vcgAboveDeckM) ? o.vcgAboveDeckM : undefined
  const tcgOffsetM = typeof o.tcgOffsetM === 'number' && Number.isFinite(o.tcgOffsetM) ? o.tcgOffsetM : undefined
  const lcgOffsetM = typeof o.lcgOffsetM === 'number' && Number.isFinite(o.lcgOffsetM) ? o.lcgOffsetM : undefined
  if (vcgAboveDeckM === undefined && tcgOffsetM === undefined && lcgOffsetM === undefined) return undefined
  return { vcgAboveDeckM, tcgOffsetM, lcgOffsetM }
}

function normalizeWireRopeType(value: unknown): WireRopeType | undefined {
  return typeof value === 'string' && value in WIRE_ROPE_SPECS ? (value as WireRopeType) : undefined
}

// A pipe штабель's computed geometry (src/lib/pipeNest.ts) — stored, not
// recomputed on load, so a saved plan reproduces byte-identically even if
// the geometry function is later refined. Dropped entirely (not
// reconstructed from partial data) if any required numeric field is
// missing/corrupt — a half-formed nest with no tierCounts is worse than no
// nest at all, since it would silently fall back to the flat-column VCG
// default while still claiming shape 'pipe-nest'.
function normalizeNestSpec(value: unknown): PipeNestSpec | undefined {
  if (!value || typeof value !== 'object') return undefined
  const n = value as Record<string, unknown>
  const pipeOuterDiameterM = typeof n.pipeOuterDiameterM === 'number' && Number.isFinite(n.pipeOuterDiameterM) ? n.pipeOuterDiameterM : undefined
  const pipeLengthM = typeof n.pipeLengthM === 'number' && Number.isFinite(n.pipeLengthM) ? n.pipeLengthM : undefined
  const pipeWeightKg = typeof n.pipeWeightKg === 'number' && Number.isFinite(n.pipeWeightKg) ? n.pipeWeightKg : undefined
  const usableWidthM = typeof n.usableWidthM === 'number' && Number.isFinite(n.usableWidthM) ? n.usableWidthM : undefined
  const pipesPerRow = typeof n.pipesPerRow === 'number' && Number.isFinite(n.pipesPerRow) ? n.pipesPerRow : undefined
  const heightM = typeof n.heightM === 'number' && Number.isFinite(n.heightM) ? n.heightM : undefined
  const vcgAboveDeckM = typeof n.vcgAboveDeckM === 'number' && Number.isFinite(n.vcgAboveDeckM) ? n.vcgAboveDeckM : undefined
  const crateHeightM = typeof n.crateHeightM === 'number' && Number.isFinite(n.crateHeightM) ? n.crateHeightM : undefined
  const pipeCount = typeof n.pipeCount === 'number' && Number.isFinite(n.pipeCount) ? n.pipeCount : undefined
  const requestedPipeCount = typeof n.requestedPipeCount === 'number' && Number.isFinite(n.requestedPipeCount) ? n.requestedPipeCount : undefined
  const requestedTiers = typeof n.requestedTiers === 'number' && Number.isFinite(n.requestedTiers) ? n.requestedTiers : undefined
  const tierCounts = Array.isArray(n.tierCounts) && n.tierCounts.every((r) => typeof r === 'number' && Number.isFinite(r))
    ? (n.tierCounts as number[])
    : undefined
  if (
    pipeOuterDiameterM === undefined || pipeLengthM === undefined || pipeWeightKg === undefined ||
    usableWidthM === undefined || pipesPerRow === undefined || heightM === undefined || vcgAboveDeckM === undefined ||
    crateHeightM === undefined || pipeCount === undefined || requestedPipeCount === undefined ||
    requestedTiers === undefined || tierCounts === undefined
  ) return undefined
  return {
    pipeOuterDiameterM,
    pipeLengthM,
    pipeWeightKg,
    usableWidthM,
    pipesPerRow,
    tierCounts,
    pipeCount,
    heightM,
    vcgAboveDeckM,
    crateHeightM,
    limited: typeof n.limited === 'boolean' ? n.limited : false,
    requestedPipeCount,
    requestedTiers,
    sourceNote: toOptionalString(n.sourceNote),
  }
}

function normalizeClearanceMargin(value: unknown): ClearanceMargin | undefined {
  if (!value || typeof value !== 'object') return undefined
  const m = value as Record<string, unknown>
  return {
    top: toFiniteNonNegative(m.top, 0),
    right: toFiniteNonNegative(m.right, 0),
    bottom: toFiniteNonNegative(m.bottom, 0),
    left: toFiniteNonNegative(m.left, 0),
  }
}

// A placement's own weight override — unlike CargoItem.weight (already
// finite-checked), this passed straight through the `...` spread before,
// so a corrupted/hand-edited import with e.g. weight: "abc" or NaN would
// round-trip as-is and silently poison downstream arithmetic (zone-load
// totals, the stability engine) with NaN/Infinity, with nothing in the UI
// ever flagging it as wrong.
function normalizeOptionalWeight(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function normalizeLashingPoints(value: unknown): DeckConfig['lashingPoints'] {
  if (!Array.isArray(value)) return undefined
  const points = value.map((p) => {
    const point = p as Record<string, unknown>
    return {
      id: typeof point.id === 'string' && point.id ? point.id : uuid(),
      x: toFiniteNonNegative(point.x, 0),
      y: toFiniteNonNegative(point.y, 0),
      label: toOptionalString(point.label),
    }
  })
  return points.length > 0 ? points : undefined
}

function normalizePowerSockets(value: unknown): DeckConfig['powerSockets'] {
  if (!Array.isArray(value)) return undefined
  const sockets = value.map((s) => {
    const socket = s as Record<string, unknown>
    return {
      id: typeof socket.id === 'string' && socket.id ? socket.id : uuid(),
      x: toFiniteNonNegative(socket.x, 0),
      y: toFiniteNonNegative(socket.y, 0),
      label: toOptionalString(socket.label),
    }
  })
  return sockets.length > 0 ? sockets : undefined
}

const ANNOTATION_KINDS = new Set(['bow', 'stern', 'port', 'starboard', 'note'])

function normalizeOptionalCoord(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeAnnotations(value: unknown): DeckConfig['annotations'] {
  if (!Array.isArray(value)) return undefined
  const annotations = value.map((a) => {
    const ann = a as Record<string, unknown>
    const leaderX = normalizeOptionalCoord(ann.leaderX)
    const leaderY = normalizeOptionalCoord(ann.leaderY)
    return {
      id: typeof ann.id === 'string' && ann.id ? ann.id : uuid(),
      // Unlike every other deck-local x/y in this file, an annotation is
      // deliberately allowed to sit OUTSIDE the deck rectangle (see
      // DeckVisualization.tsx's handleAnnotationClick) — it's a free-form
      // note, not cargo, so a negative or off-deck coordinate is real data,
      // not corruption.
      x: toFinite(ann.x, 0),
      y: toFinite(ann.y, 0),
      text: typeof ann.text === 'string' ? ann.text : '',
      kind: typeof ann.kind === 'string' && ANNOTATION_KINDS.has(ann.kind) ? (ann.kind as AnnotationKind) : undefined,
      // A leader needs BOTH coordinates to mean anything — a lone leaderX
      // with no leaderY isn't half a leader, it's no leader.
      leaderX: leaderX !== undefined && leaderY !== undefined ? leaderX : undefined,
      leaderY: leaderX !== undefined && leaderY !== undefined ? leaderY : undefined,
    }
  })
  return annotations.length > 0 ? annotations : undefined
}

const RESTRICTION_ZONE_SHAPES = new Set(['rect', 'triangle', 'oval', 'diamond', 'custom'])

function normalizeRestrictionZones(value: unknown): DeckConfig['restrictionZones'] {
  if (!Array.isArray(value)) return undefined
  const zones = value.map((z) => {
    const zone = z as Record<string, unknown>
    return {
      id: typeof zone.id === 'string' && zone.id ? zone.id : uuid(),
      name: typeof zone.name === 'string' && zone.name ? zone.name : 'Зона ограничения',
      shapeType: (typeof zone.shapeType === 'string' && RESTRICTION_ZONE_SHAPES.has(zone.shapeType) ? zone.shapeType : 'rect') as RestrictionZoneShape,
      x: toFiniteNonNegative(zone.x, 0),
      y: toFiniteNonNegative(zone.y, 0),
      width: toFinitePositive(zone.width, 1),
      length: toFinitePositive(zone.length, 1),
      outline: normalizeOutline(zone.outline),
    }
  })
  return zones.length > 0 ? zones : undefined
}

function normalizePinnedList(value: unknown): PinnedPlacement[] {
  if (!Array.isArray(value)) return []
  return value.map((pp) => {
    const pin = pp as Record<string, unknown>
    return {
      ...(pin as object),
      id: typeof pin.id === 'string' && pin.id ? pin.id : uuid(),
      itemId: typeof pin.itemId === 'string' ? pin.itemId : '',
      name: typeof pin.name === 'string' ? pin.name : 'Груз',
      x: toFiniteNonNegative(pin.x, 0),
      y: toFiniteNonNegative(pin.y, 0),
      width: toFinitePositive(pin.width, 1),
      length: toFinitePositive(pin.length, 1),
      layers: toPositiveInt(pin.layers, 1),
      rotated: typeof pin.rotated === 'boolean' ? pin.rotated : false,
      color: typeof pin.color === 'string' ? pin.color : '#0ea5e9',
      weight: normalizeOptionalWeight(pin.weight),
      clearanceMargin: normalizeClearanceMargin(pin.clearanceMargin),
      stabilityOverride: normalizeStabilityOverride(pin.stabilityOverride),
      lashingWireType: normalizeWireRopeType(pin.lashingWireType),
      lashingJustification: typeof pin.lashingJustification === 'string' ? pin.lashingJustification : undefined,
    } as PinnedPlacement
  })
}

// Mirrors normalizePinnedList's strictness — previously this mapping only
// spread `...m` and overrode a handful of numeric/boolean fields, leaving
// `itemId`/`name`/`color` completely unvalidated. A corrupted or hand-edited
// project (itemId missing/wrong-typed) would then round-trip an `itemId`
// typed as `string` but actually `undefined`; every downstream
// `items.find(it => it.id === mp.itemId)` lookup that doesn't optional-chain
// its result then throws at render time — with no error boundary anywhere
// in the app, that crashes the entire tree, not just one placement.
function normalizeManualPlacements(value: unknown): ManualPlacement[] {
  if (!Array.isArray(value)) return []
  return value.map((mm) => {
    const m = mm as Record<string, unknown>
    return {
      ...(m as object),
      id: typeof m.id === 'string' && m.id ? m.id : uuid(),
      itemId: typeof m.itemId === 'string' ? m.itemId : '',
      name: typeof m.name === 'string' ? m.name : 'Груз',
      x: toFiniteNonNegative(m.x, 0),
      y: toFiniteNonNegative(m.y, 0),
      width: toFinitePositive(m.width, 1),
      length: toFinitePositive(m.length, 1),
      layers: toPositiveInt(m.layers, 1),
      rotated: typeof m.rotated === 'boolean' ? m.rotated : false,
      color: typeof m.color === 'string' ? m.color : '#0ea5e9',
      weight: normalizeOptionalWeight(m.weight),
      clearanceMargin: normalizeClearanceMargin(m.clearanceMargin),
      stabilityOverride: normalizeStabilityOverride(m.stabilityOverride),
      lashingWireType: normalizeWireRopeType(m.lashingWireType),
      lashingJustification: typeof m.lashingJustification === 'string' ? m.lashingJustification : undefined,
    } as ManualPlacement
  })
}

// Accepts either the current per-trip shape (`{ 0: [...], 1: [...] }`) or the
// pre-multi-trip flat array (`pinnedPlacements: [...]`) for backward
// compatibility with projects saved before trips existed — migrated to `{0: [...]}`.
function normalizePinnedPlacementsByTrip(
  byTrip: unknown,
  legacyFlat: unknown
): Record<number, PinnedPlacement[]> {
  if (byTrip && typeof byTrip === 'object' && !Array.isArray(byTrip)) {
    const out: Record<number, PinnedPlacement[]> = {}
    for (const [key, value] of Object.entries(byTrip as Record<string, unknown>)) {
      const trip = Number(key)
      if (!Number.isFinite(trip)) continue
      const list = normalizePinnedList(value)
      if (list.length > 0) out[trip] = list
    }
    return out
  }
  const legacy = normalizePinnedList(legacyFlat)
  return legacy.length > 0 ? { 0: legacy } : {}
}

function normalizeSeparationRules(value: unknown): SeparationRule[] {
  if (!Array.isArray(value)) return []
  return value.map((r) => {
    const rule = r as Record<string, unknown>
    return {
      id: typeof rule.id === 'string' && rule.id ? rule.id : uuid(),
      categoryA: typeof rule.categoryA === 'string' ? rule.categoryA : '',
      categoryB: typeof rule.categoryB === 'string' ? rule.categoryB : '',
      minDistance: toFiniteNonNegative(rule.minDistance, 0),
    }
  })
}

function freshProject(name: string, withDemo = false): Project {
  const now = Date.now()
  return {
    id: uuid(),
    name,
    createdAt: now,
    updatedAt: now,
    deck: { ...DEMO_DECK },
    items: withDemo ? createDemoItems(uuid) : [],
    manualPlacements: [],
    pinnedPlacementsByTrip: {},
    separationRules: [],
    mode: 'auto',
    sortStrategy: 'area-desc',
    globalRotation: true,
    showFreeSpace: true,
    showGrid: true,
    showLabels: true,
    showCargoContents: true,
  }
}

// Normalise a single project loaded from storage: backfill missing fields,
// coerce layers to a valid number, etc. Prevents NaN propagation in packDeck.
function normalizeProject(p: Partial<Project>): Project {
  const now = Date.now()
  const rawUnit = p.deck?.unit ?? 'm'
  const unit = VALID_UNITS.includes(rawUnit as Unit) ? (rawUnit as Unit) : 'm'
  const rawMode = p.mode ?? 'auto'
  const mode = VALID_MODES.includes(rawMode as Mode) ? (rawMode as Mode) : 'auto'
  const rawSort = p.sortStrategy ?? 'area-desc'
  const sortStrategy = VALID_SORTS.includes(rawSort as SortStrategy)
    ? (rawSort as SortStrategy)
    : 'area-desc'
  return {
    id: typeof p.id === 'string' && p.id ? p.id : uuid(),
    name: typeof p.name === 'string' ? p.name : 'Без названия',
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : now,
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : now,
    deck: {
      width: toFinitePositive(p.deck?.width, 20),
      length: toFinitePositive(p.deck?.length, 8),
      unit,
      gap: toFiniteNonNegative(p.deck?.gap, 0.1),
      boardOffset: toFiniteNonNegative(p.deck?.boardOffset, 0.2),
      clearance: toFiniteNonNegative(p.deck?.clearance, 0),
      maxDeckCargoT: normalizeOptionalWeight(p.deck?.maxDeckCargoT),
      loadZones: normalizeLoadZones(p.deck?.loadZones),
      lashingPoints: normalizeLashingPoints(p.deck?.lashingPoints),
      powerSockets: normalizePowerSockets(p.deck?.powerSockets),
      annotations: normalizeAnnotations(p.deck?.annotations),
      restrictionZones: normalizeRestrictionZones(p.deck?.restrictionZones),
      backgroundImage: toOptionalString(p.deck?.backgroundImage),
      backgroundImageOpacity: toFiniteNonNegative(p.deck?.backgroundImageOpacity, 0.5),
      outline: normalizeOutline(p.deck?.outline),
      vesselMotion: normalizeVesselMotion(p.deck?.vesselMotion),
      vessel: normalizeVessel(p.deck?.vessel),
      shipFrame: normalizeShipFrame(p.deck?.shipFrame),
      deckForwardIsPositiveY: toBool(p.deck?.deckForwardIsPositiveY, true),
    },
    items: Array.isArray(p.items)
      ? p.items.map((it) => ({
          id: typeof it.id === 'string' && it.id ? it.id : uuid(),
          name: typeof it.name === 'string' ? it.name : 'Груз',
          width: toFinitePositive(it.width, 1),
          length: toFinitePositive(it.length, 1),
          height: toFiniteNonNegative(it.height, 0),
          quantity: toPositiveInt(it.quantity, 1),
          color: typeof it.color === 'string' ? it.color : '#0ea5e9',
          allowRotation: typeof it.allowRotation === 'boolean' ? it.allowRotation : true,
          weight: typeof it.weight === 'number' && Number.isFinite(it.weight) ? it.weight : undefined,
          category: toOptionalString(it.category),
          shape: normalizeShape(it.shape),
          outline: normalizeOutline(it.outline),
          maxLayers: typeof it.maxLayers === 'number' && Number.isFinite(it.maxLayers) && it.maxLayers > 0 ? Math.floor(it.maxLayers) : undefined,
          maxStackHeightM: typeof it.maxStackHeightM === 'number' && Number.isFinite(it.maxStackHeightM) && it.maxStackHeightM > 0 ? it.maxStackHeightM : undefined,
          contents: toOptionalString(it.contents),
          stabilityOverride: normalizeStabilityOverride(it.stabilityOverride),
          nest: normalizeNestSpec((it as { nest?: unknown }).nest),
        }))
      : [],
    manualPlacements: normalizeManualPlacements(p.manualPlacements),
    pinnedPlacementsByTrip: normalizePinnedPlacementsByTrip(
      (p as { pinnedPlacementsByTrip?: unknown }).pinnedPlacementsByTrip,
      (p as { pinnedPlacements?: unknown }).pinnedPlacements
    ),
    separationRules: normalizeSeparationRules(p.separationRules),
    mode,
    sortStrategy,
    globalRotation: toBool(p.globalRotation, true),
    showFreeSpace: toBool(p.showFreeSpace, true),
    showGrid: toBool(p.showGrid, true),
    showLabels: toBool(p.showLabels, true),
    showCargoContents: toBool(p.showCargoContents, true),
  }
}

// `hasStoredData` distinguishes "nothing has ever been saved" (truly the
// first visit) from "the user emptied their project list" (the key exists,
// just decodes to []) — `projects.length === 0` alone can't tell those
// apart, which used to make a deleted last project silently come back as
// the demo on the next reload.
function loadFromStorage(): { projects: Project[]; activeId: string | null; hasStoredData: boolean } {
  if (typeof window === 'undefined') return { projects: [], activeId: null, hasStoredData: false }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { projects: [], activeId: null, hasStoredData: false }
    const parsed = JSON.parse(raw)
    // Normalize each project independently — a single malformed/corrupted
    // entry (e.g. from a future field this build doesn't know about yet)
    // must not throw away every OTHER perfectly good project. Before this
    // fix, one bad `.map(normalizeProject)` call threw, the outer catch
    // caught it, and hydrate() then treated the whole thing as "first
    // visit" and silently reseeded a fresh demo — indistinguishable from
    // "everything got reset".
    const rawProjects: unknown[] = Array.isArray(parsed.projects) ? parsed.projects : []
    const projects: Project[] = []
    for (const p of rawProjects) {
      try {
        projects.push(normalizeProject(p as Partial<Project>))
      } catch {
        // skip this one malformed project, keep the rest
      }
    }
    return {
      projects,
      activeId: parsed.activeId ?? null,
      hasStoredData: true,
    }
  } catch {
    return { projects: [], activeId: null, hasStoredData: false }
  }
}

// Previously this swallowed a failed write entirely — every caller
// (saveSnapshot, createProject, deleteProject, switchTo, duplicateProject,
// importProject) went on to update the in-memory store and, for several of
// them, show a "success" toast, even though nothing actually reached
// localStorage (quota exceeded, private-browsing mode, storage disabled).
// The user would keep working normally, then lose everything on the next
// reload with no warning at all. `hasWarnedAboutStorageFailure` rate-limits
// the toast to once per failure streak (reset on the next successful write)
// so a persistently full quota doesn't spam a toast on every autosave tick.
let hasWarnedAboutStorageFailure = false

function saveToStorage(projects: Project[], activeId: string | null): boolean {
  if (typeof window === 'undefined') return true
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ projects, activeId })
    )
    hasWarnedAboutStorageFailure = false
    return true
  } catch {
    if (!hasWarnedAboutStorageFailure) {
      hasWarnedAboutStorageFailure = true
      toast.error('Не удалось сохранить проект в браузере — возможно, переполнено хранилище или включён приватный режим. Изменения видны только пока открыта эта вкладка.')
    }
    return false
  }
}

export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  activeId: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return
    const { projects, activeId, hasStoredData } = loadFromStorage()
    if (!hasStoredData) {
      // Truly the first visit ever (nothing saved yet) — seed a demo project
      // so the app isn't empty. If the user later deletes it, `hasStoredData`
      // will be true next time (the key still exists, just with an empty
      // list) and it won't come back.
      const p = freshProject('Демо-расчёт', true)
      set({ projects: [p], activeId: p.id, hydrated: true })
      saveToStorage([p], p.id)
    } else if (projects.length === 0) {
      set({ projects: [], activeId: null, hydrated: true })
    } else {
      const active = activeId && projects.some((p) => p.id === activeId)
        ? activeId
        : projects[0].id
      set({ projects, activeId: active, hydrated: true })
    }
  },

  createProject: (name) => {
    // Flush any edit still sitting in the debounce window before the
    // currently-active project stops being active — otherwise it's silently
    // dropped (see the pendingAutosave block above).
    flushPendingAutosave((d) => get().saveSnapshot(d))
    // New projects start EMPTY (no preset). Use "Сбросить к примеру" for demo data.
    const p = freshProject(name || `Расчёт ${get().projects.length + 1}`, false)
    set((s) => {
      const next = { projects: [...s.projects, p], activeId: p.id }
      saveToStorage(next.projects, next.activeId)
      return next
    })
    return p.id
  },

  renameProject: (id, name) =>
    set((s) => {
      const next = {
        projects: s.projects.map((p) =>
          p.id === id ? { ...p, name, updatedAt: Date.now() } : p
        ),
      }
      saveToStorage(next.projects, s.activeId)
      return next
    }),

  deleteProject: (id) => {
    // If the active project is the one being deleted, its own in-flight
    // edit is moot (it's about to be discarded) — but if a DIFFERENT
    // project is being deleted while the active one has a pending edit,
    // that edit must still be flushed first. Flushing BEFORE this set() call
    // (rather than from inside the updater) matters: saveSnapshot's own
    // set() would otherwise run nested inside this one and get clobbered
    // when this updater's returned `projects` (computed from the stale `s`
    // closure captured before the flush) overwrites it right after.
    if (get().activeId !== id) flushPendingAutosave((d) => get().saveSnapshot(d))
    set((s) => {
      const remaining = s.projects.filter((p) => p.id !== id)
      let activeId = s.activeId
      if (activeId === id) {
        activeId = remaining[0]?.id ?? null
      }
      saveToStorage(remaining, activeId)
      return { projects: remaining, activeId }
    })
  },

  switchTo: (id) => {
    if (!get().projects.some((p) => p.id === id)) return
    flushPendingAutosave((d) => get().saveSnapshot(d))
    set((s) => {
      saveToStorage(s.projects, id)
      return { activeId: id }
    })
  },

  saveSnapshot: (data) =>
    set((s) => {
      const next = {
        projects: s.projects.map((p) =>
          p.id === data.id
            ? {
                ...p,
                deck: data.deck,
                items: data.items,
                manualPlacements: data.manualPlacements,
                pinnedPlacementsByTrip: data.pinnedPlacementsByTrip,
                separationRules: data.separationRules,
                mode: data.mode,
                sortStrategy: data.sortStrategy,
                globalRotation: data.globalRotation,
                showFreeSpace: data.showFreeSpace,
                showGrid: data.showGrid,
                showLabels: data.showLabels,
                showCargoContents: data.showCargoContents,
                updatedAt: Date.now(),
              }
            : p
        ),
      }
      saveToStorage(next.projects, s.activeId)
      return next
    }),

  duplicateProject: (id) => {
    const src = get().projects.find((p) => p.id === id)
    if (!src) return null
    const now = Date.now()
    // Build a mapping oldItemId -> newItemId so placements stay linked
    const itemIdMap = new Map<string, string>()
    const newItems = src.items.map((it) => {
      const newId = uuid()
      itemIdMap.set(it.id, newId)
      return { ...it, id: newId }
    })
    const copy: Project = {
      ...src,
      id: uuid(),
      name: `${src.name} (копия)`,
      createdAt: now,
      updatedAt: now,
      items: newItems,
      manualPlacements: src.manualPlacements.map((m) => ({
        ...m,
        id: uuid(),
        itemId: itemIdMap.get(m.itemId) ?? m.itemId,
      })),
      pinnedPlacementsByTrip: Object.fromEntries(
        Object.entries(src.pinnedPlacementsByTrip).map(([trip, list]) => [
          trip,
          list.map((p) => ({
            ...p,
            id: uuid(),
            itemId: itemIdMap.get(p.itemId) ?? p.itemId,
          })),
        ])
      ),
    }
    set((s) => {
      const next = { projects: [...s.projects, copy], activeId: copy.id }
      saveToStorage(next.projects, next.activeId)
      return next
    })
    return copy.id
  },

  importProject: (raw) => {
    // Reject anything that doesn't at least structurally look like a
    // Project — otherwise normalizeProject would happily turn e.g. `{}`
    // into a silently-empty "imported" project instead of failing loudly.
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !Array.isArray((raw as Record<string, unknown>).items) ||
      typeof (raw as Record<string, unknown>).deck !== 'object'
    ) {
      return null
    }
    // Always treat an imported file as a brand-new project: ignore its
    // id/timestamps so it can never collide with (or silently overwrite)
    // a project already saved locally, even if it came from this same app.
    const project = normalizeProject({
      ...(raw as Partial<Project>),
      id: undefined,
      createdAt: undefined,
      updatedAt: undefined,
    })
    set((s) => {
      const next = { projects: [...s.projects, project], activeId: project.id }
      saveToStorage(next.projects, next.activeId)
      return next
    })
    return project.id
  },

  getActive: () => {
    const { projects, activeId } = get()
    return projects.find((p) => p.id === activeId) ?? null
  },
}))
