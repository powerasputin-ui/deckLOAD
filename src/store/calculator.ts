import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { CargoItem, SortStrategy } from '@/lib/packing'

export type Unit = 'm' | 'cm' | 'ft'

const UNIT_LABEL: Record<Unit, string> = {
  m: 'м',
  cm: 'см',
  ft: 'фт',
}

export interface DeckConfig {
  width: number
  length: number
  unit: Unit
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
    deck: { width: 30, length: 12, unit: 'm' },
    items: [
      { name: 'Контейнер 20ft', width: 6.06, length: 2.44, quantity: 6, allowRotation: true, weight: 2200 },
      { name: 'Контейнер 40ft', width: 12.19, length: 2.44, quantity: 4, allowRotation: true, weight: 3800 },
      { name: 'Паллета EUR', width: 1.2, length: 0.8, quantity: 12, allowRotation: true, weight: 500 },
    ],
  },
  pallets: {
    deck: { width: 10, length: 6, unit: 'm' },
    items: [
      { name: 'Паллета EUR', width: 1.2, length: 0.8, quantity: 30, allowRotation: true, weight: 500 },
      { name: 'Паллета IND', width: 1.0, length: 1.2, quantity: 10, allowRotation: true, weight: 700 },
    ],
  },
  vehicles: {
    deck: { width: 50, length: 16, unit: 'm' },
    items: [
      { name: 'Седан', width: 4.6, length: 1.8, quantity: 8, allowRotation: true, weight: 1400 },
      { name: 'Внедорожник', width: 4.9, length: 1.95, quantity: 6, allowRotation: true, weight: 2100 },
      { name: 'Пикап', width: 5.3, length: 1.95, quantity: 4, allowRotation: true, weight: 1900 },
    ],
  },
  mixed: {
    deck: { width: 24, length: 10, unit: 'm' },
    items: [
      { name: 'Ящик L', width: 2.0, length: 1.5, quantity: 6, allowRotation: true, weight: 800 },
      { name: 'Ящик M', width: 1.2, length: 0.9, quantity: 12, allowRotation: true, weight: 350 },
      { name: 'Бочка', width: 0.9, length: 0.9, quantity: 16, allowRotation: false, weight: 220 },
      { name: 'Труба', width: 6.0, length: 0.5, quantity: 4, allowRotation: false, weight: 600 },
    ],
  },
}

export const useCalculator = create<CalculatorState>((set, get) => ({
  deck: { width: 20, length: 8, unit: 'm' },
  items: [
    makeItem([], { name: 'Контейнер 20ft', width: 6.06, length: 2.44, quantity: 4, allowRotation: true, weight: 2200 }),
    makeItem([{}], { name: 'Паллета EUR', width: 1.2, length: 0.8, quantity: 12, allowRotation: true, weight: 500 }),
    makeItem([{}, {}], { name: 'Ящик', width: 1.5, length: 1.0, quantity: 6, allowRotation: true, weight: 300 }),
  ],
  sortStrategy: 'area-desc',
  globalRotation: true,
  showFreeSpace: true,
  showGrid: true,
  showLabels: true,

  setDeck: (patch) =>
    set((s) => ({ deck: { ...s.deck, ...patch } })),
  setUnit: (u) => set((s) => ({ deck: { ...s.deck, unit: u } })),
  addItem: (partial) =>
    set((s) => ({ items: [...s.items, makeItem(s.items, partial)] })),
  updateItem: (id, patch) =>
    set((s) => ({
      items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    })),
  removeItem: (id) =>
    set((s) => ({ items: s.items.filter((it) => it.id !== id) })),
  duplicateItem: (id) =>
    set((s) => {
      const it = s.items.find((x) => x.id === id)
      if (!it) return s
      return { items: [...s.items, { ...it, id: uuid(), name: `${it.name} (копия)` }] }
    }),
  clearItems: () => set({ items: [] }),
  setSortStrategy: (st) => set({ sortStrategy: st }),
  toggleGlobalRotation: () =>
    set((s) => ({ globalRotation: !s.globalRotation })),
  toggleFreeSpace: () => set((s) => ({ showFreeSpace: !s.showFreeSpace })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  loadPreset: (preset) => {
    const p = PRESETS[preset]
    if (!p) return
    const items = p.items.map((partial, i) =>
      makeItem(Array(i).fill({}), partial)
    )
    set({ deck: p.deck, items })
  },
}))

export { UNIT_LABEL, PALETTE }
