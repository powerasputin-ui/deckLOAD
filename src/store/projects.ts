import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { CargoItem, CargoShape, ManualPlacement, SortStrategy, PinnedPlacement, SeparationRule } from '@/lib/packing'
import type { DeckConfig, Mode, Unit } from './calculator'

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
  saveSnapshot: (data: {
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
  }) => void
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

const VALID_SHAPES = new Set<CargoShape>(['box', 'cylinder', 'circle', 'oval', 'triangle', 'diamond', 'custom'])
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
    } as PinnedPlacement
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
    deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
    items: withDemo
      ? [
          { id: uuid(), name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, quantity: 4, color: '#0ea5e9', allowRotation: true, weight: 2200 },
          { id: uuid(), name: 'Паллета EUR', width: 1.2, length: 0.8, height: 0.14, quantity: 12, color: '#10b981', allowRotation: true, weight: 500 },
          { id: uuid(), name: 'Ящик', width: 1.5, length: 1.0, height: 1.0, quantity: 6, color: '#f59e0b', allowRotation: true, weight: 300 },
        ]
      : [],
    manualPlacements: [],
    pinnedPlacementsByTrip: {},
    separationRules: [],
    mode: 'auto',
    sortStrategy: 'area-desc',
    globalRotation: true,
    showFreeSpace: true,
    showGrid: true,
    showLabels: true,
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
      loadZones: normalizeLoadZones(p.deck?.loadZones),
      lashingPoints: normalizeLashingPoints(p.deck?.lashingPoints),
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
        }))
      : [],
    manualPlacements: Array.isArray(p.manualPlacements)
      ? p.manualPlacements.map((m) => ({
          ...m,
          id: typeof m.id === 'string' && m.id ? m.id : uuid(),
          x: toFiniteNonNegative(m.x, 0),
          y: toFiniteNonNegative(m.y, 0),
          width: toFinitePositive(m.width, 1),
          length: toFinitePositive(m.length, 1),
          layers: toPositiveInt(m.layers, 1),
          rotated: typeof m.rotated === 'boolean' ? m.rotated : false,
        }))
      : [],
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
    const projects = Array.isArray(parsed.projects)
      ? parsed.projects.map(normalizeProject)
      : []
    return {
      projects,
      activeId: parsed.activeId ?? null,
      hasStoredData: true,
    }
  } catch {
    return { projects: [], activeId: null, hasStoredData: false }
  }
}

function saveToStorage(projects: Project[], activeId: string | null) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ projects, activeId })
    )
  } catch {
    // ignore quota errors
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

  deleteProject: (id) =>
    set((s) => {
      const remaining = s.projects.filter((p) => p.id !== id)
      let activeId = s.activeId
      if (activeId === id) {
        activeId = remaining[0]?.id ?? null
      }
      saveToStorage(remaining, activeId)
      return { projects: remaining, activeId }
    }),

  switchTo: (id) =>
    set((s) => {
      if (!s.projects.some((p) => p.id === id)) return s
      saveToStorage(s.projects, id)
      return { activeId: id }
    }),

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
