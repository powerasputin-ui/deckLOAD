import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type {
  CargoItem,
  SortStrategy,
  ManualPlacement,
  PinnedPlacement,
} from '@/lib/packing'

export type Unit = 'm' | 'cm' | 'ft'
export type Mode = 'auto' | 'manual'

const UNIT_LABEL: Record<Unit, string> = {
  m: 'м',
  cm: 'см',
  ft: 'фт',
}

// Conversion factors: how many units per meter
const UNIT_PER_METER: Record<Unit, number> = {
  m: 1,
  cm: 100,
  ft: 3.28084,
}

function convertLength(value: number, from: Unit, to: Unit): number {
  if (from === to) return value
  // value is in `from` units; convert to meters then to `to` units
  const meters = value / UNIT_PER_METER[from]
  return meters * UNIT_PER_METER[to]
}

export interface DeckConfig {
  width: number
  length: number
  unit: Unit
  gap: number // spacing between items
  boardOffset: number // margin from the ship's board (deck edge)
  clearance: number // max stack height above deck (0 = single tier / unlimited)
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
  sortStrategy: SortStrategy
  globalRotation: boolean
  showFreeSpace: boolean
  showGrid: boolean
  showLabels: boolean
  mode: Mode
  manualPlacements: ManualPlacement[]
  pinnedPlacements: PinnedPlacement[]
  selectedPinIds: string[]
  selectedManualIds: string[]
  activeStampId: string | null
  stampRotated: boolean

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
  // Pinned (interactive auto mode)
  pinFromPlaced: (placed: { itemId: string; name: string; x: number; y: number; width: number; length: number; layers: number; rotated: boolean; color: string; weight?: number }) => string
  updatePinned: (id: string, patch: Partial<PinnedPlacement>) => void
  removePinned: (id: string) => void
  clearPinned: () => void
  togglePinSelection: (id: string, additive: boolean) => void
  selectPins: (ids: string[]) => void
  clearSelection: () => void
  // Manual multi-selection
  toggleManualSelection: (id: string, additive: boolean) => void
  clearManualSelection: () => void
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
  }
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

export const useCalculator = create<CalculatorState>((set) => ({
  deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
  items: [
    makeItem([], { name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, quantity: 4, color: '#0ea5e9', allowRotation: true, weight: 2200 }),
    makeItem([], { name: 'Паллета EUR', width: 1.2, length: 0.8, height: 1.6, quantity: 12, color: '#10b981', allowRotation: true, weight: 500 }),
    makeItem([], { name: 'Ящик', width: 1.5, length: 1.0, height: 1.0, quantity: 6, color: '#f59e0b', allowRotation: true, weight: 300 }),
  ],
  sortStrategy: 'area-desc',
  globalRotation: true,
  showFreeSpace: true,
  showGrid: true,
  showLabels: true,
  mode: 'auto',
  manualPlacements: [],
  pinnedPlacements: [],
  selectedPinIds: [],
  selectedManualIds: [],
  activeStampId: null,
  stampRotated: false,

  setDeck: (patch) =>
    set((s) => ({ deck: { ...s.deck, ...patch } })),
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
        pinnedPlacements: s.pinnedPlacements.map((p) => ({
          ...p,
          x: conv(p.x),
          y: conv(p.y),
          width: conv(p.width),
          length: conv(p.length),
        })),
      }
    }),
  addItem: (partial) =>
    set((s) => ({ items: [...s.items, makeItem(s.items, partial)] })),
  updateItem: (id, patch) =>
    set((s) => ({
      items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    })),
  removeItem: (id) =>
    set((s) => ({
      items: s.items.filter((it) => it.id !== id),
      // Also remove orphaned placements referencing the deleted item
      manualPlacements: s.manualPlacements.filter((m) => m.itemId !== id),
      pinnedPlacements: s.pinnedPlacements.filter((p) => p.itemId !== id),
      selectedPinIds: s.selectedPinIds.filter((sid) =>
        s.pinnedPlacements.some((p) => p.id === sid && p.itemId !== id)
      ),
    })),
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
      pinnedPlacements: [],
      selectedPinIds: [],
      selectedManualIds: [],
    }),
  setSortStrategy: (st) => set({ sortStrategy: st }),
  toggleGlobalRotation: () =>
    set((s) => ({ globalRotation: !s.globalRotation })),
  toggleFreeSpace: () => set((s) => ({ showFreeSpace: !s.showFreeSpace })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  loadPreset: (preset) => {
    const p = PRESETS[preset]
    if (!p) return
    const items = p.items.map((partial) =>
      makeItem([], partial)
    )
    set({ deck: { ...p.deck }, items, manualPlacements: [], pinnedPlacements: [], selectedPinIds: [], selectedManualIds: [], activeStampId: items[0]?.id ?? null })
  },
  setMode: (m) =>
    set((s) => ({
      mode: m,
      activeStampId: m === 'manual' && !s.activeStampId ? s.items[0]?.id ?? null : s.activeStampId,
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

  pinFromPlaced: (placed) => {
    const id = uuid()
    set((s) => ({
      pinnedPlacements: [
        ...s.pinnedPlacements,
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
      selectedPinIds: [id],
    }))
    return id
  },
  updatePinned: (id, patch) =>
    set((s) => ({
      pinnedPlacements: s.pinnedPlacements.map((p) =>
        p.id === id ? { ...p, ...patch } : p
      ),
    })),
  removePinned: (id) =>
    set((s) => ({
      pinnedPlacements: s.pinnedPlacements.filter((p) => p.id !== id),
      selectedPinIds: s.selectedPinIds.filter((sid) => sid !== id),
    })),
  clearPinned: () => set({ pinnedPlacements: [], selectedPinIds: [] }),
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
}))

export { UNIT_LABEL, PALETTE }
