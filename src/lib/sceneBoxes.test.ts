import { describe, it, expect } from 'vitest'
import { sceneBoxes, SCENE_SHRINK, type SceneInput } from './sceneBoxes'
import type { PlacedItem } from './packing'
import { deckLevels } from './stability'

// Audit 2026-11-09: the 3D tiers squeezed to a fifth of their height passed
// every test — the scene was built inside the component, where nothing
// reached it without WebGL. Deck-local units, the deck's centre at 0; y up.

const placed = (over: Partial<PlacedItem>): PlacedItem =>
  ({ itemId: 'box', name: 'Ящик', x: 0, y: 0, width: 1, length: 1, height: 2, stackedCount: 1, rotated: false, color: '#000', index: 0, ...over }) as PlacedItem

const input = (p: PlacedItem[], over: Partial<SceneInput> = {}): SceneInput => ({
  placed: p,
  deckWidth: 10,
  deckLength: 20,
  mode: 'auto',
  manualPlacements: [],
  pinnedPlacements: [],
  levels: [],
  unit: 'm',
  ...over,
})

describe('sceneBoxes', () => {
  it('stacks a box\'s tiers at its full height each, a sliver apart, from the deck up', () => {
    const boxes = sceneBoxes(input([placed({ x: 4, y: 9, stackedCount: 3 })]))
    expect(boxes).toHaveLength(3)
    // A gap of min(5 cm, 8 % of the tier) between tiers: 2.05 m apart.
    expect(boxes.map((b) => b.y)).toEqual([1, 3.05, 5.1])
    for (const b of boxes) {
      expect(b.h).toBe(2)
      expect(b.w).toBeCloseTo(SCENE_SHRINK, 12)
      // The deck's centre is the origin: (4.5; 9.5) on 10 × 20.
      expect(b.x).toBeCloseTo(-0.5, 12)
      expect(b.z).toBeCloseTo(-0.5, 12)
    }
  })

  it('lifts a stack standing on an area at its own level', () => {
    const levels = deckLevels([{ id: 'z', x: 0, y: 0, width: 10, length: 10, maxLoadPerArea: 5, elevationM: 3 }], 'm')
    const [box] = sceneBoxes(input([placed({ x: 4, y: 4 })], { levels }))
    expect(box.y).toBe(3 + 1)
  })

  it('piles lying pipes in rows nested in the row below, a radius and √3 radii apart', () => {
    // Six pipes 0.5 m across, 9.5 m long: rows of 3, 2 and 1.
    const pipes = sceneBoxes(input([placed({ itemId: 'p', shape: 'cylinder', width: 9.5, length: 1.5, height: 0.5, stackedCount: 6 })]))
    expect(pipes).toHaveLength(6)
    const heights = [...new Set(pipes.map((b) => Math.round(b.y * 1e9) / 1e9))].sort((a, b) => a - b)
    const r = 0.25
    expect(heights).toEqual([r, r + r * Math.sqrt(3), r + 2 * r * Math.sqrt(3)].map((v) => Math.round(v * 1e9) / 1e9))
    expect(pipes.filter((b) => Math.abs(b.y - r) < 1e-9)).toHaveLength(3)
    for (const b of pipes) {
      expect(b.radius).toBe(r)
      expect(b.cylLen).toBe(9.5)
    }
  })

  it('ties a stack to its placement in manual mode, and offers an unpinned one to pin in auto mode', () => {
    const manual = sceneBoxes(
      input([placed({ index: 0 })], {
        mode: 'manual',
        manualPlacements: [{ id: 'm1', itemId: 'box', name: 'Ящик', x: 0, y: 0, width: 1, length: 1, layers: 1, rotated: false, color: '#000' }],
      })
    )
    expect(manual[0].placementId).toBe('m1')
    const auto = sceneBoxes(input([placed({})]))
    expect(auto[0].placementId).toBeUndefined()
    expect(auto[0].pinData).toMatchObject({ itemId: 'box', x: 0, y: 0, layers: 1 })
  })
})
