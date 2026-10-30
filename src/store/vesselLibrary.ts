import { create } from 'zustand'
import type { VesselTemplate } from '@/lib/vesselTemplates'
import { isBuiltInVessel, LIBRARY_FILE_FORMAT } from '@/lib/vesselLibrary'
import { normalizeLibraryVessel } from './projects'

// The user's own vessels (spec 8.1, revision 2026-10-30), kept in this
// browser beside the calculations. A file carries them to a colleague or to
// another browser (libraryFile, readLibraryFile).
const STORAGE_KEY = 'deckload-vessels'

interface VesselLibraryState {
  vessels: VesselTemplate[]
  hydrated: boolean
  // What's stored can't be read: nothing is written over it, so nothing more
  // is lost, until the user starts the library afresh.
  broken: boolean
  hydrate: () => void
  add: (vessel: VesselTemplate) => void
  update: (vessel: VesselTemplate) => void
  remove: (id: string) => { vessel: VesselTemplate; index: number } | undefined
  restore: (vessel: VesselTemplate, index: number) => void
  // From a file: a vessel already here (by id) is replaced, a new one added.
  importMany: (vessels: VesselTemplate[]) => { added: number; updated: number }
  startAfresh: () => void
}

function write(vessels: VesselTemplate[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, vessels }))
  } catch {
    // Storage full or blocked: the library lives on for this session.
  }
}

export const useVesselLibrary = create<VesselLibraryState>((set, get) => {
  // Every change is written at once, unless what's stored couldn't be read.
  const commit = (vessels: VesselTemplate[]) => {
    set({ vessels })
    if (!get().broken) write(vessels)
  }
  return {
    vessels: [],
    hydrated: false,
    broken: false,
    hydrate: () => {
      if (get().hydrated) return
      let raw: string | null = null
      try {
        raw = localStorage.getItem(STORAGE_KEY)
      } catch {
        set({ hydrated: true })
        return
      }
      if (!raw) {
        set({ hydrated: true })
        return
      }
      try {
        const parsed = JSON.parse(raw) as { vessels?: unknown }
        const vessels = (Array.isArray(parsed.vessels) ? parsed.vessels : []).flatMap((v) => {
          const vessel = normalizeLibraryVessel(v)
          return vessel ? [vessel] : []
        })
        set({ vessels, hydrated: true })
      } catch {
        set({ hydrated: true, broken: true })
      }
    },
    add: (vessel) => commit([...get().vessels, vessel]),
    update: (vessel) => commit(get().vessels.map((v) => (v.id === vessel.id ? vessel : v))),
    remove: (id) => {
      const index = get().vessels.findIndex((v) => v.id === id)
      if (index < 0) return undefined
      const vessel = get().vessels[index]
      commit(get().vessels.filter((v) => v.id !== id))
      return { vessel, index }
    },
    restore: (vessel, index) => {
      const vessels = [...get().vessels]
      vessels.splice(Math.min(index, vessels.length), 0, vessel)
      commit(vessels)
    },
    importMany: (incoming) => {
      let added = 0
      let updated = 0
      const vessels = [...get().vessels]
      for (const vessel of incoming) {
        const at = vessels.findIndex((v) => v.id === vessel.id)
        if (at >= 0) {
          vessels[at] = vessel
          updated++
        } else {
          vessels.push(vessel)
          added++
        }
      }
      commit(vessels)
      return { added, updated }
    },
    startAfresh: () => {
      set({ broken: false })
      commit([])
    },
  }
})

// A library file's vessels, or why it can't be read. Built-in vessels are
// the app's own and never come from a file.
export function readLibraryFile(text: string): { vessels: VesselTemplate[] } | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: 'Файл повреждён или это не JSON' }
  }
  const file = parsed as { format?: unknown; vessels?: unknown }
  if (!file || file.format !== LIBRARY_FILE_FORMAT || !Array.isArray(file.vessels)) return { error: 'Это не файл библиотеки судов DeckLoad' }
  const vessels = file.vessels.flatMap((v) => {
    const vessel = normalizeLibraryVessel(v)
    return vessel && !isBuiltInVessel(vessel.id) ? [vessel] : []
  })
  if (vessels.length === 0) return { error: 'В файле нет судов' }
  return { vessels }
}
