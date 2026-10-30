import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useVesselLibrary } from './vesselLibrary'
import { useProjects } from './projects'
import type { VesselTemplate } from '@/lib/vesselTemplates'
import { appliedVesselOf } from '@/lib/vesselLibrary'

// Revision 2026-10-30 (spec 8.1): the user's own vessels, kept in this browser.

const vessel = (id: string, label = id): VesselTemplate => ({ id, label, note: '', deck: { width: 16, length: 40 } })
const stored = () => JSON.parse(storage['deckload-vessels'] ?? 'null')
let storage: Record<string, string> = {}

describe('the vessel library', () => {
  beforeEach(() => {
    storage = {}
    useVesselLibrary.setState({ vessels: [], hydrated: false, broken: false })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value
      },
      removeItem: (key: string) => {
        delete storage[key]
      },
    } as Storage)
  })

  it('keeps every change in the browser at once, and reads it back', () => {
    const lib = useVesselLibrary.getState()
    lib.hydrate()
    lib.add(vessel('user-a', 'Нептун'))
    lib.add(vessel('user-b'))
    lib.update({ ...vessel('user-a'), label: 'Нептун-2' })
    expect(stored().vessels.map((v: VesselTemplate) => [v.id, v.label])).toEqual([
      ['user-a', 'Нептун-2'],
      ['user-b', 'user-b'],
    ])
    useVesselLibrary.setState({ vessels: [], hydrated: false })
    useVesselLibrary.getState().hydrate()
    expect(useVesselLibrary.getState().vessels.map((v) => v.label)).toEqual(['Нептун-2', 'user-b'])
  })

  it('brings a deleted vessel back to its place', () => {
    const lib = useVesselLibrary.getState()
    for (const id of ['user-a', 'user-b', 'user-c']) lib.add(vessel(id))
    const removed = lib.remove('user-b')!
    expect(useVesselLibrary.getState().vessels.map((v) => v.id)).toEqual(['user-a', 'user-c'])
    useVesselLibrary.getState().restore(removed.vessel, removed.index)
    expect(useVesselLibrary.getState().vessels.map((v) => v.id)).toEqual(['user-a', 'user-b', 'user-c'])
    expect(useVesselLibrary.getState().remove('nothing')).toBeUndefined()
  })

  it('takes a file\'s vessels: one already here is replaced, a new one added', () => {
    const lib = useVesselLibrary.getState()
    lib.add(vessel('user-a', 'Старое'))
    expect(lib.importMany([vessel('user-a', 'Новое'), vessel('user-b')])).toEqual({ added: 1, updated: 1 })
    expect(useVesselLibrary.getState().vessels.map((v) => v.label)).toEqual(['Новое', 'user-b'])
  })

  // A library the browser can't read isn't written over: what's in it may
  // still be recovered.
  it('writes nothing over a library it can\'t read, until started afresh', () => {
    storage['deckload-vessels'] = '{broken'
    useVesselLibrary.getState().hydrate()
    expect(useVesselLibrary.getState()).toMatchObject({ broken: true, vessels: [] })
    useVesselLibrary.getState().add(vessel('user-a'))
    expect(storage['deckload-vessels']).toBe('{broken')
    useVesselLibrary.getState().startAfresh()
    expect(stored()).toEqual({ version: 1, vessels: [] })
  })

  it('drops what isn\'t a vessel when reading', () => {
    storage['deckload-vessels'] = JSON.stringify({ version: 1, vessels: [{ id: 'user-x' }, vessel('user-a'), 'junk'] })
    useVesselLibrary.getState().hydrate()
    expect(useVesselLibrary.getState().vessels.map((v) => v.id)).toEqual(['user-a'])
  })
})

describe('a calculation\'s copy of its vessel', () => {
  beforeEach(() => {
    storage = {}
    useProjects.setState({ projects: [], activeId: null, hydrated: false, storageLocked: false })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value
      },
      removeItem: (key: string) => {
        delete storage[key]
      },
    } as Storage)
  })

  it('is saved with the calculation and read back', () => {
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    const info = appliedVesselOf({ ...vessel('user-a', 'Нептун'), note: 'Формуляр', deckForwardIsPositiveY: true, limits: { maxStackHeightM: 3 } })
    useProjects.getState().saveSnapshot({
      ...project,
      deck: { ...project.deck, vesselTemplateId: 'user-a', vesselInfo: info },
    })
    useProjects.setState({ projects: [], activeId: null, hydrated: false })
    useProjects.getState().hydrate()
    expect(useProjects.getState().projects[0].deck.vesselInfo).toEqual({
      label: 'Нептун',
      note: 'Формуляр',
      deckStrengthTPerM2: undefined,
      maxStackHeightM: 3,
      bowFromData: true,
    })
  })
})
