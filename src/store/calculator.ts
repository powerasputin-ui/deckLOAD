import { create } from 'zustand'
import { temporal } from 'zundo'
import { v4 as uuid } from 'uuid'
import { toast } from 'sonner'
import {
  clampToDeck,
  collidesWith,
  withClearanceFootprint,
  resolveSnappedDragPosition,
  maxLayersFor,
  violatesSeparation,
  DEFAULT_VESSEL_MOTION,
  type StabilityOverride,
  type CargoItem,
  type SortStrategy,
  type ManualPlacement,
  type PinnedPlacement,
  type LoadZone,
  type SeparationRule,
  type LashingPoint,
  type PowerSocket,
  type DeckAnnotation,
  type AnnotationKind,
  type ClearanceMargin,
  type VesselMotion,
  type RestrictionZone,
  type RestrictionZoneShape,
} from '@/lib/packing'
import {
  DEFAULT_VESSEL_PARTICULARS,
  DEFAULT_SHIP_FRAME,
  type VesselStabilityData,
  type DeckShipFrame,
  type VesselParticulars,
  type HydrostaticPoint,
  type KNCrossCurves,
  type VariableWeightItem,
} from '@/lib/stability'
import { type Unit, UNIT_LABEL, convertLength } from '@/lib/units'

function emptyVessel(): VesselStabilityData {
  return { particulars: DEFAULT_VESSEL_PARTICULARS, hydrostatics: { points: [] }, variableWeights: [] }
}

export type { Unit }
export type Mode = 'auto' | 'manual'

// Rounds a stored length value for display in an editable number input,
// without touching the value itself — conversion noise from convertLength()
// is tiny (≤1e-9 relative) but still shows up as ugly trailing digits like
// 1999.999999998 when bound directly to an <input value={...}>. Round well
// below any real cargo/deck precision (6 decimals) so that noise always
// disappears, while leaving the underlying stored/geometric value untouched
// — re-typing over the field submits the user's own fresh characters via
// onChange regardless of what this rounded the displayed value to.
export function roundForDisplay(value: number): number {
  if (!Number.isFinite(value)) return value
  const r = Math.round(value * 1e6) / 1e6
  return r === 0 ? 0 : r
}

export interface DeckConfig {
  width: number
  length: number
  unit: Unit
  gap: number // spacing between items
  boardOffset: number // margin from the ship's board (deck edge)
  clearance: number // max stack height above deck; 0 or item without height = single tier (no stacking)
  // The vessel's own approved total deck-cargo capacity (t), seeded from
  // VesselTemplate.limits.maxDeckCargoT when a template is applied.
  // Undefined = no known limit, not "unlimited" — StatsPanel shows nothing
  // rather than a fabricated always-green check. Used two ways: a real HARD
  // stop for auto-placement (page.tsx passes it to packMultiTrip/
  // packDeckVariants as PackOptions.maxTotalWeightKg — cargo that would
  // push the total over this is left unplaced, same as running out of
  // deck area) and a soft red-text warning in StatsPanel for manual mode
  // (where nothing auto-stops placement).
  maxDeckCargoT?: number
  // The vessel's own registry figure for how many 10-foot units fit at
  // full pipe load, seeded from VesselTemplate.limits.tenFootContainerCapacity.
  // Purely informational (StatsPanel live counter) — never enforced, since
  // the source figure is itself conditional ("when fully loaded with
  // pipe"), not a standalone hard cap.
  tenFootContainerCapacity?: number
  loadZones?: LoadZone[] // rated deck zones with their own max load (t/m²) — soft PREFERENCE in auto-placement (see PackOptions.loadZones), plus a soft warning in the UI
  lashingPoints?: LashingPoint[] // pins, optionally attached to a placement for a securing-force check
  powerSockets?: PowerSocket[] // visual-only markers showing where deck electrical outlets are
  annotations?: DeckAnnotation[] // free-text leader notes / bow-stern-port-starboard labels — purely documentation, never read by any calculation
  restrictionZones?: RestrictionZone[] // hard-blocked obstacle zones (crane, bulwark, etc.) — never placeable
  vesselMotion?: VesselMotion // acceleration coefficients + friction used by the lashing check
  backgroundImage?: string // compressed JPEG data URL of a real deck photo/drawing — the WHOLE upload, never cropped
  backgroundImageOpacity?: number // 0..1, seeded to 0.5 the first time a photo is attached
  // Where/how big the photo is drawn, in the SAME deck-local coordinate
  // space as everything else (x/y/width/length in deck.unit) — a free
  // rectangle the user drags to move and corner-drags to (uniformly) scale,
  // independent of deck.width/deck.length. Deliberately allowed to extend
  // past [0,width]x[0,length]: a real photo usually shows more than just
  // the deck itself (surrounding hull, water), and forcing it to fit inside
  // the deck rect is exactly the forced-crop behavior this replaced.
  // Undefined only for a project saved before this field existed AND still
  // carrying a `backgroundImage` from that older, crop-to-deck-rect version
  // — DeckVisualization falls back to treating the deck rect itself as the
  // image's rect in that one legacy case, so an old saved photo doesn't
  // just disappear.
  backgroundImageRect?: { x: number; y: number; width: number; length: number }
  // Real (possibly non-rectangular) deck silhouette, in deck-meter coords,
  // always within [0,width]×[0,length]. width/length stay the authoritative
  // bounding rectangle every packing/collision function already trusts —
  // outline is additive precision data on top, the exact same relationship
  // CargoItem.outline already has to a cargo item's own width/length.
  // Undefined = today's plain rectangle, zero behavior change anywhere.
  outline?: { x: number; y: number }[]
  // Ship stability calculator (see src/lib/stability.ts) — planning/
  // indicative only, not a class-approved loading instrument. vessel holds
  // the vessel's own particulars/hydrostatics/KN cross-curves; shipFrame
  // maps this deck's local (x,y) origin onto the ship's own centerline/
  // midships/baseline reference. Both undefined = feature untouched, no
  // computation attempted anywhere.
  vessel?: VesselStabilityData
  shipFrame?: DeckShipFrame
  // true (default) = deck-local +y points toward the bow. Explicit, not
  // assumed — this is exactly the kind of ambiguous-semantics field that
  // has twice this session burned a user (density vs total, per-unit vs
  // total weight); getting it wrong silently flips the sign of every trim
  // computation.
  deckForwardIsPositiveY?: boolean
}

const PALETTE = [
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#84cc16',
  '#06b6d4',
  // Extended so the growing preset catalog (offshore equipment added more
  // distinct cargo names than the original 10 colors could keep unique)
  // still gets a fresh color per name most of the time.
  '#a855f7',
  '#eab308',
  '#22c55e',
  '#f43f5e',
  '#3b82f6',
  '#d946ef',
  '#65a30d',
  '#0d9488',
  '#c2410c',
  '#7c3aed',
]

interface CalculatorState {
  deck: DeckConfig
  items: CargoItem[]
  separationRules: SeparationRule[]
  sortStrategy: SortStrategy
  globalRotation: boolean
  showFreeSpace: boolean
  showGrid: boolean
  showLabels: boolean
  showCargoContents: boolean
  mode: Mode
  manualPlacements: ManualPlacement[]
  // Pinned placements keyed by trip index — each multi-trip voyage is a
  // separate deck instance, so a pin only applies to the trip it was made on.
  pinnedPlacementsByTrip: Record<number, PinnedPlacement[]>
  selectedPinIds: string[]
  selectedManualIds: string[]
  activeStampId: string | null
  // A preset catalog item armed for click-to-place, before it exists as a
  // real CargoItem. Mutually exclusive with activeStampId — only one stamp
  // source is ever active. Turned into a real item (see
  // addOrIncrementCargoFromTemplate) only at the moment it's actually placed
  // on the deck, not when picked from the catalog.
  pendingPresetStamp: Partial<CargoItem> | null
  // Which preset category is currently shown in the deck panel's stamp
  // picker, replacing the normal "my cargo" list with that category's
  // catalog. Cleared automatically once something is actually placed, so
  // the panel snaps back to showing real cargo instead of staying stuck
  // on the catalog view.
  activePresetCategory: string | null
  stampRotated: boolean
  placingLashingPoint: boolean
  placingPowerSocket: boolean
  // Armed "place an annotation" mode — same mutual-exclusion web as the
  // other armed-placement modes. `kind` decides the default text a new
  // annotation is pre-filled with (see AnnotationKind); `withLeader` picks
  // between a plain floating note (one click) and an AutoCAD-style leader
  // note (two clicks: first the point it points AT, then where the text
  // sits) — the in-progress first-click point is local component state in
  // DeckVisualization, same split as pendingLashingCorner.
  placingAnnotation: { kind: AnnotationKind; withLeader: boolean } | null
  // Armed "draw a custom cargo outline" mode — mutually exclusive with
  // activeStampId/pendingPresetStamp/placingLashingPoint (arming any of the
  // four disarms the other three). The in-progress point list itself is
  // local component state in DeckVisualization, same split as
  // placingLashingPoint/pendingLashingCorner.
  drawingCustomShape: boolean
  // A just-closed drawing, awaiting a name/weight before it becomes a real
  // CargoItem. outline/width/length are already normalized to a local
  // (0,0)-origin frame; x/y is where it was drawn on the deck, so the
  // finalize step can place an instance right there.
  pendingCustomShape: { outline: { x: number; y: number }[]; width: number; length: number; x: number; y: number } | null
  // Armed "edit the deck's own outline" mode — same mutual-exclusion web as
  // drawingCustomShape/placingLashingPoint/activeStampId/pendingPresetStamp.
  // The in-progress point list is local component state in
  // DeckVisualization, same split as the other armed-drawing modes.
  editingDeckOutline: boolean
  // Armed "draw a restriction (obstacle) zone" mode — same mutual-exclusion
  // web as the other armed-drawing modes. Holds WHICH shape is being drawn
  // (null = not armed); the drag-in-progress rect and the just-closed
  // draft-awaiting-a-name are local component state in DeckVisualization,
  // same split as pendingCustomShape/drawingCustomShape.
  drawingRestrictionShape: RestrictionZoneShape | null
  // Armed "draw a restriction zone freehand, point by point" mode — same
  // mutual-exclusion web, same split as drawingCustomShape/drawingPoints
  // (in-progress points are local component state in DeckVisualization).
  drawingRestrictionZoneFreeform: boolean

  setDeck: (patch: Partial<DeckConfig>) => void
  setUnit: (u: Unit) => void
  addItem: (item?: Partial<CargoItem>) => void
  updateItem: (id: string, patch: Partial<CargoItem>) => void
  removeItem: (id: string) => void
  duplicateItem: (id: string) => void
  clearItems: () => void
  setSortStrategy: (s: SortStrategy) => void
  toggleGlobalRotation: () => void
  toggleFreeSpace: () => void
  toggleGrid: () => void
  toggleLabels: () => void
  toggleCargoContents: () => void
  // rect is the initial placement for a NEW photo (computed by the caller
  // from the image's natural aspect ratio) — omitted/ignored when clearing
  // (dataUrl null).
  setDeckBackgroundImage: (dataUrl: string | null, rect?: { x: number; y: number; width: number; length: number }) => void
  setDeckBackgroundImageOpacity: (opacity: number) => void
  setDeckBackgroundImageRect: (rect: { x: number; y: number; width: number; length: number }) => void
  setMode: (m: Mode) => void
  setActiveStamp: (id: string | null) => void
  setPendingPresetStamp: (template: Partial<CargoItem> | null) => void
  setActivePresetCategory: (key: string | null) => void
  // Finds a cargo item matching the template's name and bumps its quantity
  // by 1, or creates a new one with quantity 1 — used only when a preset
  // catalog item is actually placed on the deck, never at selection time.
  addOrIncrementCargoFromTemplate: (template: Partial<CargoItem>) => string
  toggleStampRotation: () => void
  addManualPlacement: (p: ManualPlacement) => void
  updateManualPlacement: (id: string, patch: Partial<ManualPlacement>) => void
  removeManualPlacement: (id: string) => void
  clearManualPlacements: () => void
  // Pinned (interactive auto mode) — all keyed by trip index
  pinFromPlaced: (tripIndex: number, placed: { itemId: string; name: string; x: number; y: number; width: number; length: number; layers: number; rotated: boolean; color: string; weight?: number }) => string
  updatePinned: (tripIndex: number, id: string, patch: Partial<PinnedPlacement>) => void
  removePinned: (tripIndex: number, id: string) => void
  clearPinned: (tripIndex?: number) => void
  togglePinSelection: (id: string, additive: boolean) => void
  selectPins: (ids: string[]) => void
  clearSelection: () => void
  // Manual multi-selection
  toggleManualSelection: (id: string, additive: boolean) => void
  clearManualSelection: () => void

  // Load zones (deck load capacity per m², soft warning only)
  addLoadZone: (zone?: Partial<LoadZone>) => void
  updateLoadZone: (id: string, patch: Partial<LoadZone>) => void
  removeLoadZone: (id: string) => void

  // Lashing/securing points — optionally attached to a placement (placementId
  // + corner) for the CSS-Code-style securing-force check in packing.ts
  addLashingPoint: (point: Omit<LashingPoint, 'id'>) => void
  updateLashingPoint: (id: string, patch: Partial<LashingPoint>) => void
  removeLashingPoint: (id: string) => void

  // Power-socket markers — purely visual, never affect collision/placement.
  addPowerSocket: (socket: Omit<PowerSocket, 'id'>) => void
  updatePowerSocket: (id: string, patch: Partial<PowerSocket>) => void
  removePowerSocket: (id: string) => void
  setPlacingPowerSocket: (v: boolean) => void

  // Free-text annotations (bow/stern/port/starboard labels + AutoCAD-style
  // leader notes) — purely visual, never affect collision/placement or any
  // calculation.
  addAnnotation: (a: Omit<DeckAnnotation, 'id'>) => void
  updateAnnotation: (id: string, patch: Partial<DeckAnnotation>) => void
  removeAnnotation: (id: string) => void
  setPlacingAnnotation: (v: { kind: AnnotationKind; withLeader: boolean } | null) => void
  setPlacingLashingPoint: (v: boolean) => void
  setDrawingCustomShape: (v: boolean) => void
  setPendingCustomShape: (v: CalculatorState['pendingCustomShape']) => void
  setEditingDeckOutline: (v: boolean) => void

  // Restriction (obstacle) zones — hard-blocked everywhere (manual + auto).
  addRestrictionZone: (zone: { shapeType: RestrictionZoneShape; name: string; x: number; y: number; width: number; length: number; outline?: { x: number; y: number }[] }) => void
  updateRestrictionZone: (id: string, patch: Partial<Omit<RestrictionZone, 'id'>>) => void
  removeRestrictionZone: (id: string) => void
  setDrawingRestrictionShape: (shape: RestrictionZoneShape | null) => void
  setDrawingRestrictionZoneFreeform: (v: boolean) => void
  setVesselMotion: (patch: Partial<VesselMotion>) => void

  // Ship stability calculator (src/lib/stability.ts) — planning/indicative
  // only. setVesselParticulars seeds a default hydrostatics/particulars
  // shape the first time it's called (mirrors setVesselMotion's own
  // seed-from-default pattern above).
  setVesselParticulars: (patch: Partial<VesselParticulars>) => void
  addHydrostaticPoint: (point?: Partial<HydrostaticPoint>) => void
  updateHydrostaticPoint: (index: number, patch: Partial<HydrostaticPoint>) => void
  removeHydrostaticPoint: (index: number) => void
  setKNCrossCurves: (curves: KNCrossCurves | undefined) => void
  addVariableWeight: (item?: Partial<VariableWeightItem>) => void
  updateVariableWeight: (id: string, patch: Partial<VariableWeightItem>) => void
  removeVariableWeight: (id: string) => void
  setShipFrame: (patch: Partial<DeckShipFrame>) => void
  setDeckForwardIsPositiveY: (v: boolean) => void
  setItemStabilityOverride: (itemId: string, override: StabilityOverride | undefined) => void

  // Lashing points and a clearance-margin exclusion zone are mutually
  // exclusive per placement (see clearanceMargin on ManualPlacement/
  // PinnedPlacement in packing.ts) — switching a placement to "zone" mode
  // clears whatever points it already had.
  clearLashingPointsFor: (placementId: string) => void
  // Drops lashing points whose placementId no longer matches any existing
  // manual/pinned placement — call after any bulk replace of placements
  // (e.g. applying an auto-redistribute variant) that doesn't go through
  // the normal remove/clear actions, which already do this internally.
  pruneStaleLashingPoints: () => void
  // A full replace of the placement list (auto-redistribute) assigns every
  // placement a brand-new id, even for cargo that's conceptually "the same
  // item, just repacked" — pruneStaleLashingPoints alone would silently
  // delete every lashing point on every redistribute. This carries points
  // over onto their best-matching surviving placement (same itemId, nearest
  // position) instead, translating cornerX/cornerY by the same delta
  // dragLashingCorners already uses for a plain move; anything left
  // unmatched (item no longer fits at all) still gets pruned.
  remapLashingPointsForRedistribute: (matches: { oldId: string; newId: string; dx: number; dy: number }[]) => void

  // Cargo category separation rules
  addSeparationRule: (rule: Omit<SeparationRule, 'id'>) => void
  removeSeparationRule: (id: string) => void
}

// Picks the first palette color no current item is using — cycling purely
// by items.length repeated colors as soon as an item was deleted (or a
// preset/duplicate reused a color), since the count no longer matched
// which colors were actually free. Only falls back to a repeat once every
// palette color is genuinely taken.
// Converts every side of a per-side clearance margin through the same unit
// conversion used for coordinates/dimensions — undefined stays undefined.
function convClearance(
  m: ClearanceMargin | undefined,
  conv: (v: number) => number
): ClearanceMargin | undefined {
  if (!m) return undefined
  return { top: conv(m.top), right: conv(m.right), bottom: conv(m.bottom), left: conv(m.left) }
}

// stabilityOverride.vcgAboveDeckM/tcgOffsetM/lcgOffsetM are stored in the
// deck's display unit, same as every other length here (see stability.ts's
// buildLoadingConditionFromPlacements, which converts them via toMeters the
// same way it converts placement x/y/width/length) — setUnit used to leave
// them unconverted, silently corrupting a VCG/TCG/LCG override by whatever
// factor separates the old and new units the next time it was used.
function convStabilityOverride(
  o: StabilityOverride | undefined,
  conv: (v: number) => number
): StabilityOverride | undefined {
  if (!o) return undefined
  return {
    vcgAboveDeckM: o.vcgAboveDeckM === undefined ? undefined : conv(o.vcgAboveDeckM),
    tcgOffsetM: o.tcgOffsetM === undefined ? undefined : conv(o.tcgOffsetM),
    lcgOffsetM: o.lcgOffsetM === undefined ? undefined : conv(o.lcgOffsetM),
  }
}

// Drops lashing points whose placementId no longer matches any existing
// manual or pinned placement (across every trip). Without this, deleting,
// merging away, or auto-redistributing a placement leaves its attached
// points behind forever, frozen at their last position — indistinguishable
// on screen from a real, currently-attached point, and free to end up
// visually underneath whatever cargo later lands nearby. Unattached "plain
// pin" points (no placementId) are left alone — they're independent deck
// markers, not tied to any placement's lifecycle.
function pruneOrphanLashingPoints(
  deck: DeckConfig,
  manualPlacements: ManualPlacement[],
  pinnedPlacementsByTrip: Record<number, PinnedPlacement[]>
): DeckConfig {
  const points = deck.lashingPoints
  if (!points || points.length === 0) return deck
  const liveIds = new Set<string>(manualPlacements.map((m) => m.id))
  for (const list of Object.values(pinnedPlacementsByTrip)) {
    for (const p of list) liveIds.add(p.id)
  }
  const lashingPoints = points.filter((p) => !p.placementId || liveIds.has(p.placementId))
  return lashingPoints.length === points.length ? deck : { ...deck, lashingPoints }
}

// A lashing point's cornerX/cornerY is a snapshot of the cargo corner it's
// attached to, taken at the moment the point was created — it never
// recomputes on its own. Without this, dragging/nudging the cargo left the
// line pointing at the OLD position (visually detached, and feeding
// checkLashingBalance stale geometry that no longer describes the actual
// placement) — the fastening looked "broken" the moment you moved anything.
// Shifts every lashing point attached to `id` by the same x/y delta the
// placement itself just moved, so the corner keeps tracking it. A plain
// translation isn't perfectly correct through a 90° rotation (corners swap
// which side they're on), but it keeps the point glued close enough rather
// than badly stale, and is exact for the common case (plain drag/nudge).
function dragLashingCorners(
  deck: DeckConfig,
  placementId: string,
  prev: { x: number; y: number } | undefined,
  patch: { x?: number; y?: number }
): DeckConfig {
  const points = deck.lashingPoints
  if (!prev || !points || (patch.x === undefined && patch.y === undefined)) return deck
  const dx = (patch.x ?? prev.x) - prev.x
  const dy = (patch.y ?? prev.y) - prev.y
  if (dx === 0 && dy === 0) return deck
  let changed = false
  const lashingPoints = points.map((lp) => {
    if (lp.placementId !== placementId || lp.cornerX === undefined || lp.cornerY === undefined) return lp
    changed = true
    return { ...lp, cornerX: lp.cornerX + dx, cornerY: lp.cornerY + dy }
  })
  return changed ? { ...deck, lashingPoints } : deck
}

function nextColor(items: CargoItem[]): string {
  const used = new Set(items.map((it) => it.color))
  const free = PALETTE.find((c) => !used.has(c))
  return free ?? PALETTE[items.length % PALETTE.length]
}

function makeItem(items: CargoItem[], partial?: Partial<CargoItem>): CargoItem {
  return {
    id: uuid(),
    name: partial?.name ?? `Груз ${items.length + 1}`,
    width: partial?.width ?? 2,
    length: partial?.length ?? 1.2,
    height: partial?.height ?? 0,
    quantity: partial?.quantity ?? 1,
    color: partial?.color ?? nextColor(items),
    allowRotation: partial?.allowRotation ?? true,
    weight: partial?.weight,
    category: partial?.category,
    shape: partial?.shape,
    outline: partial?.outline,
    maxLayers: partial?.maxLayers,
    maxStackHeightM: partial?.maxStackHeightM,
    contents: partial?.contents,
    stabilityOverride: partial?.stabilityOverride,
    nest: partial?.nest,
  }
}

// Re-position and re-size just the placements of one resized item, keeping
// every other placement untouched. Used when an item's width/length changes
// after it's already been placed — without this, existing placements keep
// their stale footprint (wrong drawn size, wrong weight in totals) and can
// silently overlap their neighbours.
function reflowResizedItem<T extends { x: number; y: number; width: number; length: number; itemId: string }>(
  list: T[],
  itemId: string,
  newWidth: number,
  newLength: number,
  deck: { width: number; length: number; boardOffset: number; gap: number }
): { list: T[]; moved: boolean; stillColliding: boolean } {
  let moved = false
  let stillColliding = false
  const fixed = list
    .filter((p) => p.itemId !== itemId)
    .map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length }))
  const resizedRects: { x: number; y: number; width: number; length: number }[] = []
  const result: T[] = []
  for (const p of list) {
    if (p.itemId !== itemId) {
      result.push(p)
      continue
    }
    const others = [...fixed, ...resizedRects]
    // Keep the placement centred where it was, just at the new size.
    const centerX = p.x + p.width / 2
    const centerY = p.y + p.length / 2
    const clamped = clampToDeck(
      { x: centerX - newWidth / 2, y: centerY - newLength / 2, width: newWidth, length: newLength },
      deck.width,
      deck.length,
      deck.boardOffset
    )
    const needsResolve = collidesWith({ ...clamped, width: newWidth, length: newLength }, others, deck.gap)
    const resolved = needsResolve
      ? resolveSnappedDragPosition(
          clamped.x,
          clamped.y,
          newWidth,
          newLength,
          p.x,
          p.y,
          others,
          deck.width,
          deck.length,
          deck.boardOffset,
          deck.gap,
          0,
          Infinity
        )
      : clamped
    if (resolved.x !== p.x || resolved.y !== p.y || newWidth !== p.width || newLength !== p.length) moved = true
    if (collidesWith({ ...resolved, width: newWidth, length: newLength }, others, deck.gap)) stillColliding = true
    const nextRect = { x: resolved.x, y: resolved.y, width: newWidth, length: newLength }
    resizedRects.push(nextRect)
    result.push({ ...p, ...nextRect })
  }
  return { list: result, moved, stillColliding }
}

// Catalog of standard cargo types shown in the "Пресеты" picker, grouped by
// category. Purely a picker source — selecting a category doesn't add
// anything by itself; only actually placing one of its items on the deck
// (see addOrIncrementCargoFromTemplate) creates a real CargoItem.
export const PRESETS: Record<string, { label: string; items: Partial<CargoItem>[] }> = {
  containers: {
    label: 'Контейнеры',
    items: [
      { name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, allowRotation: true, weight: 2200 },
      { name: 'Контейнер 40ft', width: 12.19, length: 2.44, height: 2.59, allowRotation: true, weight: 3800 },
      { name: 'Паллета EUR', width: 1.2, length: 0.8, height: 0.14, allowRotation: true, weight: 500 },
      // Offshore/DNV 2.7-1 20ft unit — no real registry equivalent on file,
      // kept generic (see the note above the real registry block below for
      // why 10ft/20ft real units replaced their generic namesakes instead).
      { name: 'Офшорный контейнер 20ft (DNV 2.7-1)', width: 6.06, length: 2.44, height: 2.59, allowRotation: true, weight: 2400 },
      { name: 'Полувысокая корзина 20ft', width: 6.1, length: 2.44, height: 1.27, allowRotation: true, weight: 2900 },
      { name: 'Химический танк-контейнер 2500л', width: 1.8, length: 1.8, height: 2.36, allowRotation: true, weight: 650 },
      // Real certified offshore tare from the operator's own RMRS registry
      // («Схемы укладки ТП … + тара + модули + МГС», лист «ТАРА»). Merged
      // directly into this tab (not a separate "Тара (реестр)" category)
      // so real and generic containers/baskets sit side by side where they
      // mean the same thing — the generic DNV 2.7-1 10ft unit and the
      // generic open 20ft basket are replaced outright by their real
      // counterparts below; the 6ft container and 10ft basket had no
      // generic equivalent, so they're pure additions. Dimensions are the
      // registry's own mm figures converted to metres; `weight` is the
      // unit's EMPTY (tare) weight — add the real contents on top before
      // trusting any stability number. Each unit's certified payload
      // capacity ("полезная нагрузка") is carried in `contents` so it
      // shows on hover instead of being silently lost.
      { name: "Контейнер 10' (2661)", width: 2.991, length: 2.438, height: 2.661, allowRotation: true, weight: 2100, contents: 'Тара 2100 кг · полезная нагрузка 7480 кг' },
      { name: "Контейнер 10' (2591)", width: 2.991, length: 2.438, height: 2.591, allowRotation: true, weight: 2230, contents: 'Тара 2230 кг · полезная нагрузка 7770 кг' },
      { name: "Корзина 10'", width: 2.991, length: 2.438, height: 1.345, allowRotation: true, weight: 1550, contents: 'Тара 1550 кг · полезная нагрузка 7750 кг' },
      { name: "Корзина 20'", width: 6.058, length: 2.438, height: 1.438, allowRotation: true, weight: 3500, contents: 'Тара 3500–3600 кг · полезная нагрузка 16300 кг' },
      { name: "Контейнер 6'", width: 1.6, length: 1.8, height: 2.82, allowRotation: true, weight: 1750, contents: 'Тара 1750 кг · полезная нагрузка 5250 кг' },
      // Gas-cylinder units — dangerous goods, so they get a category that
      // the existing separation-rule machinery can key off directly.
      { name: 'Корзина для баллонов (РМРС)', width: 1.25, length: 1.25, height: 2.13, allowRotation: true, weight: 580, category: 'Опасный груз', contents: 'Баллоны с газом · тара ~580 кг · полезная нагрузка ~1940 кг' },
      { name: 'Контейнер КО-3 (16 баллонов)', width: 1.15, length: 1.15, height: 2.13, allowRotation: true, weight: 560, category: 'Опасный груз', contents: 'Офшорный КО-3 на 16 баллонов · тара ~560 кг · полезная нагрузка ~1944 кг' },
    ],
  },
  pallets: {
    label: 'Паллеты',
    items: [
      { name: 'Паллета EUR', width: 1.2, length: 0.8, height: 0.14, allowRotation: true, weight: 500 },
      { name: 'Паллета IND', width: 1.0, length: 1.2, height: 1.5, allowRotation: true, weight: 700 },
    ],
  },
  mixed: {
    label: 'Смешанный',
    items: [
      { name: 'Ящик L', width: 2.0, length: 1.5, height: 1.2, allowRotation: true, weight: 800 },
      { name: 'Ящик M', width: 1.2, length: 0.9, height: 0.8, allowRotation: true, weight: 350 },
      // Realistic offshore pipe types replace the old generic "Бочка"/"Труба".
      { name: 'Скип для бурового шлама', width: 2.4, length: 1.5, height: 1.6, allowRotation: true, weight: 1400 },
      { name: 'Бурильная труба (свеча, Range 2)', width: 9.5, length: 0.15, height: 0.15, allowRotation: true, weight: 400, shape: 'cylinder', color: '#334155' },
      { name: 'Обсадная труба', width: 9.5, length: 0.25, height: 0.25, allowRotation: true, weight: 700, shape: 'cylinder', color: '#57534e' },
      { name: 'Генераторная установка (энергоблок)', width: 3.0, length: 1.5, height: 1.8, allowRotation: false, weight: 3000 },
      { name: 'Якорная цепь в корзине', width: 1.5, length: 1.5, height: 1.2, allowRotation: false, weight: 3000 },
    ],
  },
  // Real line pipe from an approved project document — ДВТК/638.362241.034
  // "Проект перевозки труб... А. Кузнецов" REV3, Таблица 1.1/1.2. Unlike
  // the generic drill/casing pipe in `mixed` above, every length, weight
  // and diameter here is a real transported product.
  //
  // `width` is the pipe's long axis (12.15–12.38 m per the document — the
  // upper bound is used, since a footprint must not be understated), and
  // `length`/`height` are the OUTER diameter including concrete coating
  // (НУБП-NN = NN mm of coating per side, so OD = steel Ø + 2×NN).
  //
  // Note п. 2.1.2 of the same document: a pipe stack must not exceed 3.0 m
  // in height — set that as the clearance/height limit before stacking.
  // Real line pipe — the catalogue-wide count, not a single project's
  // manifest. Real transported products (see each item's own comment for
  // source), not generic placeholders.
  //
  // Every item is capped at `maxLayers: 1`: a real штабель for these pipes
  // is built through PipeNestBuilder (src/lib/pipeNest.ts), which produces
  // a single 'pipe-nest' CargoItem carrying its own real per-tier layout —
  // it never stacks a plain 'cylinder' item vertically. Without this cap,
  // clicking one of these chips repeatedly (or raising "Кол-во" by hand)
  // on a deck with clearance > 0 lets the auto-packer's OLDER
  // decomposePipePyramid path stack them into a valley-nested triangular
  // pile — a shape this session already proved does not match how this
  // vessel's pipes are actually stowed (straight, equal-count tiers on a
  // timber crib, see pipeNest.ts's own doc comment). That pyramid path
  // stays correct and enabled for the two GENERIC loose-pipe presets in
  // `mixed` below (drill pipe / casing — a free pile, not a specific
  // vessel's real stowage method), which is why they're not capped here.
  pipes: {
    label: 'Трубы',
    items: [
      // Ø813 × 30.2 SAWL 450 IFD, concrete-coated (НУБП-NN-СК)
      { name: 'Труба Ø813×30,2 НУБП-130', width: 12.38, length: 1.073, height: 1.073, allowRotation: true, weight: 22000, shape: 'cylinder', color: '#57534e', maxLayers: 1 },
      { name: 'Труба Ø813×30,2 НУБП-90', width: 12.38, length: 0.993, height: 0.993, allowRotation: true, weight: 17000, shape: 'cylinder', color: '#57534e', maxLayers: 1 },
      { name: 'Труба Ø813×30,2 НУБП-72', width: 12.38, length: 0.957, height: 0.957, allowRotation: true, weight: 15000, shape: 'cylinder', color: '#57534e', maxLayers: 1 },
      { name: 'Труба Ø813×30,2 НУБП-45', width: 12.38, length: 0.903, height: 0.903, allowRotation: true, weight: 11000, shape: 'cylinder', color: '#57534e', maxLayers: 1 },
      { name: 'Труба Ø813×32,2 НУБП-45', width: 12.38, length: 0.903, height: 0.903, allowRotation: true, weight: 13000, shape: 'cylinder', color: '#57534e', maxLayers: 1 },
      // Ø219.1, bare (без покрытия) — OD is the steel diameter itself
      { name: 'Труба Ø219,1×14,3 (без НУБП)', width: 12.38, length: 0.219, height: 0.219, allowRotation: true, weight: 1300, shape: 'cylinder', color: '#334155', maxLayers: 1 },
      { name: 'Труба Ø219,1×12,7 (без НУБП)', width: 12.38, length: 0.219, height: 0.219, allowRotation: true, weight: 820, shape: 'cylinder', color: '#334155', maxLayers: 1 },
      // ТШ406.4 × 22.2 with 45 mm concrete → OD 406.4 + 2×45 = 496.4 mm
      { name: 'Труба ТШ406,4×22,2 (бетон 45)', width: 12.38, length: 0.496, height: 0.496, allowRotation: true, weight: 6000, shape: 'cylinder', color: '#57534e', maxLayers: 1 },
      // ОШ-D-1220 × 13, 3 mm coating → OD 1220 + 2×3 = 1226 mm
      { name: 'Труба ОШ-D-1220×13 К60', width: 12.38, length: 1.226, height: 1.226, allowRotation: true, weight: 5000, shape: 'cylinder', color: '#44403c', maxLayers: 1 },
      // Real — «Схема Укладки ТП 2026.pdf», flexible flowline pipe. The
      // source table gives its diameter (617 mm) but leaves weight blank
      // ("Вес— 0000 m") — no real per-metre weight figure exists in any
      // document on file, so `weight` is left unset rather than guessed.
      { name: 'Труба шлейф D=617 мм (514×27 НУБП-51)', width: 12.38, length: 0.617, height: 0.617, allowRotation: true, shape: 'cylinder', color: '#78716c', maxLayers: 1 },
    ],
  },
  // Real cargo with a non-rectangular footprint — 2D/3D actually draw its
  // true shape (see CargoShape in packing.ts), not just a rectangle with a
  // shape label. Placeholder generic dimensions/weight since there's no one
  // "standard" round/triangular/diamond deck cargo the way there is for a
  // container or pallet.
  objects: {
    label: 'Объекты',
    items: [
      { name: 'Круг', width: 1.2, length: 1.2, height: 0.8, allowRotation: true, weight: 200, shape: 'circle' },
      { name: 'Треугольник', width: 1.4, length: 1.2, height: 0.8, allowRotation: true, weight: 200, shape: 'triangle' },
      { name: 'Овал', width: 1.6, length: 1.0, height: 0.8, allowRotation: true, weight: 200, shape: 'oval' },
    ],
  },
}

// The single source of truth for the "demo/example" deck+cargo dataset,
// used by BOTH the very first project a new visitor ever sees
// (freshProject in src/store/projects.ts) and "Сбросить к примеру" /
// handleResetCurrent (src/app/page.tsx). Previously each of those two call
// sites hardcoded its own independent copy of this data — they had already
// drifted (one used a real EUR-pallet height of 0.14m, matching the
// standard's real ~144mm; the other used 1.6m, and even the deck's own
// `clearance` differed, 0 vs 5.2) — so a user hitting "Сбросить к примеру"
// got a visibly different demo than a first-time visitor did, changing
// stacking-layer counts, 3D render height, and the stability VCG estimate
// for the exact same named item. Import this in both places instead of
// re-typing the literals.
export const DEMO_DECK: { width: number; length: number; unit: Unit; gap: number; boardOffset: number; clearance: number } = {
  width: 20,
  length: 8,
  unit: 'm',
  gap: 0.1,
  boardOffset: 0.2,
  clearance: 0,
}

export function createDemoItems(genId: () => string): CargoItem[] {
  return [
    { id: genId(), name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, quantity: 4, color: '#0ea5e9', allowRotation: true, weight: 2200 },
    { id: genId(), name: 'Паллета EUR', width: 1.2, length: 0.8, height: 0.14, quantity: 12, color: '#10b981', allowRotation: true, weight: 500 },
    { id: genId(), name: 'Ящик', width: 1.5, length: 1.0, height: 1.0, quantity: 6, color: '#f59e0b', allowRotation: true, weight: 300 },
  ]
}

// One fixed color per template NAME, shared across every category — not per
// row position. Position-based coloring made the first item of every
// category the same color (Контейнер 20ft and Паллета EUR both blue) and
// made a name appearing in two categories (Паллета EUR is in both
// "Контейнеры" and "Паллеты") show a different color depending on which
// list you found it in. Names that repeat across categories reuse the color
// assigned the first time they were seen instead of getting a new one.
export const PRESET_TEMPLATE_COLORS: Record<string, string> = (() => {
  const colors: Record<string, string> = {}
  let next = 0
  for (const category of Object.values(PRESETS)) {
    for (const item of category.items) {
      const name = item.name
      if (!name || colors[name]) continue
      // A template can pin its own real-world color (e.g. a pipe should
      // look dark grey, a barrel dark brown) instead of an arbitrary
      // palette cycle — honor that before auto-assigning one.
      if (item.color) {
        colors[name] = item.color
        continue
      }
      colors[name] = PALETTE[next % PALETTE.length]
      next++
    }
  }
  return colors
})()

// Undo/redo (Ctrl+Z / Ctrl+Y) history — scoped to cargo/deck "content" only.
// UI-only fields (selection, active stamp, display toggles) are excluded via
// `partialize` so they don't pollute the history or get reverted by undo.
// `handleSet` debounces rapid-fire updates (drag commits are already
// throttled to ~50ms in DeckVisualization, but a multi-second drag can still
// fire dozens of them) into a single history entry, so Ctrl+Z undoes a whole
// drag at once instead of one pixel at a time.
type CalculatorHistoryState = Pick<
  CalculatorState,
  'deck' | 'items' | 'manualPlacements' | 'pinnedPlacementsByTrip' | 'separationRules' | 'mode'
>

export const useCalculator = create<CalculatorState>()(
  temporal(
    (set) => ({
  // Starts empty, not with demo cargo — this is the store's state before
  // the actual saved project has loaded from localStorage (an async effect
  // in page.tsx, see useProjects.hydrate). Seeding it with demo items here
  // used to auto-pack and render a demo layout for one paint, which then
  // got yanked out and replaced the instant the real project loaded —
  // a "flash of wrong content" on every refresh. First-time visitors still
  // get the demo, but through freshProject() in store/projects.ts, which
  // feeds this store via that same load-project effect, not from here.
  deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
  items: [],
  separationRules: [],
  sortStrategy: 'area-desc',
  globalRotation: true,
  showFreeSpace: true,
  showGrid: true,
  showLabels: true,
  showCargoContents: true,
  mode: 'auto',
  manualPlacements: [],
  pinnedPlacementsByTrip: {},
  selectedPinIds: [],
  selectedManualIds: [],
  activeStampId: null,
  pendingPresetStamp: null,
  activePresetCategory: null,
  stampRotated: false,
  placingLashingPoint: false,
  placingPowerSocket: false,
  placingAnnotation: null,
  drawingCustomShape: false,
  pendingCustomShape: null,
  editingDeckOutline: false,
  drawingRestrictionShape: null,
  drawingRestrictionZoneFreeform: false,

  setDeck: (patch) =>
    set((s) => {
      const nextDeck = { ...s.deck, ...patch }
      // Reflow when board offset, gap, deck size, or clearance actually
      // change — these are the settings that can invalidate existing
      // manual/pinned placements by moving the usable-area boundary or the
      // max stack height they must respect. This is the ONLY place that
      // reacts to deck-geometry changes — there must be no duplicate
      // reflow/repack elsewhere, or the two would fight and whichever runs
      // last silently overwrites the other's (better) result.
      const boundsChanged =
        (patch.boardOffset !== undefined && patch.boardOffset !== s.deck.boardOffset) ||
        (patch.gap !== undefined && patch.gap !== s.deck.gap) ||
        (patch.width !== undefined && patch.width !== s.deck.width) ||
        (patch.length !== undefined && patch.length !== s.deck.length) ||
        (patch.clearance !== undefined && patch.clearance !== s.deck.clearance)
      if (!boundsChanged) return { deck: nextDeck }

      const itemById = new Map(s.items.map((it) => [it.id, it]))
      let moved = false
      let layersClamped = false
      let stillColliding = false

      // Multi-pass: a single forward sweep only ever checks item[i] against
      // the ALREADY-RESOLVED items before it (`placed`) — items later in the
      // list are still at their stale pre-change positions and never get
      // re-checked once earlier items land near them. On a dense layout
      // (e.g. right after "Автораспределение" pins everything), increasing
      // the gap can leave a tangle of mutual violations a single sweep
      // can't fully untangle — some pairs end up genuinely overlapping,
      // and shrinking the gap back afterward doesn't repair it either,
      // since by then nothing is "violating" the smaller value anymore.
      // Iterating full passes — each one checking every item against every
      // OTHER item's current (possibly just-updated) position — converges
      // to a fully collision-free layout instead, at the cost of moving
      // more items than a minimal fix strictly requires.
      const reflow = <T extends { x: number; y: number; width: number; length: number; layers: number; itemId: string; clearanceMargin?: ClearanceMargin }>(
        list: T[]
      ): T[] => {
        const current: T[] = list.map((item) => {
          let layers = item.layers
          const cargo = itemById.get(item.itemId)
          if (cargo) {
            const maxLayers = maxLayersFor(cargo, nextDeck.clearance)
            if (layers > maxLayers) {
              layers = maxLayers
              layersClamped = true
            }
          }
          return { ...item, layers }
        })

        const MAX_PASSES = 8
        for (let pass = 0; pass < MAX_PASSES; pass++) {
          let changedThisPass = false
          for (let i = 0; i < current.length; i++) {
            const item = current[i]
            const others = current
              .filter((_, idx) => idx !== i)
              .map((p) => withClearanceFootprint(p))
            const clamped = clampToDeck(item, nextDeck.width, nextDeck.length, nextDeck.boardOffset)
            const needsResolve = collidesWith(
              { ...clamped, width: item.width, length: item.length },
              others,
              nextDeck.gap
            )
            const resolved = needsResolve
              ? resolveSnappedDragPosition(
                  clamped.x,
                  clamped.y,
                  item.width,
                  item.length,
                  item.x,
                  item.y,
                  others,
                  nextDeck.width,
                  nextDeck.length,
                  nextDeck.boardOffset,
                  nextDeck.gap,
                  0,
                  // No drag vector here — pick the nearest collision-free spot,
                  // however far, rather than staying within a tight magnet radius.
                  Infinity
                )
              : clamped
            if (resolved.x !== item.x || resolved.y !== item.y) {
              moved = true
              changedThisPass = true
            }
            current[i] = { ...item, x: resolved.x, y: resolved.y }
          }
          if (!changedThisPass) break
        }

        for (let i = 0; i < current.length; i++) {
          const item = current[i]
          const others = current.filter((_, idx) => idx !== i).map((p) => withClearanceFootprint(p))
          if (collidesWith({ ...item, width: item.width, length: item.length }, others, nextDeck.gap)) {
            // The pass cap above is a safety bound, not a proof of
            // convergence — surface a genuinely irreconcilable layout
            // instead of silently leaving it overlapping.
            stillColliding = true
          }
        }
        return current
      }

      const manualPlacements = reflow(s.manualPlacements)
      const pinnedPlacementsByTrip = Object.fromEntries(
        Object.entries(s.pinnedPlacementsByTrip).map(([trip, list]) => [trip, reflow(list)])
      )

      // Soft warning if the reflow put two categorized cargoes closer than a
      // configured separation rule allows. Not auto-resolved/blocked here —
      // reverting the deck-setting change the user just made would be worse
      // UX than flagging it, same reasoning as load-zone density warnings.
      let separationViolated = false
      if (s.separationRules.length > 0) {
        const rulesInUnit = s.separationRules.map((r) => ({
          ...r,
          minDistance: convertLength(r.minDistance, 'm', nextDeck.unit),
        }))
        const withCategory = (
          list: { x: number; y: number; width: number; length: number; itemId: string }[]
        ) => list.map((p) => ({ ...p, category: itemById.get(p.itemId)?.category }))
        const allPlacements = [
          ...withCategory(manualPlacements),
          ...withCategory(Object.values(pinnedPlacementsByTrip).flat()),
        ]
        for (let i = 0; i < allPlacements.length && !separationViolated; i++) {
          const rest = allPlacements.filter((_, idx) => idx !== i)
          if (violatesSeparation(allPlacements[i], rest, rulesInUnit)) separationViolated = true
        }
      }

      if (moved) {
        toast.info('Раскладка скорректирована под новые параметры палубы')
      }
      if (layersClamped) {
        toast.warning('Часть ярусов уменьшена — новая высота над палубой ниже прежней')
      }
      if (stillColliding) {
        toast.warning('Не все грузы поместились после изменения палубы — возможны перекрытия')
      }
      if (separationViolated) {
        toast.warning('После изменения палубы нарушено правило сепарации между некоторыми грузами')
      }

      return { deck: nextDeck, manualPlacements, pinnedPlacementsByTrip }
    }),
  setUnit: (u) =>
    set((s) => {
      const from = s.deck.unit
      if (from === u) return s
      const conv = (v: number) => convertLength(v, from, u)
      return {
        deck: {
          ...s.deck,
          unit: u,
          width: conv(s.deck.width),
          length: conv(s.deck.length),
          gap: conv(s.deck.gap),
          boardOffset: conv(s.deck.boardOffset),
          clearance: conv(s.deck.clearance),
          loadZones: s.deck.loadZones?.map((z) => ({
            ...z,
            x: conv(z.x),
            y: conv(z.y),
            width: conv(z.width),
            length: conv(z.length),
          })),
          lashingPoints: s.deck.lashingPoints?.map((p) => ({
            ...p,
            x: conv(p.x),
            y: conv(p.y),
            cornerX: p.cornerX === undefined ? undefined : conv(p.cornerX),
            cornerY: p.cornerY === undefined ? undefined : conv(p.cornerY),
          })),
          restrictionZones: s.deck.restrictionZones?.map((z) => ({
            ...z,
            x: conv(z.x),
            y: conv(z.y),
            width: conv(z.width),
            length: conv(z.length),
            outline: z.outline?.map((p) => ({ x: conv(p.x), y: conv(p.y) })),
          })),
          powerSockets: s.deck.powerSockets?.map((p) => ({
            ...p,
            x: conv(p.x),
            y: conv(p.y),
          })),
          annotations: s.deck.annotations?.map((a) => ({
            ...a,
            x: conv(a.x),
            y: conv(a.y),
            leaderX: a.leaderX === undefined ? undefined : conv(a.leaderX),
            leaderY: a.leaderY === undefined ? undefined : conv(a.leaderY),
          })),
          outline: s.deck.outline?.map((p) => ({ x: conv(p.x), y: conv(p.y) })),
          backgroundImageRect: s.deck.backgroundImageRect && {
            x: conv(s.deck.backgroundImageRect.x),
            y: conv(s.deck.backgroundImageRect.y),
            width: conv(s.deck.backgroundImageRect.width),
            length: conv(s.deck.backgroundImageRect.length),
          },
        },
        items: s.items.map((it) => ({
          ...it,
          width: conv(it.width),
          length: conv(it.length),
          height: conv(it.height),
          outline: it.outline?.map((p) => ({ x: conv(p.x), y: conv(p.y) })),
          stabilityOverride: convStabilityOverride(it.stabilityOverride, conv),
        })),
        // Convert coordinates/dimensions of all existing placements too
        manualPlacements: s.manualPlacements.map((m) => ({
          ...m,
          x: conv(m.x),
          y: conv(m.y),
          width: conv(m.width),
          length: conv(m.length),
          clearanceMargin: convClearance(m.clearanceMargin, conv),
          stabilityOverride: convStabilityOverride(m.stabilityOverride, conv),
        })),
        pinnedPlacementsByTrip: Object.fromEntries(
          Object.entries(s.pinnedPlacementsByTrip).map(([trip, list]) => [
            trip,
            list.map((p) => ({
              ...p,
              x: conv(p.x),
              y: conv(p.y),
              width: conv(p.width),
              length: conv(p.length),
              clearanceMargin: convClearance(p.clearanceMargin, conv),
              stabilityOverride: convStabilityOverride(p.stabilityOverride, conv),
            })),
          ])
        ),
      }
    }),
  addItem: (partial) =>
    set((s) => ({ items: [...s.items, makeItem(s.items, partial)] })),
  updateItem: (id, patch) =>
    set((s) => {
      const prevItem = s.items.find((it) => it.id === id)
      const items = s.items.map((it) => (it.id === id ? { ...it, ...patch } : it))
      if (!prevItem) return { items }

      const weightChanged = patch.weight !== undefined && patch.weight !== prevItem.weight
      const widthChanged = patch.width !== undefined && patch.width !== prevItem.width
      const lengthChanged = patch.length !== undefined && patch.length !== prevItem.length
      const layerCapChanged =
        (patch.maxLayers !== undefined && patch.maxLayers !== prevItem.maxLayers) ||
        (patch.height !== undefined && patch.height !== prevItem.height)
      if (!weightChanged && !widthChanged && !lengthChanged && !layerCapChanged) return { items }

      // Existing placements snapshot their own width/length/weight at the
      // time they were placed — without this, editing an item after it's
      // already on the deck leaves stale placements (wrong drawn size,
      // wrong weight in totals, collision checks against outdated geometry).
      const newWidth = patch.width ?? prevItem.width
      const newLength = patch.length ?? prevItem.length
      const applyWeight = <T extends { itemId: string; weight?: number }>(p: T): T =>
        p.itemId === id && weightChanged ? { ...p, weight: patch.weight } : p

      let manualPlacements = s.manualPlacements.map(applyWeight)
      let pinnedPlacementsByTrip: typeof s.pinnedPlacementsByTrip = Object.fromEntries(
        Object.entries(s.pinnedPlacementsByTrip).map(([trip, list]) => [trip, list.map(applyWeight)])
      )

      let moved = false
      let stillColliding = false
      if (widthChanged || lengthChanged) {
        const manualResult = reflowResizedItem(manualPlacements, id, newWidth, newLength, s.deck)
        manualPlacements = manualResult.list
        moved = moved || manualResult.moved
        stillColliding = stillColliding || manualResult.stillColliding

        const pinnedResults = Object.entries(pinnedPlacementsByTrip).map(
          ([trip, list]) => [trip, reflowResizedItem(list, id, newWidth, newLength, s.deck)] as const
        )
        pinnedPlacementsByTrip = Object.fromEntries(pinnedResults.map(([trip, r]) => [trip, r.list]))
        moved = moved || pinnedResults.some(([, r]) => r.moved)
        stillColliding = stillColliding || pinnedResults.some(([, r]) => r.stillColliding)
      }

      if (moved) {
        toast.info('Существующие размещения этого груза обновлены под новый размер')
      }
      if (stillColliding) {
        toast.warning('Новый размер груза не помещается без пересечений — проверьте раскладку')
      }

      // A tighter "Ярусов" cap (or a taller item, which lowers the
      // clearance-height ceiling) must also clamp the layer count already
      // baked into existing placements — without this, edits to maxLayers
      // silently did nothing until the next full repack (Автораспределение),
      // which is the exact bug this closes. Only clamps down, mirroring the
      // clearance-driven clamp in setDeck's reflow above: raising the cap
      // never grows an existing stack on its own.
      let layersClamped = false
      if (layerCapChanged) {
        const newItem = items.find((it) => it.id === id)!
        const newMaxLayers = maxLayersFor(newItem, s.deck.clearance)
        const clampLayers = <T extends { itemId: string; layers: number }>(p: T): T =>
          p.itemId === id && p.layers > newMaxLayers
            ? ((layersClamped = true), { ...p, layers: newMaxLayers })
            : p
        manualPlacements = manualPlacements.map(clampLayers)
        pinnedPlacementsByTrip = Object.fromEntries(
          Object.entries(pinnedPlacementsByTrip).map(([trip, list]) => [trip, list.map(clampLayers)])
        )
      }
      if (layersClamped) {
        toast.info('Число ярусов уже размещённого груза уменьшено под новый лимит')
      }

      return { items, manualPlacements, pinnedPlacementsByTrip }
    }),
  removeItem: (id) =>
    set((s) => {
      const pinnedPlacementsByTrip = Object.fromEntries(
        Object.entries(s.pinnedPlacementsByTrip).map(([trip, list]) => [
          trip,
          list.filter((p) => p.itemId !== id),
        ])
      )
      const allPins = Object.values(s.pinnedPlacementsByTrip).flat()
      const manualPlacements = s.manualPlacements.filter((m) => m.itemId !== id)
      return {
        items: s.items.filter((it) => it.id !== id),
        // Also remove orphaned placements referencing the deleted item
        manualPlacements,
        pinnedPlacementsByTrip,
        selectedPinIds: s.selectedPinIds.filter((sid) =>
          allPins.some((p) => p.id === sid && p.itemId !== id)
        ),
        selectedManualIds: s.selectedManualIds.filter((mid) =>
          manualPlacements.some((m) => m.id === mid)
        ),
      }
    }),
  duplicateItem: (id) =>
    set((s) => {
      const it = s.items.find((x) => x.id === id)
      if (!it) return s
      return { items: [...s.items, { ...it, id: uuid(), name: `${it.name} (копия)` }] }
    }),
  clearItems: () =>
    set({
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      selectedPinIds: [],
      selectedManualIds: [],
    }),
  setSortStrategy: (st) => set({ sortStrategy: st }),
  toggleGlobalRotation: () =>
    set((s) => ({ globalRotation: !s.globalRotation })),
  toggleFreeSpace: () => set((s) => ({ showFreeSpace: !s.showFreeSpace })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  toggleCargoContents: () => set((s) => ({ showCargoContents: !s.showCargoContents })),
  // Built directly, not routed through setDeck — a photo/opacity change must
  // never trigger setDeck's boundsChanged/reflow logic, since it has no
  // effect on placement geometry.
  setDeckBackgroundImage: (dataUrl, rect) =>
    set((s) => ({
      deck: {
        ...s.deck,
        backgroundImage: dataUrl ?? undefined,
        backgroundImageOpacity: dataUrl ? (s.deck.backgroundImageOpacity ?? 0.5) : s.deck.backgroundImageOpacity,
        backgroundImageRect: dataUrl ? (rect ?? s.deck.backgroundImageRect) : undefined,
      },
    })),
  setDeckBackgroundImageOpacity: (opacity) =>
    set((s) => ({ deck: { ...s.deck, backgroundImageOpacity: Math.min(1, Math.max(0, opacity)) } })),
  setDeckBackgroundImageRect: (rect) =>
    set((s) => ({ deck: { ...s.deck, backgroundImageRect: rect } })),
  setMode: (m) =>
    set(() => ({
      mode: m,
      activeStampId: null,
      pendingPresetStamp: null,
      activePresetCategory: null,
      selectedPinIds: [],
      selectedManualIds: [],
    })),
  // Also clears placingLashingPoint/placingPowerSocket, not just the other
  // two armed modes — a pre-existing gap where arming a cargo stamp left a
  // placing-tool silently still active (same bug class the Sidebar already
  // has a comment about for switching a placement to zone mode).
  setActiveStamp: (id) =>
    set({
      activeStampId: id,
      pendingPresetStamp: null,
      drawingCustomShape: false,
      editingDeckOutline: false,
      placingLashingPoint: false,
      placingPowerSocket: false,
      placingAnnotation: null,
      drawingRestrictionShape: null,
      drawingRestrictionZoneFreeform: false,
    }),
  setPendingPresetStamp: (template) =>
    set({
      pendingPresetStamp: template,
      activeStampId: null,
      drawingCustomShape: false,
      editingDeckOutline: false,
      placingLashingPoint: false,
      placingPowerSocket: false,
      placingAnnotation: null,
      drawingRestrictionShape: null,
      drawingRestrictionZoneFreeform: false,
    }),
  setActivePresetCategory: (key) => set({ activePresetCategory: key }),
  addOrIncrementCargoFromTemplate: (template) => {
    let id = ''
    set((s) => {
      const idx = s.items.findIndex((it) => it.name === template.name)
      if (idx >= 0) {
        const items = [...s.items]
        items[idx] = { ...items[idx], quantity: items[idx].quantity + 1 }
        id = items[idx].id
        return { items }
      }
      // Use the template's exact preview color (PRESET_TEMPLATE_COLORS) —
      // the real item must match what the picker row showed, not silently
      // switch to a different nextColor pick after placement.
      const item = makeItem(s.items, { ...template, quantity: 1 })
      id = item.id
      return { items: [...s.items, item] }
    })
    return id
  },
  toggleStampRotation: () => set((s) => ({ stampRotated: !s.stampRotated })),
  addManualPlacement: (p) =>
    set((s) => ({ manualPlacements: [...s.manualPlacements, p] })),
  updateManualPlacement: (id, patch) =>
    set((s) => {
      const prev = s.manualPlacements.find((mp) => mp.id === id)
      const manualPlacements = s.manualPlacements.map((mp) =>
        mp.id === id ? { ...mp, ...patch } : mp
      )
      return { manualPlacements, deck: dragLashingCorners(s.deck, id, prev, patch) }
    }),
  removeManualPlacement: (id) =>
    set((s) => {
      const manualPlacements = s.manualPlacements.filter((mp) => mp.id !== id)
      return {
        manualPlacements,
        activeStampId: s.activeStampId === id ? null : s.activeStampId,
        deck: pruneOrphanLashingPoints(s.deck, manualPlacements, s.pinnedPlacementsByTrip),
      }
    }),
  clearManualPlacements: () =>
    set((s) => ({
      manualPlacements: [],
      deck: pruneOrphanLashingPoints(s.deck, [], s.pinnedPlacementsByTrip),
    })),

  pinFromPlaced: (tripIndex, placed) => {
    const id = uuid()
    set((s) => ({
      pinnedPlacementsByTrip: {
        ...s.pinnedPlacementsByTrip,
        [tripIndex]: [
          ...(s.pinnedPlacementsByTrip[tripIndex] ?? []),
          {
            id,
            itemId: placed.itemId,
            name: placed.name,
            x: placed.x,
            y: placed.y,
            width: placed.width,
            length: placed.length,
            layers: placed.layers,
            rotated: placed.rotated,
            color: placed.color,
            weight: placed.weight,
          },
        ],
      },
      selectedPinIds: [id],
    }))
    return id
  },
  updatePinned: (tripIndex, id, patch) =>
    set((s) => {
      const prev = (s.pinnedPlacementsByTrip[tripIndex] ?? []).find((p) => p.id === id)
      const pinnedPlacementsByTrip = {
        ...s.pinnedPlacementsByTrip,
        [tripIndex]: (s.pinnedPlacementsByTrip[tripIndex] ?? []).map((p) =>
          p.id === id ? { ...p, ...patch } : p
        ),
      }
      return { pinnedPlacementsByTrip, deck: dragLashingCorners(s.deck, id, prev, patch) }
    }),
  removePinned: (tripIndex, id) =>
    set((s) => {
      const pinnedPlacementsByTrip = {
        ...s.pinnedPlacementsByTrip,
        [tripIndex]: (s.pinnedPlacementsByTrip[tripIndex] ?? []).filter((p) => p.id !== id),
      }
      return {
        pinnedPlacementsByTrip,
        selectedPinIds: s.selectedPinIds.filter((sid) => sid !== id),
        deck: pruneOrphanLashingPoints(s.deck, s.manualPlacements, pinnedPlacementsByTrip),
      }
    }),
  clearPinned: (tripIndex) =>
    set((s) => {
      if (tripIndex === undefined) {
        return {
          pinnedPlacementsByTrip: {},
          selectedPinIds: [],
          deck: pruneOrphanLashingPoints(s.deck, s.manualPlacements, {}),
        }
      }
      const { [tripIndex]: removedTrip, ...rest } = s.pinnedPlacementsByTrip
      // Only drop selection ids that belonged to the cleared trip — a live
      // selection on a different (currently unrelated) trip shouldn't vanish.
      const removedIds = new Set((removedTrip ?? []).map((p) => p.id))
      return {
        pinnedPlacementsByTrip: rest,
        selectedPinIds: s.selectedPinIds.filter((sid) => !removedIds.has(sid)),
        deck: pruneOrphanLashingPoints(s.deck, s.manualPlacements, rest),
      }
    }),
  togglePinSelection: (id, additive) =>
    set((s) => {
      if (additive) {
        return {
          selectedPinIds: s.selectedPinIds.includes(id)
            ? s.selectedPinIds.filter((sid) => sid !== id)
            : [...s.selectedPinIds, id],
        }
      }
      return { selectedPinIds: s.selectedPinIds.includes(id) ? [] : [id] }
    }),
  selectPins: (ids) => set({ selectedPinIds: ids }),
  clearSelection: () => set({ selectedPinIds: [] }),

  toggleManualSelection: (id, additive) =>
    set((s) => {
      if (additive) {
        return {
          selectedManualIds: s.selectedManualIds.includes(id)
            ? s.selectedManualIds.filter((sid) => sid !== id)
            : [...s.selectedManualIds, id],
        }
      }
      return { selectedManualIds: s.selectedManualIds.includes(id) ? [] : [id] }
    }),
  clearManualSelection: () => set({ selectedManualIds: [] }),

  addLoadZone: (zone) =>
    set((s) => {
      const width = zone?.width ?? Math.max(1, s.deck.width / 4)
      const length = zone?.length ?? Math.max(1, s.deck.length / 2)
      // On a non-rectangular deck, default to somewhere inside the real
      // shape instead of the bounding box's (0,0) corner, which can land a
      // fresh zone entirely outside a custom-cut deck. Cheap vertex-average
      // centroid — not exact area centroid, but good enough for "somewhere
      // reasonably inside".
      let defaultX = 0
      let defaultY = 0
      if (s.deck.outline && s.deck.outline.length >= 3) {
        const cx = s.deck.outline.reduce((sum, p) => sum + p.x, 0) / s.deck.outline.length
        const cy = s.deck.outline.reduce((sum, p) => sum + p.y, 0) / s.deck.outline.length
        defaultX = Math.max(0, Math.min(s.deck.width - width, cx - width / 2))
        defaultY = Math.max(0, Math.min(s.deck.length - length, cy - length / 2))
      }
      return {
        deck: {
          ...s.deck,
          loadZones: [
            ...(s.deck.loadZones ?? []),
            {
              id: uuid(),
              x: zone?.x ?? defaultX,
              y: zone?.y ?? defaultY,
              width,
              length,
              maxLoadPerArea: zone?.maxLoadPerArea ?? 5,
            },
          ],
        },
      }
    }),
  updateLoadZone: (id, patch) =>
    set((s) => ({
      deck: {
        ...s.deck,
        loadZones: (s.deck.loadZones ?? []).map((z) => (z.id === id ? { ...z, ...patch } : z)),
      },
    })),
  removeLoadZone: (id) =>
    set((s) => ({
      deck: { ...s.deck, loadZones: (s.deck.loadZones ?? []).filter((z) => z.id !== id) },
    })),

  addLashingPoint: (point) =>
    set((s) => ({
      deck: {
        ...s.deck,
        lashingPoints: [...(s.deck.lashingPoints ?? []), { id: uuid(), ...point }],
      },
    })),
  updateLashingPoint: (id, patch) =>
    set((s) => ({
      deck: {
        ...s.deck,
        lashingPoints: (s.deck.lashingPoints ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
      },
    })),
  removeLashingPoint: (id) =>
    set((s) => ({
      deck: {
        ...s.deck,
        lashingPoints: (s.deck.lashingPoints ?? []).filter((p) => p.id !== id),
      },
    })),
  addPowerSocket: (socket) =>
    set((s) => ({
      deck: {
        ...s.deck,
        powerSockets: [...(s.deck.powerSockets ?? []), { id: uuid(), ...socket }],
      },
    })),
  updatePowerSocket: (id, patch) =>
    set((s) => ({
      deck: {
        ...s.deck,
        powerSockets: (s.deck.powerSockets ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
      },
    })),
  removePowerSocket: (id) =>
    set((s) => ({
      deck: {
        ...s.deck,
        powerSockets: (s.deck.powerSockets ?? []).filter((p) => p.id !== id),
      },
    })),
  addAnnotation: (a) =>
    set((s) => ({
      deck: {
        ...s.deck,
        annotations: [...(s.deck.annotations ?? []), { id: uuid(), ...a }],
      },
    })),
  updateAnnotation: (id, patch) =>
    set((s) => ({
      deck: {
        ...s.deck,
        annotations: (s.deck.annotations ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)),
      },
    })),
  removeAnnotation: (id) =>
    set((s) => ({
      deck: {
        ...s.deck,
        annotations: (s.deck.annotations ?? []).filter((a) => a.id !== id),
      },
    })),
  clearLashingPointsFor: (placementId) =>
    set((s) => ({
      deck: {
        ...s.deck,
        lashingPoints: (s.deck.lashingPoints ?? []).filter((p) => p.placementId !== placementId),
      },
    })),
  pruneStaleLashingPoints: () =>
    set((s) => ({ deck: pruneOrphanLashingPoints(s.deck, s.manualPlacements, s.pinnedPlacementsByTrip) })),
  remapLashingPointsForRedistribute: (matches) =>
    set((s) => {
      const points = s.deck.lashingPoints
      if (!points || points.length === 0) return {}
      const byOldId = new Map(matches.map((m) => [m.oldId, m]))
      const remapped = points.map((lp) => {
        if (!lp.placementId) return lp
        const m = byOldId.get(lp.placementId)
        if (!m) return lp
        return {
          ...lp,
          placementId: m.newId,
          // A redistribute can move cargo anywhere on the deck, not just a
          // few centimeters like a drag — leaving the anchor's own x/y in
          // place (as dragLashingCorners deliberately does for a plain
          // move, since THAT anchor is meant to represent a fixed
          // real-world point) would strand it wherever the cargo used to
          // be, often now inside some OTHER placement's new footprint,
          // silently creating a phantom exclusion zone nothing else knows
          // about. Shifting the anchor by the same delta keeps the whole
          // point rigidly attached to the cargo's local frame instead.
          x: lp.x + m.dx,
          y: lp.y + m.dy,
          cornerX: lp.cornerX !== undefined ? lp.cornerX + m.dx : lp.cornerX,
          cornerY: lp.cornerY !== undefined ? lp.cornerY + m.dy : lp.cornerY,
        }
      })
      return {
        deck: pruneOrphanLashingPoints(
          { ...s.deck, lashingPoints: remapped },
          s.manualPlacements,
          s.pinnedPlacementsByTrip
        ),
      }
    }),
  setPlacingLashingPoint: (v) =>
    set({
      placingLashingPoint: v,
      ...(v ? { drawingCustomShape: false, editingDeckOutline: false, placingPowerSocket: false, placingAnnotation: null, drawingRestrictionShape: null, drawingRestrictionZoneFreeform: false } : {}),
    }),
  setPlacingPowerSocket: (v) =>
    set({
      placingPowerSocket: v,
      ...(v ? { drawingCustomShape: false, editingDeckOutline: false, placingLashingPoint: false, placingAnnotation: null, drawingRestrictionShape: null, drawingRestrictionZoneFreeform: false } : {}),
    }),
  setPlacingAnnotation: (v) =>
    set({
      placingAnnotation: v,
      ...(v ? { drawingCustomShape: false, editingDeckOutline: false, placingLashingPoint: false, placingPowerSocket: false, drawingRestrictionShape: null, drawingRestrictionZoneFreeform: false } : {}),
    }),
  setDrawingCustomShape: (v) =>
    set({
      drawingCustomShape: v,
      ...(v
        ? { activeStampId: null, pendingPresetStamp: null, placingLashingPoint: false, placingPowerSocket: false, placingAnnotation: null, editingDeckOutline: false, drawingRestrictionShape: null, drawingRestrictionZoneFreeform: false }
        : {}),
    }),
  setPendingCustomShape: (v) => set({ pendingCustomShape: v }),
  setEditingDeckOutline: (v) =>
    set({
      editingDeckOutline: v,
      ...(v
        ? { activeStampId: null, pendingPresetStamp: null, placingLashingPoint: false, placingPowerSocket: false, placingAnnotation: null, drawingCustomShape: false, drawingRestrictionShape: null, drawingRestrictionZoneFreeform: false }
        : {}),
    }),
  setDrawingRestrictionShape: (shape) =>
    set({
      drawingRestrictionShape: shape,
      drawingRestrictionZoneFreeform: false,
      ...(shape
        ? { activeStampId: null, pendingPresetStamp: null, placingLashingPoint: false, placingPowerSocket: false, placingAnnotation: null, drawingCustomShape: false, editingDeckOutline: false }
        : {}),
    }),
  setDrawingRestrictionZoneFreeform: (v) =>
    set({
      drawingRestrictionZoneFreeform: v,
      drawingRestrictionShape: null,
      ...(v
        ? { activeStampId: null, pendingPresetStamp: null, placingLashingPoint: false, placingPowerSocket: false, placingAnnotation: null, drawingCustomShape: false, editingDeckOutline: false }
        : {}),
    }),
  addRestrictionZone: (zone) =>
    set((s) => ({
      deck: {
        ...s.deck,
        restrictionZones: [...(s.deck.restrictionZones ?? []), { id: uuid(), ...zone }],
      },
    })),
  updateRestrictionZone: (id, patch) =>
    set((s) => ({
      deck: {
        ...s.deck,
        restrictionZones: (s.deck.restrictionZones ?? []).map((z) => (z.id === id ? { ...z, ...patch } : z)),
      },
    })),
  removeRestrictionZone: (id) =>
    set((s) => ({
      deck: {
        ...s.deck,
        restrictionZones: (s.deck.restrictionZones ?? []).filter((z) => z.id !== id),
      },
    })),
  setVesselMotion: (patch) =>
    set((s) => ({
      deck: {
        ...s.deck,
        vesselMotion: { ...(s.deck.vesselMotion ?? DEFAULT_VESSEL_MOTION), ...patch },
      },
    })),

  setVesselParticulars: (patch) =>
    set((s) => {
      const vessel = s.deck.vessel ?? emptyVessel()
      return {
        deck: {
          ...s.deck,
          vessel: { ...vessel, particulars: { ...vessel.particulars, ...patch } },
        },
      }
    }),
  addHydrostaticPoint: (point) =>
    set((s) => {
      const vessel = s.deck.vessel ?? emptyVessel()
      const newPoint: HydrostaticPoint = { displacementKg: 0, draftM: 0, KM: 0, ...point }
      return {
        deck: {
          ...s.deck,
          vessel: { ...vessel, hydrostatics: { points: [...vessel.hydrostatics.points, newPoint] } },
        },
      }
    }),
  updateHydrostaticPoint: (index, patch) =>
    set((s) => {
      const vessel = s.deck.vessel
      if (!vessel) return s
      const points = vessel.hydrostatics.points.map((p, i) => (i === index ? { ...p, ...patch } : p))
      return { deck: { ...s.deck, vessel: { ...vessel, hydrostatics: { points } } } }
    }),
  removeHydrostaticPoint: (index) =>
    set((s) => {
      const vessel = s.deck.vessel
      if (!vessel) return s
      const points = vessel.hydrostatics.points.filter((_, i) => i !== index)
      return { deck: { ...s.deck, vessel: { ...vessel, hydrostatics: { points } } } }
    }),
  setKNCrossCurves: (curves) =>
    set((s) => {
      const vessel = s.deck.vessel ?? emptyVessel()
      return { deck: { ...s.deck, vessel: { ...vessel, knCurves: curves } } }
    }),
  addVariableWeight: (item) =>
    set((s) => {
      const vessel = s.deck.vessel ?? emptyVessel()
      const newItem: VariableWeightItem = { id: uuid(), name: 'Танк', weightKg: 0, vcgM: 0, tcgM: 0, lcgM: 0, ...item }
      return { deck: { ...s.deck, vessel: { ...vessel, variableWeights: [...vessel.variableWeights, newItem] } } }
    }),
  updateVariableWeight: (id, patch) =>
    set((s) => {
      const vessel = s.deck.vessel
      if (!vessel) return s
      const variableWeights = vessel.variableWeights.map((w) => (w.id === id ? { ...w, ...patch } : w))
      return { deck: { ...s.deck, vessel: { ...vessel, variableWeights } } }
    }),
  removeVariableWeight: (id) =>
    set((s) => {
      const vessel = s.deck.vessel
      if (!vessel) return s
      const variableWeights = vessel.variableWeights.filter((w) => w.id !== id)
      return { deck: { ...s.deck, vessel: { ...vessel, variableWeights } } }
    }),
  setShipFrame: (patch) =>
    set((s) => ({
      deck: {
        ...s.deck,
        shipFrame: { ...(s.deck.shipFrame ?? DEFAULT_SHIP_FRAME), ...patch },
      },
    })),
  setDeckForwardIsPositiveY: (v) =>
    set((s) => ({ deck: { ...s.deck, deckForwardIsPositiveY: v } })),
  setItemStabilityOverride: (itemId, override) =>
    set((s) => ({
      items: s.items.map((it) => (it.id === itemId ? { ...it, stabilityOverride: override } : it)),
    })),

  addSeparationRule: (rule) =>
    set((s) => ({ separationRules: [...s.separationRules, { ...rule, id: uuid() }] })),
  removeSeparationRule: (id) =>
    set((s) => ({ separationRules: s.separationRules.filter((r) => r.id !== id) })),
    }),
    {
      partialize: (s): CalculatorHistoryState => ({
        deck: s.deck,
        items: s.items,
        manualPlacements: s.manualPlacements,
        pinnedPlacementsByTrip: s.pinnedPlacementsByTrip,
        separationRules: s.separationRules,
        mode: s.mode,
      }),
      limit: 50,
      equality: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      handleSet: (handleSet) => {
        type HandleSetArgs = Parameters<typeof handleSet>
        return (...args: HandleSetArgs) => {
          const [pastState, replace] = args
          // A drag fires many set() calls (throttled ~50ms in
          // DeckVisualization), each with the state from just before THAT
          // tick as its `pastState`. Re-arming the timer on every call while
          // always re-capturing `pastState` from the latest call meant the
          // eventually-committed snapshot was the position one tick before
          // the drag ENDED, not the position before the drag STARTED -
          // undo only rewound by a fraction of a second of movement, which
          // for a slow/short drag looked like it did nothing at all. Keep
          // the first call's `pastState` for the whole burst so undo always
          // reverts to where the item actually was before the gesture began.
          if (historyPastState === undefined) historyPastState = { value: pastState }
          if (historyTimer) clearTimeout(historyTimer)
          historyTimer = setTimeout(() => {
            historyTimer = null
            const toCommit = historyPastState!.value as HandleSetArgs[0]
            historyPastState = undefined
            handleSet(toCommit, replace)
          }, 400)
        }
      },
    }
  )
)

// Bulk state replacements (switching/loading a project, "new calculation",
// "reset to example") call this instead of `.temporal.getState().clear()`
// directly. `handleSet` above is debounced 400ms so a drag's rapid updates
// collapse into one history entry — but that means the *replacement*
// `setState` call itself still has a snapshot pending when `clear()` runs
// synchronously right after it, and 400ms later that stale snapshot would
// land in history anyway, making Ctrl+Z jump back to data that no longer
// belongs to the now-active project. Cancelling the pending timer first
// closes that race.
let historyTimer: ReturnType<typeof setTimeout> | null = null
let historyPastState: { value: unknown } | undefined
export function clearCalculatorHistory() {
  if (historyTimer) {
    clearTimeout(historyTimer)
    historyTimer = null
  }
  historyPastState = undefined
  useCalculator.temporal.getState().clear()
}

export { UNIT_LABEL, PALETTE, convertLength }
