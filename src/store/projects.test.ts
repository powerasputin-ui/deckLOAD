import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useProjects } from './projects'

describe('projects store', () => {
  let storage: Record<string, string> = {}

  beforeEach(() => {
    storage = {}
    useProjects.setState({ projects: [], activeId: null, hydrated: false })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
      removeItem: (key: string) => { delete storage[key] },
    } as Storage)
  })

  it('hydrates with a demo project when storage is empty', () => {
    useProjects.getState().hydrate()
    const state = useProjects.getState()
    expect(state.projects).toHaveLength(1)
    expect(state.activeId).toBe(state.projects[0].id)
    expect(state.hydrated).toBe(true)
  })

  it('does not re-seed the demo project after the user deletes their last project (regression)', () => {
    useProjects.getState().hydrate()
    const demoId = useProjects.getState().projects[0].id
    useProjects.getState().deleteProject(demoId)
    expect(useProjects.getState().projects).toHaveLength(0)

    // Simulate a fresh page load: a new store instance re-runs hydrate(),
    // reading back whatever was persisted (an explicitly empty list, not
    // "nothing was ever saved"). The old bug: loadFromStorage couldn't tell
    // those two cases apart, so this re-seeded the demo project every time.
    useProjects.setState({ hydrated: false })
    useProjects.getState().hydrate()

    expect(useProjects.getState().projects).toHaveLength(0)
    expect(useProjects.getState().activeId).toBeNull()
  })

  it('creates a new project', () => {
    useProjects.getState().hydrate()
    const id = useProjects.getState().createProject('Test Project')
    const state = useProjects.getState()
    expect(state.projects.some((p) => p.name === 'Test Project')).toBe(true)
    expect(state.activeId).toBe(id)
  })

  it('renames a project', () => {
    useProjects.getState().hydrate()
    const id = useProjects.getState().projects[0].id
    useProjects.getState().renameProject(id, 'Renamed')
    expect(useProjects.getState().projects[0].name).toBe('Renamed')
  })

  it('switches active project', () => {
    useProjects.getState().hydrate()
    const first = useProjects.getState().projects[0].id
    const second = useProjects.getState().createProject('Second')
    useProjects.getState().switchTo(first)
    expect(useProjects.getState().activeId).toBe(first)
    useProjects.getState().switchTo(second)
    expect(useProjects.getState().activeId).toBe(second)
  })

  it('deletes a project and switches active to another', () => {
    useProjects.getState().hydrate()
    const first = useProjects.getState().projects[0].id
    const second = useProjects.getState().createProject('Second')
    useProjects.getState().switchTo(second)
    useProjects.getState().deleteProject(second)
    const state = useProjects.getState()
    expect(state.projects).toHaveLength(1)
    expect(state.activeId).toBe(first)
  })

  it('duplicates a project and remaps item ids', () => {
    useProjects.getState().hydrate()
    const original = useProjects.getState().projects[0]
    const copyId = useProjects.getState().duplicateProject(original.id)
    expect(copyId).not.toBeNull()
    const copy = useProjects.getState().projects.find((p) => p.id === copyId)
    expect(copy).toBeDefined()
    expect(copy!.name).toContain('копия')
    expect(copy!.items[0].id).not.toBe(original.items[0].id)
  })

  it('skips a single throwing/malformed project instead of wiping the whole list (regression)', () => {
    // A project entry that isn't even an object (e.g. `null`) makes
    // normalizeProject's own `p.deck?.width` etc. field accesses throw —
    // before this fix, that one bad entry made the entire
    // `.map(normalizeProject)` call throw, which the outer catch treated as
    // "storage totally unreadable", silently discarding every OTHER valid
    // project and reseeding a fresh demo on the next hydrate.
    storage['deckload-projects'] = JSON.stringify({
      projects: [
        null,
        {
          id: 'good-1',
          name: 'Survives',
          deck: { width: 10, length: 5, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
          items: [],
        },
      ],
      activeId: 'good-1',
    })
    useProjects.getState().hydrate()
    const state = useProjects.getState()
    expect(state.projects).toHaveLength(1)
    expect(state.projects[0].name).toBe('Survives')
    expect(state.activeId).toBe('good-1')
  })

  it('normalizes corrupted data on hydrate', () => {
    storage['deckload-projects'] = JSON.stringify({
      projects: [
        {
          id: 'p1',
          name: 'Corrupt',
          items: [{ id: 'i1', name: 'Item', quantity: NaN, width: NaN, height: NaN }],
          manualPlacements: [{ layers: NaN }],
        },
      ],
      activeId: 'p1',
    })
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    expect(project.items[0].quantity).toBe(1)
    expect(project.items[0].width).toBe(1)
    expect(project.manualPlacements[0].layers).toBe(1)
  })

  it('normalizes invalid enum values on hydrate', () => {
    storage['deckload-projects'] = JSON.stringify({
      projects: [
        {
          id: 'p2',
          name: 'Invalid enums',
          deck: { width: -5, length: 0, unit: 'yards', gap: NaN, boardOffset: Infinity, clearance: -1 },
          items: [{ id: 'i2', name: 'Item', quantity: -3, width: -1, length: 0, height: NaN, color: 123, allowRotation: 'maybe' }],
          pinnedPlacementsByTrip: { 0: [{ x: NaN, y: -1, width: 0, length: -2, layers: Infinity }] },
          mode: 'magic',
          sortStrategy: 'unknown',
          globalRotation: 'yes',
        },
      ],
      activeId: 'p2',
    })
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    expect(project.deck.unit).toBe('m')
    expect(project.deck.width).toBe(20)
    expect(project.deck.length).toBe(8)
    expect(project.deck.gap).toBe(0.1)
    expect(project.deck.boardOffset).toBe(0.2)
    expect(project.deck.clearance).toBe(0)
    expect(project.mode).toBe('auto')
    expect(project.sortStrategy).toBe('area-desc')
    expect(project.items[0].quantity).toBe(1)
    expect(project.items[0].width).toBe(1)
    expect(project.items[0].height).toBe(0)
    expect(project.items[0].color).toBe('#0ea5e9')
    expect(project.items[0].allowRotation).toBe(true)
    expect(project.pinnedPlacementsByTrip[0][0].x).toBe(0)
    expect(project.pinnedPlacementsByTrip[0][0].width).toBe(1)
    expect(project.pinnedPlacementsByTrip[0][0].layers).toBe(1)
  })

  it('persists snapshot', () => {
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    useProjects.getState().saveSnapshot({
      id: project.id,
      deck: { width: 99, length: 99, unit: 'm', gap: 0, boardOffset: 0, clearance: 0 },
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      mode: 'auto',
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    })
    expect(useProjects.getState().projects[0].deck.width).toBe(99)
    expect(storage['deckload-projects']).toContain('99')
  })

  // Regression: loadZones/lashingPoints/category/separationRules were being
  // silently dropped by normalizeProject on every reload (and then the next
  // autosave would permanently erase them from storage too). vesselMotion
  // had the exact same bug — never added to this allowlist at all.
  // powerSockets is added preemptively, following the same normalizeLoadZones
  // pattern from day one, so it never hits this bug class in the first place.
  it('round-trips loadZones, lashingPoints, powerSockets, item category, separationRules, and vesselMotion through a reload', () => {
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    useProjects.getState().saveSnapshot({
      id: project.id,
      deck: {
        width: 20,
        length: 8,
        unit: 'm',
        gap: 0.1,
        boardOffset: 0.2,
        clearance: 0,
        loadZones: [{ id: 'z1', x: 1, y: 1, width: 3, length: 3, maxLoadPerArea: 2 }],
        lashingPoints: [{ id: 'l1', x: 5, y: 5, label: 'Точка 1' }],
        powerSockets: [{ id: 's1', x: 4, y: 2, label: 'Розетка 1' }],
        annotations: [{ id: 'a1', x: 6, y: 3, text: 'Осторожно', kind: 'note', leaderX: 5, leaderY: 2 }],
        maxDeckCargoT: 2550,
        tenFootContainerCapacity: 14,
        vesselMotion: { ax: 0.3, ay: 0.5, az: 0.3, friction: 0.3, preset: 'open-sea' },
      },
      items: [
        { id: 'i1', name: 'Груз', width: 1, length: 1, height: 0, quantity: 1, color: '#0ea5e9', allowRotation: true, category: 'hazard' },
      ],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [{ id: 'r1', categoryA: 'hazard', categoryB: 'standard', minDistance: 5 }],
      mode: 'auto',
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    })

    // Simulate a page reload: reset the in-memory store and re-hydrate from
    // the same (persisted) storage stub.
    useProjects.setState({ projects: [], activeId: null, hydrated: false })
    useProjects.getState().hydrate()

    const reloaded = useProjects.getState().projects[0]
    expect(reloaded.deck.loadZones).toEqual([{ id: 'z1', x: 1, y: 1, width: 3, length: 3, maxLoadPerArea: 2 }])
    expect(reloaded.deck.lashingPoints).toEqual([{ id: 'l1', x: 5, y: 5, label: 'Точка 1' }])
    expect(reloaded.deck.powerSockets).toEqual([{ id: 's1', x: 4, y: 2, label: 'Розетка 1' }])
    expect(reloaded.deck.annotations).toEqual([{ id: 'a1', x: 6, y: 3, text: 'Осторожно', kind: 'note', leaderX: 5, leaderY: 2 }])
    expect(reloaded.deck.maxDeckCargoT).toBe(2550)
    expect(reloaded.deck.tenFootContainerCapacity).toBe(14)
    expect(reloaded.items[0].category).toBe('hazard')
    expect(reloaded.separationRules).toEqual([{ id: 'r1', categoryA: 'hazard', categoryB: 'standard', minDistance: 5 }])
    expect(reloaded.deck.vesselMotion).toEqual({ ax: 0.3, ay: 0.5, az: 0.3, friction: 0.3, preset: 'open-sea' })
  })

  // A free note is deliberately placeable OUTSIDE the deck rectangle (see
  // DeckVisualization.tsx's handleAnnotationClick) — negative x/y is real
  // data, not corruption, unlike every other deck-local coordinate in this
  // file (cargo, zones, lashing points) which IS clamped non-negative.
  it('round-trips a negative x/y for a free note placed off the deck edge', () => {
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    useProjects.getState().saveSnapshot({
      id: project.id,
      deck: {
        width: 20,
        length: 8,
        unit: 'm',
        gap: 0.1,
        boardOffset: 0.2,
        clearance: 0,
        annotations: [{ id: 'a1', x: -1.5, y: -0.5, text: 'За бортом', kind: 'note' }],
      },
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      mode: 'auto',
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    })
    useProjects.setState({ projects: [], activeId: null, hydrated: false })
    useProjects.getState().hydrate()
    const reloaded = useProjects.getState().projects[0]
    expect(reloaded.deck.annotations).toEqual([{ id: 'a1', x: -1.5, y: -0.5, text: 'За бортом', kind: 'note', leaderX: undefined, leaderY: undefined }])
  })

  // A leader line needs BOTH endpoints to mean anything — normalizeAnnotations
  // treats a lone leaderX with no leaderY (e.g. a hand-edited/corrupted
  // project file) as "no leader" rather than round-tripping a half-drawn
  // line that would point nowhere.
  it('drops a leader with only one of leaderX/leaderY set, keeping the annotation itself', () => {
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    useProjects.getState().saveSnapshot({
      id: project.id,
      deck: {
        width: 20,
        length: 8,
        unit: 'm',
        gap: 0.1,
        boardOffset: 0.2,
        clearance: 0,
        annotations: [{ id: 'a1', x: 2, y: 2, text: 'Осторожно', leaderX: 5 } as unknown as { id: string; x: number; y: number; text: string }],
      },
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      mode: 'auto',
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    })
    useProjects.setState({ projects: [], activeId: null, hydrated: false })
    useProjects.getState().hydrate()
    const reloaded = useProjects.getState().projects[0]
    expect(reloaded.deck.annotations).toEqual([{ id: 'a1', x: 2, y: 2, text: 'Осторожно', kind: undefined, leaderX: undefined, leaderY: undefined }])
  })

  it('falls back to a valid default when vesselMotion is absent or malformed', () => {
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    useProjects.getState().saveSnapshot({
      id: project.id,
      deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      mode: 'auto',
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    })
    useProjects.setState({ projects: [], activeId: null, hydrated: false })
    useProjects.getState().hydrate()
    expect(useProjects.getState().projects[0].deck.vesselMotion).toBeUndefined()
  })

  // Ship stability data (vessel particulars, hydrostatic table, KN
  // cross-curves, per-item VCG override) — same bug class as loadZones/
  // vesselMotion above: a field missing from normalizeProject's deck
  // allowlist silently vanishes on the very next reload.
  it('round-trips vessel stability data and a per-item stability override through a reload', () => {
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    useProjects.getState().saveSnapshot({
      id: project.id,
      deck: {
        width: 20,
        length: 8,
        unit: 'm',
        gap: 0.1,
        boardOffset: 0.2,
        clearance: 0,
        vessel: {
          particulars: {
            name: 'Тестовое судно',
            lengthBpp: 80,
            breadth: 18,
            lightshipWeightKg: 2_000_000,
            lightshipKG: 5.5,
            lightshipLCG: -1.2,
            lightshipTCG: 0.3,
            longitudinalOrigin: 'midships',
            downfloodingAngleDeg: 28,
          },
          hydrostatics: {
            points: [{ displacementKg: 2_000_000, draftM: 4.0, KM: 7.2, LCB: 0.1, LCF: 0.2, MTC: 120 }],
          },
          knCurves: {
            headingAngles: [0, 10, 20],
            points: [{ displacementKg: 2_000_000, KNByAngle: [0, 1.1, 2.2] }],
          },
          variableWeights: [
            { id: 'w1', name: 'Балласт форпик', weightKg: 50_000, vcgM: 1.0, tcgM: 0, lcgM: 30, freeSurfaceMomentTm: 15 },
          ],
        },
        shipFrame: { originOffsetFromCenterlineM: 0.5, originOffsetFromMidshipsM: -3, heightAboveBaselineM: 6 },
        deckForwardIsPositiveY: false,
      },
      items: [
        {
          id: 'i1',
          name: 'Груз',
          width: 1,
          length: 1,
          height: 1,
          quantity: 1,
          color: '#0ea5e9',
          allowRotation: true,
          stabilityOverride: { vcgAboveDeckM: 0.7, tcgOffsetM: 0.4, lcgOffsetM: -0.6 },
        },
      ],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      mode: 'auto',
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    })

    useProjects.setState({ projects: [], activeId: null, hydrated: false })
    useProjects.getState().hydrate()

    const reloaded = useProjects.getState().projects[0]
    expect(reloaded.deck.vessel?.particulars).toEqual({
      name: 'Тестовое судно',
      lengthBpp: 80,
      breadth: 18,
      lightshipWeightKg: 2_000_000,
      lightshipKG: 5.5,
      lightshipLCG: -1.2,
      lightshipTCG: 0.3,
      longitudinalOrigin: 'midships',
      downfloodingAngleDeg: 28,
    })
    expect(reloaded.deck.vessel?.hydrostatics.points).toEqual([
      { displacementKg: 2_000_000, draftM: 4.0, KM: 7.2, LCB: 0.1, LCF: 0.2, MTC: 120 },
    ])
    expect(reloaded.deck.vessel?.knCurves).toEqual({
      headingAngles: [0, 10, 20],
      points: [{ displacementKg: 2_000_000, KNByAngle: [0, 1.1, 2.2] }],
    })
    expect(reloaded.deck.vessel?.variableWeights).toEqual([
      { id: 'w1', name: 'Балласт форпик', weightKg: 50_000, vcgM: 1.0, tcgM: 0, lcgM: 30, freeSurfaceMomentTm: 15 },
    ])
    expect(reloaded.deck.shipFrame).toEqual({
      originOffsetFromCenterlineM: 0.5,
      originOffsetFromMidshipsM: -3,
      heightAboveBaselineM: 6,
    })
    expect(reloaded.deck.deckForwardIsPositiveY).toBe(false)
    expect(reloaded.items[0].stabilityOverride).toEqual({ vcgAboveDeckM: 0.7, tcgOffsetM: 0.4, lcgOffsetM: -0.6 })
  })

  it('normalizes cleanly to vessel:undefined for a legacy project with no vessel field at all', () => {
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    useProjects.getState().saveSnapshot({
      id: project.id,
      deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      mode: 'auto',
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    })
    useProjects.setState({ projects: [], activeId: null, hydrated: false })
    useProjects.getState().hydrate()
    const reloaded = useProjects.getState().projects[0]
    expect(reloaded.deck.vessel).toBeUndefined()
    expect(reloaded.deck.shipFrame).toBeUndefined()
    expect(reloaded.deck.deckForwardIsPositiveY).toBe(true) // default
  })

  it('drops an individual malformed KN row without discarding the rest of the table', () => {
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    useProjects.getState().saveSnapshot({
      id: project.id,
      deck: {
        width: 20,
        length: 8,
        unit: 'm',
        gap: 0.1,
        boardOffset: 0.2,
        clearance: 0,
        vessel: {
          particulars: {
            lengthBpp: 80,
            breadth: 18,
            lightshipWeightKg: 2_000_000,
            lightshipKG: 5.5,
            lightshipLCG: 0,
            lightshipTCG: 0,
            longitudinalOrigin: 'midships',
          },
          hydrostatics: { points: [] },
          variableWeights: [],
          knCurves: {
            headingAngles: [0, 10, 20],
            points: [
              { displacementKg: 1_000_000, KNByAngle: [0, 1, 2] },
              { displacementKg: 2_000_000, KNByAngle: [0, 1] }, // malformed: wrong length
            ],
          },
        },
      },
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      mode: 'auto',
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    })
    useProjects.setState({ projects: [], activeId: null, hydrated: false })
    useProjects.getState().hydrate()
    const reloaded = useProjects.getState().projects[0]
    expect(reloaded.deck.vessel?.knCurves?.points).toEqual([{ displacementKg: 1_000_000, KNByAngle: [0, 1, 2] }])
  })

  it('migrates legacy flat pinnedPlacements to pinnedPlacementsByTrip on hydrate', () => {
    storage['deckload-projects'] = JSON.stringify({
      projects: [
        {
          id: 'p3',
          name: 'Legacy',
          items: [{ id: 'i1', name: 'Груз', quantity: 1, width: 1, length: 1 }],
          pinnedPlacements: [
            { id: 'pin1', itemId: 'i1', name: 'Груз', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: '#0ea5e9' },
          ],
        },
      ],
      activeId: 'p3',
    })
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    expect(project.pinnedPlacementsByTrip[0]).toHaveLength(1)
    expect(project.pinnedPlacementsByTrip[0][0].id).toBe('pin1')
  })

  it('imports a valid exported project as a new project, ignoring its original id', () => {
    useProjects.getState().hydrate()
    const original = useProjects.getState().projects[0]
    const exported = JSON.parse(JSON.stringify(original))

    const newId = useProjects.getState().importProject(exported)
    expect(newId).not.toBeNull()
    expect(newId).not.toBe(original.id)

    const state = useProjects.getState()
    expect(state.projects).toHaveLength(2)
    expect(state.activeId).toBe(newId)
    const imported = state.projects.find((p) => p.id === newId)!
    expect(imported.items).toHaveLength(original.items.length)
    expect(imported.deck.width).toBe(original.deck.width)
  })

  it('rejects garbage input on import without creating a project', () => {
    useProjects.getState().hydrate()
    const before = useProjects.getState().projects.length

    expect(useProjects.getState().importProject(null)).toBeNull()
    expect(useProjects.getState().importProject('not an object')).toBeNull()
    expect(useProjects.getState().importProject({ foo: 'bar' })).toBeNull()
    expect(useProjects.getState().importProject({ items: [] })).toBeNull() // no `deck`

    expect(useProjects.getState().projects).toHaveLength(before)
  })
})
