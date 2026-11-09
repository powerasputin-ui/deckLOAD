// The 3D scene's solids (spec 6.1, «3D»): every stack of a trip as the
// boxes, cylinders and drawn outlines Deck3DView meshes — kept out of the
// component (audit 2026-11-09: its tiers collapsed fivefold passed every
// test, nothing reached them without WebGL). Deck-local units, the deck's
// centre at the origin; y is up.
import { cargoToneForNumber } from './cargoPalette'
import { decomposePipePyramid, rotateOutline90, type ManualPlacement, type PackingResult, type PinnedPlacement } from './packing'
import { pipeNestTierOffsets } from './pipeNest'
import { placementLevel, type DeckLevel } from './stability'
import { convertLength, type Unit } from './units'

const SQRT3 = Math.sqrt(3)
// Real gaps between neighbouring footprints can be tiny (the deck's own
// "gap" setting is often just a few cm against a many-metre deck) — at
// typical camera distance that seam all but disappears, so same-colour
// neighbours read as one fused blob instead of separate units. Shrinking
// each box slightly around its own centre leaves a visible sliver of deck
// between every placement, at every zoom level — the clarity the 2D view
// gets from each rect's own stroke outline.
export const SCENE_SHRINK = 0.94

// What a click on a stack the packer placed pins.
export interface PinData {
  itemId: string
  name: string
  x: number
  y: number
  width: number
  length: number
  layers: number
  rotated: boolean
  color: string
  weight?: number
}

export interface SceneBox {
  key: string
  placementId?: string
  pinData?: PinData
  color: string
  x: number
  y: number
  z: number
  w?: number
  d?: number
  h?: number
  radius?: number
  cylLen?: number
  rot?: [number, number, number]
  radialSegments?: number
  scaleZ?: number
  customOutline?: { x: number; y: number }[]
  depth?: number
}

export interface SceneInput {
  placed: PackingResult['placed']
  deckWidth: number
  deckLength: number
  mode: 'auto' | 'manual'
  manualPlacements: readonly ManualPlacement[]
  pinnedPlacements: readonly PinnedPlacement[]
  cargoNumberByItemId?: ReadonlyMap<string, number>
  // The deck's areas at their own levels, in metres (deckLevels(…, 'm')).
  levels: readonly DeckLevel[]
  unit: Unit
}

export function sceneBoxes({ placed, deckWidth, deckLength, mode, manualPlacements, pinnedPlacements, cargoNumberByItemId, levels, unit }: SceneInput): SceneBox[] {
  const SHRINK = SCENE_SHRINK
  const out: SceneBox[] = []

  // Manual mode's placed is built (packingResultFromManual) with
  // `index` matching the source `manualPlacements` array 1:1, so the
  // placement id is a direct lookup. Auto mode's placed mixes
  // pinned AND algorithm-placed items with no such index correspondence —
  // match a pin the same way the 2D view already does (DeckVisualization
  // "matchingPin": same itemId + near-identical x/y), since only pinned
  // placements are meant to be individually selectable there.
  const placementIdFor = (p: PackingResult['placed'][number]): string | undefined => {
    if (mode === 'manual') return manualPlacements[p.index]?.id
    const pin = pinnedPlacements.find(
      (pp) => pp.itemId === p.itemId && Math.abs(pp.x - p.x) < 0.01 && Math.abs(pp.y - p.y) < 0.01
    )
    return pin?.id
  }

  // `PlacedItem.index` is NOT globally unique across placed in auto
  // mode — pinned and algorithm-placed items are numbered from separate
  // counters in packing.ts, so a pinned item and an auto-placed item of
  // the same cargo type can both land on `index: 0`. Keying meshes off
  // `p.index` then collided (React "duplicate key" warning, and one of
  // the two silently failed to render) — count array position locally
  // instead, which is always unique regardless of the source counters.
  let pIdx = 0
  for (const p of placed) {
    const thisIdx = pIdx++
    const placementId = placementIdFor(p)
    const cargoNumber = cargoNumberByItemId?.get(p.itemId)
    const tone = cargoNumber ? cargoToneForNumber(cargoNumber) : p.color
    // Only relevant in auto mode for a not-yet-pinned (algorithm-placed)
    // item — gives handleClick enough to pin it in place on first click.
    const pinData: PinData | undefined =
      mode === 'auto' && !placementId
        ? {
            itemId: p.itemId,
            name: p.name,
            x: p.x,
            y: p.y,
            width: p.width,
            length: p.length,
            layers: p.stackedCount,
            rotated: p.rotated,
            color: p.color,
            weight: p.weight,
          }
        : undefined
    const cx = p.x + p.width / 2 - deckWidth / 2
    const cz = p.y + p.length / 2 - deckLength / 2
    const layers = Math.max(1, p.stackedCount)
    // On an area at its own level (LoadZone.elevationM) the stack stands
    // that much higher, or lower, as the stability has it.
    const lift = convertLength(placementLevel(levels, p), 'm', unit)

    // Hand-drawn custom outline (incl. concave — L/Z shapes) — checked
    // BEFORE the height<=0 fallback below, since a freshly drawn shape
    // defaults to height 0 (no height field in the draw finalize form)
    // and would otherwise always take the plain-box fallback, silently
    // never reaching the real extrusion branch. `p.outline` is stored in
    // the item's own local UNROTATED frame; resolve it into the
    // post-rotation bbox frame the same way the 2D FootprintShape does
    // (rotateOutline90 is the single shared implementation, so the two
    // views can't drift apart on this).
    if (p.shape === 'custom' && p.outline && p.outline.length >= 3) {
      const origWidth = p.rotated ? p.length : p.width
      const origLength = p.rotated ? p.width : p.length
      const localOutline = p.rotated ? rotateOutline90(p.outline, origWidth, origLength) : p.outline
      const depth = p.height > 0 ? p.height : 0.3
      const tierPitch0 = depth + Math.min(0.05, depth * 0.08)
      for (let layer = 0; layer < layers; layer++) {
        out.push({
          key: `${p.itemId}-${thisIdx}-${layer}`,
          placementId,
          pinData,
          customOutline: localOutline,
          depth,
          x: cx - p.width / 2,
          z: cz - p.length / 2,
          y: lift + layer * tierPitch0,
          color: tone,
        })
      }
      continue
    }

    if (p.height <= 0) {
      out.push({ key: `${p.itemId}-${thisIdx}`, placementId, pinData, w: p.width * SHRINK, d: p.length * SHRINK, h: 0.3, x: cx, y: lift + 0.15, z: cz, color: tone })
      continue
    }

    // A small gap between tiers (proportional to tier height, capped so it
    // stays subtle even for very tall cargo) makes the seam readable
    // without visually inflating the stack's true height much.
    const gap = Math.min(0.05, p.height * 0.08)
    const tierPitch = p.height + gap

    // Odd-shaped real cargo (added for the "Объекты" preset category) —
    // stands upright like a barrel, no pyramid/pipe logic. One shared unit
    // cylinder geometry (radius 0.5) covers all four: circle/oval use a
    // smooth 32-sided rim, triangle/diamond use 3/4 sides; the non-uniform
    // `scaleZ` (relative to the X radius) turns a round cross-section into
    // an oval, and turns the width×length bounding box into the right
    // footprint for the others too. No extra rotation on the diamond —
    // `CylinderGeometry`'s own default vertex layout already puts its
    // corners along the X/Z axes, the same "corner at each edge midpoint"
    // orientation the 2D diamond polygon uses, so the two views agree
    // without needing a corrective spin.
    const polygonSides: Record<string, number> = { circle: 32, oval: 32, triangle: 3, diamond: 4 }
    if (p.shape && p.shape in polygonSides) {
      const radius = p.width / 2
      for (let layer = 0; layer < layers; layer++) {
        out.push({
          key: `${p.itemId}-${thisIdx}-${layer}`,
          placementId,
          pinData,
          radius,
          cylLen: p.height,
          radialSegments: polygonSides[p.shape],
          scaleZ: p.length / (p.width || 1),
          x: cx,
          z: cz,
          y: lift + layer * tierPitch + p.height / 2,
          color: tone,
        })
      }
      continue
    }

    // A real pipe штабель (shape 'pipe-nest') — a straight, uniform-tier
    // stack (see src/lib/pipeNest.ts's own doc comment for why this is
    // NOT the same shape as the pyramid pile a few branches below: every
    // tier holds the same pipe count, stacked directly above the tier
    // beneath it, on a timber crib of height p.nest.crateHeightM). Real
    // per-pipe positions, not an approximation — same "across" axis
    // convention (acrossIsX) the pyramid branch below uses, so a
    // straight nest and a free pyramid pile orient identically.
    if (p.shape === 'pipe-nest' && p.nest) {
      const { pipeOuterDiameterM: od, pipeLengthM: pipeLen, pipesPerRow, tierCounts, crateHeightM } = p.nest
      const radius = od / 2
      const rot: [number, number, number] = p.width >= p.length ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]
      const acrossIsX = !(p.width >= p.length)
      let seq = 0
      tierCounts.forEach((count, tierIndex) => {
        const tierY = crateHeightM + tierIndex * od + od / 2
        for (const offsetUnits of pipeNestTierOffsets(pipesPerRow, count)) {
          const across = offsetUnits * radius
          out.push({
            key: `${p.itemId}-${thisIdx}-${seq++}`,
            placementId,
            pinData,
            radius,
            cylLen: pipeLen,
            rot,
            x: cx + (acrossIsX ? across : 0),
            y: lift + tierY,
            z: cz + (acrossIsX ? 0 : across),
            color: tone,
          })
        }
      })
      continue
    }

    if (p.shape !== 'cylinder') {
      for (let layer = 0; layer < layers; layer++) {
        out.push({
          key: `${p.itemId}-${thisIdx}-${layer}`,
          placementId,
          pinData,
          w: p.width * SHRINK,
          d: p.length * SHRINK,
          h: p.height,
          x: cx,
          z: cz,
          y: lift + layer * tierPitch + p.height / 2,
          color: tone,
        })
      }
      continue
    }

    // Cylinder cargo. A barrel-shaped footprint (roughly square, tall)
    // stands upright; a pipe-shaped one (one dimension much longer than
    // the other, both much larger than its height) lies on its side —
    // rotated so the cylinder's axis runs along whichever of width/length
    // is the long one, with the radius taken from the short footprint
    // dimension (its round cross-section). Computed once per item here
    // (used to be recomputed per rendered mesh), since the pyramid layout
    // below needs it before generating per-layer entries.
    const longSpan = Math.max(p.width, p.length)
    const shortSpan = Math.min(p.width, p.length)
    const isPipe = longSpan > shortSpan * 1.5 && longSpan > p.height * 1.5
    const radius = isPipe ? Math.min(shortSpan, p.height) / 2 : shortSpan / 2
    const cylLen = isPipe ? longSpan : p.height
    const rot: [number, number, number] = isPipe
      ? (p.width >= p.length ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0])
      : [0, 0, 0]

    if (!isPipe || layers <= 1) {
      // Barrels keep stacking straight up (rim-on-rim is physically fine),
      // and a lone pipe obviously has no pyramid to form.
      for (let layer = 0; layer < layers; layer++) {
        out.push({
          key: `${p.itemId}-${thisIdx}-${layer}`,
          placementId,
          pinData,
          radius,
          cylLen,
          rot,
          x: cx,
          z: cz,
          y: lift + layer * tierPitch + p.height / 2,
          color: tone,
        })
      }
      continue
    }

    // Pyramid pile for stacked pipes: decompose `layers` round units into
    // decreasing rows — base row widest, each row above one unit narrower
    // — nested in the "valley" of the row below, the way round stock
    // (pipes/rebar) actually piles up. Boxes/barrels above stack straight
    // instead, which is physically correct for square/upright cargo but
    // was, until now, also being applied to pipes, which is not. The row
    // layout and per-unit centering both live in decomposePipePyramid
    // (packing.ts) — this loop just scales its radius-unit offsets and
    // row heights into world space.
    const acrossIsX = !(p.width >= p.length) // the pipe's own axis runs along whichever world axis is "long"; rows spread out along the OTHER one
    const rows = decomposePipePyramid(layers)
    let seq = 0
    for (const row of rows) {
      const rowY = radius + row.rowIndex * radius * SQRT3
      for (const offsetUnits of row.offsets) {
        const across = offsetUnits * radius
        out.push({
          key: `${p.itemId}-${thisIdx}-${seq++}`,
          placementId,
          pinData,
          radius,
          cylLen,
          rot,
          x: cx + (acrossIsX ? across : 0),
          z: cz + (acrossIsX ? 0 : across),
          y: lift + rowY,
          color: tone,
        })
      }
    }
  }
  return out
}
