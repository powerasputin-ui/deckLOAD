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

  // Regression: normalizeLashingPoints only kept id/x/y/label — a lashing
  // point is a full engineering record (which placement/cargo it secures,
  // attachment corner, angle off the deck plane, rated MSL, device type),
  // and all six of those used to be silently dropped on every reload,
  // turning a real securing arrangement back into a decorative dot.
  it('round-trips a lashing point\'s full engineering data (placementId, itemId, corner, angle, MSL, device type) through a reload', () => {
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
        lashingPoints: [
          {
            id: 'l1',
            x: 5,
            y: 5,
            label: 'Найтов 1',
            placementId: 'p1',
            itemId: 'i1',
            cornerX: 4.5,
            cornerY: 4.5,
            verticalAngleDeg: 45,
            mslKg: 30000,
            deviceType: 'chain_g80_10',
          },
        ],
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
    expect(reloaded.deck.lashingPoints).toEqual([
      {
        id: 'l1',
        x: 5,
        y: 5,
        label: 'Найтов 1',
        placementId: 'p1',
        itemId: 'i1',
        cornerX: 4.5,
        cornerY: 4.5,
        verticalAngleDeg: 45,
        mslKg: 30000,
        deviceType: 'chain_g80_10',
      },
    ])
  })

  // Regression: duplicateProject built an itemIdMap for manual/pinned
  // placements but never touched deck.lashingPoints at all, and had no
  // placementIdMap either — every lashing point in the copy kept pointing
  // at the ORIGINAL project's item/placement ids, which don't exist in the
  // copy, silently orphaning every securing arrangement on duplicate.
  it('duplicateProject remaps lashingPoints\' itemId/placementId to the copy\'s own ids', () => {
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
        lashingPoints: [{ id: 'l1', x: 1, y: 1, placementId: 'orig-placement', itemId: 'orig-item', mslKg: 10000 }],
      },
      items: [{ id: 'orig-item', name: 'Груз', width: 1, length: 1, height: 0, quantity: 1, color: '#0ea5e9', allowRotation: true }],
      manualPlacements: [{ id: 'orig-placement', itemId: 'orig-item', name: 'Груз', x: 0, y: 0, width: 1, length: 1, layers: 1, rotated: false, color: '#0ea5e9' }],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      mode: 'manual',
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    })

    const copyId = useProjects.getState().duplicateProject(project.id)!
    const copy = useProjects.getState().projects.find((p) => p.id === copyId)!

    const newItemId = copy.items[0].id
    const newPlacementId = copy.manualPlacements[0].id
    expect(newItemId).not.toBe('orig-item')
    expect(newPlacementId).not.toBe('orig-placement')
    expect(copy.deck.lashingPoints).toEqual([
      { id: 'l1', x: 1, y: 1, placementId: newPlacementId, itemId: newItemId, mslKg: 10000 },
    ])
  })

  // Round 13 (composition data-model foundation): duplicateProject's
  // itemIdMap remap only ever touched a placement's own top-level itemId —
  // a composed placement's constituent itemIds live one level deeper
  // (composition[].itemId) and were left pointing at the ORIGINAL
  // project's item ids, exactly the trap the migration plan flagged.
  it('duplicateProject remaps composition[].itemId to the copy\'s own item ids, for both manual and pinned', () => {
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    useProjects.getState().saveSnapshot({
      id: project.id,
      deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 5 },
      items: [
        { id: 'orig-A', name: 'A', width: 1, length: 1, height: 1, quantity: 5, color: '#0ea5e9', allowRotation: true, weight: 500 },
        { id: 'orig-B', name: 'B', width: 1, length: 1, height: 1, quantity: 5, color: '#f59e0b', allowRotation: true, weight: 800 },
      ],
      manualPlacements: [
        { id: 'orig-mp', itemId: 'orig-A', name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: '#0ea5e9', weight: 620, composition: [{ itemId: 'orig-A', layers: 2 }, { itemId: 'orig-B', layers: 3 }] },
      ],
      pinnedPlacementsByTrip: {
        0: [{ id: 'orig-pp', itemId: 'orig-B', name: 'B', x: 2, y: 2, width: 1, length: 1, layers: 4, rotated: false, color: '#f59e0b', weight: 700, composition: [{ itemId: 'orig-B', layers: 3 }, { itemId: 'orig-A', layers: 1 }] }],
      },
      separationRules: [],
      mode: 'manual',
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    })

    const copyId = useProjects.getState().duplicateProject(project.id)!
    const copy = useProjects.getState().projects.find((p) => p.id === copyId)!

    const newA = copy.items.find((it) => it.name === 'A')!.id
    const newB = copy.items.find((it) => it.name === 'B')!.id
    expect(newA).not.toBe('orig-A')
    expect(newB).not.toBe('orig-B')

    expect(copy.manualPlacements[0].composition).toEqual([{ itemId: newA, layers: 2 }, { itemId: newB, layers: 3 }])
    expect(copy.pinnedPlacementsByTrip[0][0].composition).toEqual([{ itemId: newB, layers: 3 }, { itemId: newA, layers: 1 }])
  })

  // Round 13: normalizeComposition sanitizer, exercised through hydrate
  // (same path real corrupted/hand-edited storage would go through).
  describe('composition sanitization on hydrate', () => {
    it('keeps a valid composition (all itemIds resolve, positive integer layers)', () => {
      storage['deckload-projects'] = JSON.stringify({
        projects: [{
          id: 'p1',
          name: 'Composed',
          deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 5 },
          items: [
            { id: 'A', name: 'A', width: 1, length: 1, height: 1, quantity: 5, weight: 500 },
            { id: 'B', name: 'B', width: 1, length: 1, height: 1, quantity: 5, weight: 800 },
          ],
          manualPlacements: [{ id: 'm1', itemId: 'A', name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: '#0ea5e9', weight: 620, composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }] }],
        }],
        activeId: 'p1',
      })
      useProjects.getState().hydrate()
      const project = useProjects.getState().projects[0]
      expect(project.manualPlacements[0].composition).toEqual([{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }])
      // A valid composition present -> legacy detection must NOT fire,
      // even though the stored weight (620) is a real blend, not either
      // constituent's own catalog weight.
      expect(project.manualPlacements[0].legacyUnknownComposition).toBeUndefined()
    })

    it('falls back to undefined (ordinary placement) when a segment references an itemId that does not exist', () => {
      storage['deckload-projects'] = JSON.stringify({
        projects: [{
          id: 'p1',
          name: 'BadComposition',
          deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 5 },
          items: [{ id: 'A', name: 'A', width: 1, length: 1, height: 1, quantity: 5, weight: 500 }],
          manualPlacements: [{ id: 'm1', itemId: 'A', name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: '#0ea5e9', weight: 500, composition: [{ itemId: 'A', layers: 2 }, { itemId: 'ghost-item', layers: 3 }] }],
        }],
        activeId: 'p1',
      })
      useProjects.getState().hydrate()
      expect(useProjects.getState().projects[0].manualPlacements[0].composition).toBeUndefined()
    })

    it('falls back to undefined for a single-segment array (composed requires 2+ segments) and for non-positive layers', () => {
      storage['deckload-projects'] = JSON.stringify({
        projects: [{
          id: 'p1',
          name: 'Degenerate',
          deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 5 },
          items: [{ id: 'A', name: 'A', width: 1, length: 1, height: 1, quantity: 5, weight: 500 }, { id: 'B', name: 'B', width: 1, length: 1, height: 1, quantity: 5, weight: 800 }],
          manualPlacements: [
            { id: 'm1', itemId: 'A', name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 2, rotated: false, color: '#0ea5e9', weight: 500, composition: [{ itemId: 'A', layers: 2 }] },
            { id: 'm2', itemId: 'A', name: 'A', x: 2, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: '#0ea5e9', weight: 620, composition: [{ itemId: 'A', layers: -2 }, { itemId: 'B', layers: 3 }] },
          ],
        }],
        activeId: 'p1',
      })
      useProjects.getState().hydrate()
      const placements = useProjects.getState().projects[0].manualPlacements
      expect(placements[0].composition).toBeUndefined() // single-segment
      expect(placements[1].composition).toBeUndefined() // negative layers
    })

    // Regression: normalizeComposition used to accept a fractional layers
    // value and silently Math.round() it (1.4->1, but 1.6->2, 2.51->3) —
    // quietly turning corrupted input into a DIFFERENT number instead of
    // rejecting it. A trust boundary for saved/imported JSON must refuse
    // invalid data, not guess what it "probably meant".
    it('rejects (falls back to undefined) a fractional layers value instead of rounding it', () => {
      storage['deckload-projects'] = JSON.stringify({
        projects: [{
          id: 'p1',
          name: 'FractionalLayers',
          deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 5 },
          items: [
            { id: 'A', name: 'A', width: 1, length: 1, height: 1, quantity: 5, weight: 500 },
            { id: 'B', name: 'B', width: 1, length: 1, height: 1, quantity: 5, weight: 800 },
          ],
          manualPlacements: [
            { id: 'm1', itemId: 'A', name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 4, rotated: false, color: '#0ea5e9', weight: 620, composition: [{ itemId: 'A', layers: 2.51 }, { itemId: 'B', layers: 1 }] },
          ],
        }],
        activeId: 'p1',
      })
      useProjects.getState().hydrate()
      // 2.51 must NOT silently become 3 (or 2) — the whole composition is
      // rejected, same as any other malformed segment.
      expect(useProjects.getState().projects[0].manualPlacements[0].composition).toBeUndefined()
    })
  })

  // Round 13: legacy merge-ghost detection (Legacy migration section of the
  // migration plan) — a placement with NO composition whose weight doesn't
  // match its own item's current catalog weight is flagged, not silently
  // trusted or resynced.
  describe('legacyUnknownComposition detection on hydrate', () => {
    it('flags a placement whose weight does not match its catalog item (no composition present)', () => {
      storage['deckload-projects'] = JSON.stringify({
        projects: [{
          id: 'p1',
          name: 'LegacyGhost',
          deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 5 },
          items: [{ id: 'B', name: 'B', width: 1, length: 1, height: 1, quantity: 5, weight: 900 }],
          manualPlacements: [{ id: 'm1', itemId: 'B', name: 'B', x: 0, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: '#0ea5e9', weight: 620 }],
        }],
        activeId: 'p1',
      })
      useProjects.getState().hydrate()
      expect(useProjects.getState().projects[0].manualPlacements[0].legacyUnknownComposition).toBe(true)
    })

    it('does not flag a placement whose weight matches its catalog item', () => {
      storage['deckload-projects'] = JSON.stringify({
        projects: [{
          id: 'p1',
          name: 'Ordinary',
          deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 5 },
          items: [{ id: 'B', name: 'B', width: 1, length: 1, height: 1, quantity: 5, weight: 900 }],
          manualPlacements: [{ id: 'm1', itemId: 'B', name: 'B', x: 0, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: '#0ea5e9', weight: 900 }],
        }],
        activeId: 'p1',
      })
      useProjects.getState().hydrate()
      expect(useProjects.getState().projects[0].manualPlacements[0].legacyUnknownComposition).toBeUndefined()
    })

    it('does not flag a placement with no weight at all, or one whose item no longer exists', () => {
      storage['deckload-projects'] = JSON.stringify({
        projects: [{
          id: 'p1',
          name: 'NoWeight',
          deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 5 },
          items: [{ id: 'B', name: 'B', width: 1, length: 1, height: 1, quantity: 5 }],
          manualPlacements: [
            { id: 'm1', itemId: 'B', name: 'B', x: 0, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: '#0ea5e9' },
            { id: 'm2', itemId: 'ghost', name: 'Ghost', x: 2, y: 0, width: 1, length: 1, layers: 1, rotated: false, color: '#0ea5e9', weight: 620 },
          ],
        }],
        activeId: 'p1',
      })
      useProjects.getState().hydrate()
      const placements = useProjects.getState().projects[0].manualPlacements
      expect(placements[0].legacyUnknownComposition).toBeUndefined()
      expect(placements[1].legacyUnknownComposition).toBeUndefined()
    })
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

  // Regression: normalizeVesselParticulars silently dropped these four
  // fields entirely — minGM especially, since it REPLACES the generic
  // stability reference minimum everywhere it's set (see VesselParticulars'
  // own doc comment in stability.ts). Losing it on reload meant the app
  // quietly fell back to a generic minimum the vessel's own booklet had
  // already overridden, with no indication anything changed.
  it('round-trips minGM, windageAreaM2, windageLeverM, and blockCoefficient through a reload', () => {
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
            minGM: 1.22,
            windageAreaM2: 450,
            windageLeverM: 6.5,
            blockCoefficient: 0.68,
          },
          hydrostatics: { points: [] },
          knCurves: { headingAngles: [], points: [] },
          variableWeights: [],
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
    expect(reloaded.deck.vessel?.particulars.minGM).toBe(1.22)
    expect(reloaded.deck.vessel?.particulars.windageAreaM2).toBe(450)
    expect(reloaded.deck.vessel?.particulars.windageLeverM).toBe(6.5)
    expect(reloaded.deck.vessel?.particulars.blockCoefficient).toBe(0.68)
  })

  // Regression: normalizeKNCrossCurves used to filter headingAngles and each
  // point's KNByAngle independently, then only compare final LENGTHS — two
  // arrays that each drop a different index can end up the same length
  // while no longer corresponding to the same angles at all. A row whose
  // own KN array is corrupted at a DIFFERENT index than the shared angle
  // array's corruption must be dropped entirely, not kept misaligned.
  it('drops a KN row whose own corrupted index does not match the heading-angle array\'s (does not silently misalign)', () => {
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
          },
          hydrostatics: { points: [] },
          knCurves: {
            // headingAngles corrupted at index 2 (NaN) -> surviving indices [0,1,3]
            headingAngles: [0, 10, Number.NaN, 30],
            points: [
              // This row's OWN corruption is at index 3, not 2 -- after
              // independently filtering, both arrays end up length 3, but
              // this row's surviving values [0, 1.0, 2.0] no longer belong
              // to angles [0, 10, 30] at all (2.0 was paired with the
              // dropped 30°, not with the surviving 30° index). Must be
              // dropped, not kept as if it were still valid.
              { displacementKg: 2_000_000, KNByAngle: [0, 1.0, 2.0, Number.NaN] },
            ],
          },
          variableWeights: [],
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
    // The one row given is corrupted and must be dropped entirely -- with
    // no surviving points, knCurves itself normalizes to undefined (same
    // rule as an empty points array from any other cause).
    expect(reloaded.deck.vessel?.knCurves).toBeUndefined()
  })

  // Regression: downfloodingAngleDeg only checked Number.isFinite, letting
  // physically meaningless values (negative, or past 90°) through into
  // checkIMOCriteria's boundary clamps.
  it('rejects a physically meaningless downfloodingAngleDeg (negative or past 90°) instead of storing it', () => {
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
            downfloodingAngleDeg: -10,
          },
          hydrostatics: { points: [] },
          knCurves: { headingAngles: [], points: [] },
          variableWeights: [],
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

    expect(useProjects.getState().projects[0].deck.vessel?.particulars.downfloodingAngleDeg).toBeUndefined()
  })

  // Regression: minGM REPLACES the generic stability reference minimum
  // wherever it's set — a negative value used to pass straight through,
  // making `GM_fluid >= minGM` a near-guaranteed false PASS.
  it('rejects a negative minGM instead of storing it', () => {
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
            minGM: -10,
          },
          hydrostatics: { points: [] },
          knCurves: { headingAngles: [], points: [] },
          variableWeights: [],
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

    expect(useProjects.getState().projects[0].deck.vessel?.particulars.minGM).toBeUndefined()
  })

  // Regression: a negative freeSurfaceMomentTm used to pass straight
  // through — computeFreeSurfaceCorrection sums it directly, so a negative
  // value would REDUCE the correction subtracted from GM_solid, artificially
  // inflating the reported GM_fluid instead of ever correctly costing
  // stability.
  it('rejects a negative freeSurfaceMomentTm instead of storing it (0 itself still round-trips)', () => {
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
          },
          hydrostatics: { points: [] },
          knCurves: { headingAngles: [], points: [] },
          variableWeights: [
            { id: 'w1', name: 'Танк A (отрицательный)', weightKg: 10000, vcgM: 1, tcgM: 0, lcgM: 0, freeSurfaceMomentTm: -5 },
            { id: 'w2', name: 'Танк B (подтверждённый ноль)', weightKg: 10000, vcgM: 1, tcgM: 0, lcgM: 0, freeSurfaceMomentTm: 0 },
          ],
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

    const weights = useProjects.getState().projects[0].deck.vessel?.variableWeights
    expect(weights?.find((w) => w.id === 'w1')?.freeSurfaceMomentTm).toBeUndefined()
    expect(weights?.find((w) => w.id === 'w2')?.freeSurfaceMomentTm).toBe(0)
  })

  // Regression: a negative cargo weight used to pass straight through.
  // buildCargoWeightMoments already excludes it from the stability calc
  // either way, but packing totals/UI/PDF had no such guard.
  it('rejects a negative cargo weight instead of storing it', () => {
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    useProjects.getState().saveSnapshot({
      id: project.id,
      deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
      items: [
        { id: 'i1', name: 'Груз', width: 1, length: 1, height: 0, quantity: 1, color: '#0ea5e9', allowRotation: true, weight: -50000 },
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

    expect(useProjects.getState().projects[0].items[0].weight).toBeUndefined()
  })

  // Regression: normalizeProject used toPositiveInt for quantity, which
  // treats 0 the same as "no value given" and falls back to 1 — turning a
  // deliberately zeroed-out cargo (e.g. after deleting every placed unit)
  // back into a phantom quantity of 1 on every reload/import.
  it('preserves cargo quantity 0 through a reload (does not resurrect it to 1)', () => {
    useProjects.getState().hydrate()
    const project = useProjects.getState().projects[0]
    useProjects.getState().saveSnapshot({
      id: project.id,
      deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
      items: [
        { id: 'i1', name: 'Груз', width: 1, length: 1, height: 0, quantity: 0, color: '#0ea5e9', allowRotation: true },
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

    expect(useProjects.getState().projects[0].items[0].quantity).toBe(0)
  })

  // Regression: a top-level JSON.parse failure (corrupted localStorage
  // record, not "nothing saved yet") used to be indistinguishable from a
  // first visit — hydrate() seeded a demo project AND called saveToStorage,
  // permanently overwriting whatever was actually in localStorage before
  // the user had any chance to notice or recover it.
  it('does not overwrite a corrupted top-level localStorage record with a fresh demo', () => {
    storage['deckload-projects'] = '{not valid json'
    useProjects.getState().hydrate()

    // The app still shows a usable demo in memory...
    expect(useProjects.getState().projects).toHaveLength(1)
    // ...but the corrupted string in storage must be left untouched, not
    // clobbered by an automatic save of that in-memory demo.
    expect(storage['deckload-projects']).toBe('{not valid json')
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
