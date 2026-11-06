import { describe, it, expect } from 'vitest'
import { linesWeightKg, takenBefore, takenOverItems, vesselSources, vesselTrips } from './cargoTransfer'
import { tripsOfProject } from './trips'
import type { CargoItem } from './packing'
import type { Project } from '@/store/projects'

// Spec 2026-11-06, 13: a vessel's trip, its cargo onto a platform.

const item = (over: Partial<CargoItem>): CargoItem => ({ id: 'x', name: 'Груз', width: 2, length: 2, height: 1, quantity: 1, color: '#000', allowRotation: false, weight: 1_000, ...over })

const project = (over: Omit<Partial<Project>, 'deck'> & { deck?: Partial<Project['deck']> } = {}): Project => {
  const { deck, ...rest } = over
  return {
    id: 'vessel',
    name: 'Нептун',
    createdAt: 0,
    updatedAt: 0,
    deck: { width: 6, length: 6, unit: 'm', gap: 0, boardOffset: 0, clearance: 0, ...deck },
    items: [],
    manualPlacements: [],
    pinnedPlacementsByTrip: {},
    separationRules: [],
    mode: 'auto',
    sortStrategy: 'area-desc',
    globalRotation: false,
    showFreeSpace: true,
    showGrid: true,
    showLabels: true,
    showCargoContents: true,
    ...rest,
  }
}

describe('vesselSources', () => {
  it('offers every saved calculation of a vessel but the open one', () => {
    const list = [project({ id: 'a' }), project({ id: 'open' }), project({ id: 'rig', deck: { objectKind: 'semi-sub' } }), project({ id: 'b' })]
    expect(vesselSources(list, 'open').map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('vesselTrips', () => {
  it('gives each trip the vessel\'s screen shows with the units it places', () => {
    // A 6 × 6 deck takes nine 2 × 2 boxes a trip: 12 go in 9 + 3.
    const p = project({ items: [item({ id: 'box', name: 'Ящик', quantity: 12 })] })
    const trips = vesselTrips(p)
    expect(trips.map((t) => t.lines.map((l) => [l.item.id, l.units]))).toEqual([[['box', 9]], [['box', 3]]])
    expect(trips.length).toBe(tripsOfProject(p).length)
  })

  it('counts a mixed stack\'s layers for each of its cargo', () => {
    const p = project({
      items: [item({ id: 'a', name: 'A', quantity: 2 }), item({ id: 'b', name: 'B', quantity: 3 })],
      pinnedPlacementsByTrip: {
        0: [{ id: 'pin', itemId: 'a', name: 'A', color: '#000', x: 0, y: 0, width: 2, length: 2, layers: 5, rotated: false, composition: [{ itemId: 'a', layers: 2 }, { itemId: 'b', layers: 3 }] }],
      },
    })
    const [first] = vesselTrips(p)
    expect(first.lines.map((l) => [l.item.id, l.units])).toEqual([['a', 2], ['b', 3]])
  })

  it('leaves out what fits on no trip', () => {
    const p = project({ items: [item({ id: 'big', width: 10, length: 10 }), item({ id: 'box' })] })
    expect(vesselTrips(p).flatMap((t) => t.lines.map((l) => l.item.id))).toEqual(['box'])
  })
})

describe('takenOverItems', () => {
  const source = { projectId: 'vessel', projectName: 'Нептун', trip: 1 }
  let n = 0
  const newId = () => `new-${++n}`

  it('copies the cargo in the platform\'s unit, with its own ids, the trip\'s units, arriving and its source', () => {
    const lines = [
      {
        item: item({ id: 'pipe', name: 'Труба', width: 1200, length: 50, height: 50, quantity: 40, weight: 2_000, maxStackHeightM: 2, stabilityOverride: { vcgAboveDeckM: 30 }, platformStatus: 'onboard' }),
        units: 24,
      },
    ]
    const [copy] = takenOverItems(lines, 'cm', 'm', source, newId)
    expect(copy).toMatchObject({ name: 'Труба', width: 12, length: 0.5, height: 0.5, quantity: 24, weight: 2_000, maxStackHeightM: 2, platformStatus: 'incoming', from: source })
    expect(copy.stabilityOverride?.vcgAboveDeckM).toBeCloseTo(0.3, 12)
    expect(copy.id).toMatch(/^new-/)
  })

  it('weighs the lines, cargo without a weight adding nothing', () => {
    expect(linesWeightKg([{ item: item({ weight: 2_000 }), units: 3 }, { item: item({ weight: undefined }), units: 5 }])).toBe(6_000)
  })

  it('finds what the trip brought before by its calculation, or one of the same name opened again from a file', () => {
    const list = [
      item({ id: 'same', from: source }),
      item({ id: 'reopened', from: { ...source, projectId: 'file-copy' } }),
      item({ id: 'other-trip', from: { ...source, trip: 0 } }),
      item({ id: 'other-vessel', from: { projectId: 'x', projectName: 'Норд', trip: 1 } }),
      item({ id: 'own' }),
    ]
    expect(takenBefore(list, { id: 'vessel', name: 'Нептун' }, 1).map((it) => it.id)).toEqual(['same', 'reopened'])
  })
})
