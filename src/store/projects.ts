import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { CargoItem, ManualPlacement, SortStrategy } from '@/lib/packing'
import type { DeckConfig, Mode } from './calculator'

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  deck: DeckConfig
  items: CargoItem[]
  manualPlacements: ManualPlacement[]
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
    mode: Mode
    sortStrategy: SortStrategy
    globalRotation: boolean
    showFreeSpace: boolean
    showGrid: boolean
    showLabels: boolean
  }) => void
  duplicateProject: (id: string) => string | null
  getActive: () => Project | null
}

const STORAGE_KEY = 'deckload-projects'

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
    mode: 'auto',
    sortStrategy: 'area-desc',
    globalRotation: true,
    showFreeSpace: true,
    showGrid: true,
    showLabels: true,
  }
}

function loadFromStorage(): { projects: Project[]; activeId: string | null } {
  if (typeof window === 'undefined') return { projects: [], activeId: null }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { projects: [], activeId: null }
    const parsed = JSON.parse(raw)
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      activeId: parsed.activeId ?? null,
    }
  } catch {
    return { projects: [], activeId: null }
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
    const { projects, activeId } = loadFromStorage()
    if (projects.length === 0) {
      // First ever load: seed with a demo project so the app isn't empty
      const p = freshProject('Демо-расчёт', true)
      set({ projects: [p], activeId: p.id, hydrated: true })
      saveToStorage([p], p.id)
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
    const copy: Project = {
      ...src,
      id: uuid(),
      name: `${src.name} (копия)`,
      createdAt: now,
      updatedAt: now,
      items: src.items.map((it) => ({ ...it, id: uuid() })),
      manualPlacements: src.manualPlacements.map((m) => ({ ...m, id: uuid() })),
    }
    set((s) => {
      const next = { projects: [...s.projects, copy], activeId: copy.id }
      saveToStorage(next.projects, next.activeId)
      return next
    })
    return copy.id
  },

  getActive: () => {
    const { projects, activeId } = get()
    return projects.find((p) => p.id === activeId) ?? null
  },
}))
