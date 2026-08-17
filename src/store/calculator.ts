import { create } from 'zustand'
import { temporal } from 'zundo'
import { v4 as uuid } from 'uuid'
import { toast } from 'sonner'
import {
  clampToDeck,
  collidesWith,
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
  type VesselMotion,
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
  vesselMotion?: VesselMotion // acceleration coefficients + friction used by the lashing check
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
  stampRotated: boolean
  placingLashingPoint: boolean

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
  loadPreset: (preset: 'containers' | 'pallets' | 'vehicles' | 'mixed') => void
  setMode: (m: Mode) => void
  setActiveStamp: (id: string | null) => void
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
  setPlacingLashingPoint: (v: boolean) => void
  setVesselMotion: (patch: Partial<VesselMotion>) => void

  // Cargo category separation rules
  addSeparationRule: (rule: Omit<SeparationRule, 'id'>) => void
  removeSeparationRule: (id: string) => void
}

function nextColor(items: CargoItem[]): string {
  return PALETTE[items.length % PALETTE.length]
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

const PRESETS: Record<
  string,
  { deck: DeckConfig; items: Partial<CargoItem>[] }
> = {
  containers: {
    deck: { width: 30, length: 12, unit: 'm', gap: 0.15, boardOffset: 0.5, clearance: 7.8 },
    items: [
      { name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, quantity: 6, allowRotation: true, weight: 2200 },
      { name: 'Контейнер 40ft', width: 12.19, length: 2.44, height: 2.59, quantity: 4, allowRotation: true, weight: 3800 },
      { name: 'Паллета EUR', width: 1.2, length: 0.8, height: 1.6, quantity: 12, allowRotation: true, weight: 500 },
    ],
  },
  pallets: {
    deck: { width: 10, length: 6, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 1.8 },
    items: [
      { name: 'Паллета EUR', width: 1.2, length: 0.8, height: 1.6, quantity: 30, allowRotation: true, weight: 500 },
      { name: 'Паллета IND', width: 1.0, length: 1.2, height: 1.5, quantity: 10, allowRotation: true, weight: 700 },
    ],
  },
  vehicles: {
    deck: { width: 50, length: 16, unit: 'm', gap: 0.2, boardOffset: 0.5, clearance: 0 },
    items: [
      { name: 'Седан', width: 4.6, length: 1.8, height: 1.4, quantity: 8, allowRotation: true, weight: 1400 },
      { name: 'Внедорожник', width: 4.9, length: 1.95, height: 1.8, quantity: 6, allowRotation: true, weight: 2100 },
      { name: 'Пикап', width: 5.3, length: 1.95, height: 1.9, quantity: 4, allowRotation: true, weight: 1900 },
    ],
  },
  mixed: {
    deck: { width: 24, length: 10, unit: 'm', gap: 0.1, boardOffset: 0.3, clearance: 3.5 },
    items: [
      { name: 'Ящик L', width: 2.0, length: 1.5, height: 1.2, quantity: 6, allowRotation: true, weight: 800 },
      { name: 'Ящик M', width: 1.2, length: 0.9, height: 0.8, quantity: 12, allowRotation: true, weight: 350 },
      { name: 'Бочка', width: 0.9, length: 0.9, height: 1.0, quantity: 16, allowRotation: false, weight: 220 },
      { name: 'Труба', width: 6.0, length: 0.5, height: 0.5, quantity: 4, allowRotation: false, weight: 600 },
    ],
  },
}

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
  deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
  items: [
    makeItem([], { name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, quantity: 4, color: '#0ea5e9', allowRotation: true, weight: 2200 }),
    makeItem([], { name: 'Паллета EUR', width: 1.2, length: 0.8, height: 1.6, quantity: 12, color: '#10b981', allowRotation: true, weight: 500 }),
    makeItem([], { name: 'Ящик', width: 1.5, length: 1.0, height: 1.0, quantity: 6, color: '#f59e0b', allowRotation: true, weight: 300 }),
  ],
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
  stampRotated: false,
  placingLashingPoint: false,

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

      const reflow = <T extends { x: number; y: number; width: number; length: number; layers: number; itemId: string }>(
        list: T[]
      ): T[] => {
        const placed: T[] = []
        for (const item of list) {
          let layers = item.layers
          const cargo = itemById.get(item.itemId)
          if (cargo) {
            const maxLayers = maxLayersFor(cargo, nextDeck.clearance)
            if (layers > maxLayers) {
              layers = maxLayers
              layersClamped = true
            }
          }
          const clamped = clampToDeck(item, nextDeck.width, nextDeck.length, nextDeck.boardOffset)
          const others = placed.map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length }))
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
          if (resolved.x !== item.x || resolved.y !== item.y) moved = true
          if (
            collidesWith({ ...resolved, width: item.width, length: item.length }, others, nextDeck.gap)
          ) {
            // resolveSnappedDragPosition always returns SOME position (last
            // resort: clamped to the usable margin) even if none are
            // collision-free — surface that instead of silently overlapping.
            stillColliding = true
          }
          placed.push({ ...item, x: resolved.x, y: resolved.y, layers })
        }
        return placed
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
          lashingPoints: s.deck.lashingPoints?.map((p) => ({ ...p, x: conv(p.x), y: conv(p.y) })),
        },
        items: s.items.map((it) => ({
          ...it,
          width: conv(it.width),
          length: conv(it.length),
          height: conv(it.height),
        })),
        // Convert coordinates/dimensions of all existing placements too
        manualPlacements: s.manualPlacements.map((m) => ({
          ...m,
          x: conv(m.x),
          y: conv(m.y),
          width: conv(m.width),
          length: conv(m.length),
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
  // Adds the preset's cargo to whatever is already on the deck — deck size,
  // existing items, and placements are left untouched. A preset used to
  // replace all of that wholesale, which meant picking a second preset after
  // already placing cargo from the first silently wiped everything.
  loadPreset: (preset) =>
    set((s) => {
      const p = PRESETS[preset]
      if (!p) return s
      // Build up the accumulator as we go (not just s.items) so each new
      // item's color/fallback-name index accounts for the ones already
      // added in this same batch, not just the pre-existing list.
      const items = [...s.items]
      for (const partial of p.items) items.push(makeItem(items, partial))
      return { items }
    }),
  setMode: (m) =>
    set(() => ({
      mode: m,
      activeStampId: null,
      selectedPinIds: [],
      selectedManualIds: [],
    })),
  setActiveStamp: (id) => set({ activeStampId: id }),
  toggleStampRotation: () => set((s) => ({ stampRotated: !s.stampRotated })),
  addManualPlacement: (p) =>
    set((s) => ({ manualPlacements: [...s.manualPlacements, p] })),
  updateManualPlacement: (id, patch) =>
    set((s) => ({
      manualPlacements: s.manualPlacements.map((mp) =>
        mp.id === id ? { ...mp, ...patch } : mp
      ),
    })),
  removeManualPlacement: (id) =>
    set((s) => ({
      manualPlacements: s.manualPlacements.filter((mp) => mp.id !== id),
      activeStampId:
        s.activeStampId === id ? null : s.activeStampId,
    })),
  clearManualPlacements: () => set({ manualPlacements: [] }),

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
    set((s) => ({
      pinnedPlacementsByTrip: {
        ...s.pinnedPlacementsByTrip,
        [tripIndex]: (s.pinnedPlacementsByTrip[tripIndex] ?? []).map((p) =>
          p.id === id ? { ...p, ...patch } : p
        ),
      },
    })),
  removePinned: (tripIndex, id) =>
    set((s) => ({
      pinnedPlacementsByTrip: {
        ...s.pinnedPlacementsByTrip,
        [tripIndex]: (s.pinnedPlacementsByTrip[tripIndex] ?? []).filter((p) => p.id !== id),
      },
      selectedPinIds: s.selectedPinIds.filter((sid) => sid !== id),
    })),
  clearPinned: (tripIndex) =>
    set((s) => {
      if (tripIndex === undefined) return { pinnedPlacementsByTrip: {}, selectedPinIds: [] }
      const { [tripIndex]: removedTrip, ...rest } = s.pinnedPlacementsByTrip
      // Only drop selection ids that belonged to the cleared trip — a live
      // selection on a different (currently unrelated) trip shouldn't vanish.
      const removedIds = new Set((removedTrip ?? []).map((p) => p.id))
      return {
        pinnedPlacementsByTrip: rest,
        selectedPinIds: s.selectedPinIds.filter((sid) => !removedIds.has(sid)),
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
    set((s) => ({
      deck: {
        ...s.deck,
        loadZones: [
          ...(s.deck.loadZones ?? []),
          {
            id: uuid(),
            x: zone?.x ?? 0,
            y: zone?.y ?? 0,
            width: zone?.width ?? Math.max(1, s.deck.width / 4),
            length: zone?.length ?? Math.max(1, s.deck.length / 2),
            maxLoadPerArea: zone?.maxLoadPerArea ?? 5,
          },
        ],
      },
    })),
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
  setPlacingLashingPoint: (v) => set({ placingLashingPoint: v }),
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
