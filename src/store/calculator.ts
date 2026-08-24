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
  type CargoItem,
  type SortStrategy,
  type ManualPlacement,
  type PinnedPlacement,
  type LoadZone,
  type SeparationRule,
  type LashingPoint,
  type PowerSocket,
  type ClearanceMargin,
  type VesselMotion,
  type RestrictionZone,
  type RestrictionZoneShape,
} from '@/lib/packing'

export type Unit = 'm' | 'cm' | 'ft'
export type Mode = 'auto' | 'manual'

const UNIT_LABEL: Record<Unit, string> = {
  m: 'м',
  cm: 'см',
  ft: 'фт',
}

// Conversion factors: how many units per meter. ft uses the exact reciprocal
// of the international foot definition (1 ft = 0.3048 m) to avoid drift on
// repeated unit switches.
const UNIT_PER_METER: Record<Unit, number> = {
  m: 1,
  cm: 100,
  ft: 1 / 0.3048,
}

function convertLength(value: number, from: Unit, to: Unit): number {
  if (from === to) return value
  // value is in `from` units; convert to meters then to `to` units
  const meters = value / UNIT_PER_METER[from]
  // Round to a reasonable precision so repeated unit switches don't accumulate
  // floating-point noise (e.g. 20 m becoming 19.99999999999 ft and back).
  return Math.round(meters * UNIT_PER_METER[to] * 1e9) / 1e9
}

export interface DeckConfig {
  width: number
  length: number
  unit: Unit
  gap: number // spacing between items
  boardOffset: number // margin from the ship's board (deck edge)
  clearance: number // max stack height above deck; 0 or item without height = single tier (no stacking)
  loadZones?: LoadZone[] // rated deck zones with their own max load (t/m²) — soft warning only
  lashingPoints?: LashingPoint[] // pins, optionally attached to a placement for a securing-force check
  powerSockets?: PowerSocket[] // visual-only markers showing where deck electrical outlets are
  restrictionZones?: RestrictionZone[] // hard-blocked obstacle zones (crane, bulwark, etc.) — never placeable
  vesselMotion?: VesselMotion // acceleration coefficients + friction used by the lashing check
  backgroundImage?: string // compressed JPEG data URL of a real deck photo, aligned under the 2D plan
  backgroundImageOpacity?: number // 0..1, seeded to 0.5 the first time a photo is attached
  // Real (possibly non-rectangular) deck silhouette, in deck-meter coords,
  // always within [0,width]×[0,length]. width/length stay the authoritative
  // bounding rectangle every packing/collision function already trusts —
  // outline is additive precision data on top, the exact same relationship
  // CargoItem.outline already has to a cargo item's own width/length.
  // Undefined = today's plain rectangle, zero behavior change anywhere.
  outline?: { x: number; y: number }[]
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
  setDeckBackgroundImage: (dataUrl: string | null) => void
  setDeckBackgroundImageOpacity: (opacity: number) => void
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
  setPlacingLashingPoint: (v: boolean) => void
  setDrawingCustomShape: (v: boolean) => void
  setPendingCustomShape: (v: CalculatorState['pendingCustomShape']) => void
  setEditingDeckOutline: (v: boolean) => void

  // Restriction (obstacle) zones — hard-blocked everywhere (manual + auto).
  addRestrictionZone: (zone: { shapeType: RestrictionZoneShape; name: string; x: number; y: number; width: number; length: number }) => void
  updateRestrictionZone: (id: string, patch: Partial<Omit<RestrictionZone, 'id'>>) => void
  removeRestrictionZone: (id: string) => void
  setDrawingRestrictionShape: (shape: RestrictionZoneShape | null) => void
  setVesselMotion: (patch: Partial<VesselMotion>) => void
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
      { name: 'Паллета EUR', width: 1.2, length: 0.8, height: 1.6, allowRotation: true, weight: 500 },
      // Offshore/DNV 2.7-1 units — same "container" family as the two
      // above, just certified/shaped for platform crane transfer.
      { name: 'Офшорный контейнер 20ft (DNV 2.7-1)', width: 6.06, length: 2.44, height: 2.59, allowRotation: true, weight: 2400 },
      { name: 'Офшорный контейнер 10ft (DNV 2.7-1)', width: 2.99, length: 2.44, height: 2.59, allowRotation: true, weight: 2000 },
      { name: 'Грузовая корзина 20ft (открытая)', width: 6.06, length: 2.44, height: 1.1, allowRotation: true, weight: 1800 },
      { name: 'Полувысокая корзина 20ft', width: 6.1, length: 2.44, height: 1.27, allowRotation: true, weight: 2900 },
      { name: 'Химический танк-контейнер 2500л', width: 1.8, length: 1.8, height: 2.36, allowRotation: true, weight: 650 },
    ],
  },
  pallets: {
    label: 'Паллеты',
    items: [
      { name: 'Паллета EUR', width: 1.2, length: 0.8, height: 1.6, allowRotation: true, weight: 500 },
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
  drawingCustomShape: false,
  pendingCustomShape: null,
  editingDeckOutline: false,
  drawingRestrictionShape: null,

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
          })),
        },
        items: s.items.map((it) => ({
          ...it,
          width: conv(it.width),
          length: conv(it.length),
          height: conv(it.height),
          outline: it.outline?.map((p) => ({ x: conv(p.x), y: conv(p.y) })),
        })),
        // Convert coordinates/dimensions of all existing placements too
        manualPlacements: s.manualPlacements.map((m) => ({
          ...m,
          x: conv(m.x),
          y: conv(m.y),
          width: conv(m.width),
          length: conv(m.length),
          clearanceMargin: convClearance(m.clearanceMargin, conv),
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
      if (!weightChanged && !widthChanged && !lengthChanged) return { items }

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
  // Built directly, not routed through setDeck — a photo/opacity change must
  // never trigger setDeck's boundsChanged/reflow logic, since it has no
  // effect on placement geometry.
  setDeckBackgroundImage: (dataUrl) =>
    set((s) => ({
      deck: {
        ...s.deck,
        backgroundImage: dataUrl ?? undefined,
        backgroundImageOpacity: dataUrl ? (s.deck.backgroundImageOpacity ?? 0.5) : s.deck.backgroundImageOpacity,
      },
    })),
  setDeckBackgroundImageOpacity: (opacity) =>
    set((s) => ({ deck: { ...s.deck, backgroundImageOpacity: Math.min(1, Math.max(0, opacity)) } })),
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
      drawingRestrictionShape: null,
    }),
  setPendingPresetStamp: (template) =>
    set({
      pendingPresetStamp: template,
      activeStampId: null,
      drawingCustomShape: false,
      editingDeckOutline: false,
      placingLashingPoint: false,
      placingPowerSocket: false,
      drawingRestrictionShape: null,
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
      ...(v ? { drawingCustomShape: false, editingDeckOutline: false, placingPowerSocket: false, drawingRestrictionShape: null } : {}),
    }),
  setPlacingPowerSocket: (v) =>
    set({
      placingPowerSocket: v,
      ...(v ? { drawingCustomShape: false, editingDeckOutline: false, placingLashingPoint: false, drawingRestrictionShape: null } : {}),
    }),
  setDrawingCustomShape: (v) =>
    set({
      drawingCustomShape: v,
      ...(v
        ? { activeStampId: null, pendingPresetStamp: null, placingLashingPoint: false, placingPowerSocket: false, editingDeckOutline: false, drawingRestrictionShape: null }
        : {}),
    }),
  setPendingCustomShape: (v) => set({ pendingCustomShape: v }),
  setEditingDeckOutline: (v) =>
    set({
      editingDeckOutline: v,
      ...(v
        ? { activeStampId: null, pendingPresetStamp: null, placingLashingPoint: false, placingPowerSocket: false, drawingCustomShape: false, drawingRestrictionShape: null }
        : {}),
    }),
  setDrawingRestrictionShape: (shape) =>
    set({
      drawingRestrictionShape: shape,
      ...(shape
        ? { activeStampId: null, pendingPresetStamp: null, placingLashingPoint: false, placingPowerSocket: false, drawingCustomShape: false, editingDeckOutline: false }
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
