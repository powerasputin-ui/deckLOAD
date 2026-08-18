'use client'

import { useMemo } from 'react'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Edges, Outlines } from '@react-three/drei'
import type { PackingResult, ManualPlacement, PinnedPlacement } from '@/lib/packing'

interface PinData {
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

interface Deck3DViewProps {
  result: PackingResult
  deckWidth: number
  deckLength: number
  mode: 'auto' | 'manual'
  manualPlacements: ManualPlacement[]
  pinnedPlacements: PinnedPlacement[]
  selectedManualIds: string[]
  selectedPinIds: string[]
  onSelectManual?: (id: string, additive: boolean) => void
  onSelectPin?: (id: string, additive: boolean) => void
  // Auto mode only: clicking a mesh that isn't pinned yet (just placed by the
  // algorithm) pins it at its current position — the same "click to pin in
  // place" action the 2D view already does via onPinPlaced — so any visible
  // cargo becomes selectable/movable in 3D, not just already-pinned pieces.
  onPinInPlace?: (p: PinData) => void
}

const SQRT3 = Math.sqrt(3)

// The two flat round end caps of every cylinder (pipe or barrel) always get
// this color, distinct from the cargo's own side-surface color — a fixed,
// permanent detail (not tied to selection) so a pipe reads as a hollow tube
// with visible ends rather than a plain solid rod. `CylinderGeometry`
// exposes 3 material groups by default: 0 = the lateral surface, 1 = top
// cap, 2 = bottom cap.
const PIPE_CAP_COLOR = '#cbd5e1'

// 3D snapshot of the current layout. Camera rotate/zoom always works; cargo
// itself is only clickable/selectable when it corresponds to a real
// placement id (every item in manual mode, only pinned items in auto mode —
// same restriction the 2D view already has, since auto-placed-by-algorithm
// items aren't individually addressable). Selection is shared with the 2D
// view via the same store fields, so picking a box here highlights it there
// too, and vice versa.
export default function Deck3DView({
  result,
  deckWidth,
  deckLength,
  mode,
  manualPlacements,
  pinnedPlacements,
  selectedManualIds,
  selectedPinIds,
  onSelectManual,
  onSelectPin,
  onPinInPlace,
}: Deck3DViewProps) {
  // Deck plane sits in XZ; height (Y) is item.height per tier. Each stacked
  // layer is rendered as its own mesh (with a thin gap between them) instead
  // of one tall solid block, so the layer count is visible at a glance —
  // not just implied by a number. Items without a set height still render
  // as a single thin slab, matching the 2D fallback so an empty "height"
  // field doesn't make cargo invisible.
  // Real gaps between neighbouring footprints can be tiny (the deck's own
  // "gap" setting is often just a few cm against a many-metre deck) — at
  // typical camera distance that seam all but disappears, so same-colour
  // neighbours read as one fused blob instead of separate units. Shrinking
  // each box slightly around its own centre (footprint AND height) leaves a
  // visible sliver of deck between every placement, at every zoom level,
  // regardless of how small the real gap is — same clarity the 2D view gets
  // for free from each rect's own stroke outline.
  const SHRINK = 0.94

  const boxes = useMemo(() => {
    const out: {
      key: string
      placementId?: string
      pinData?: PinData
      color: string
      shape?: 'box' | 'cylinder'
      x: number
      y: number
      z: number
      w?: number
      d?: number
      h?: number
      radius?: number
      cylLen?: number
      rot?: [number, number, number]
    }[] = []

    // Manual mode's result.placed is built (packingResultFromManual) with
    // `index` matching the source `manualPlacements` array 1:1, so the
    // placement id is a direct lookup. Auto mode's result.placed mixes
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

    // `PlacedItem.index` is NOT globally unique across result.placed in auto
    // mode — pinned and algorithm-placed items are numbered from separate
    // counters in packing.ts, so a pinned item and an auto-placed item of
    // the same cargo type can both land on `index: 0`. Keying meshes off
    // `p.index` then collided (React "duplicate key" warning, and one of
    // the two silently failed to render) — count array position locally
    // instead, which is always unique regardless of the source counters.
    let pIdx = 0
    for (const p of result.placed) {
      const thisIdx = pIdx++
      const placementId = placementIdFor(p)
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

      if (p.height <= 0) {
        out.push({ key: `${p.itemId}-${thisIdx}`, placementId, pinData, w: p.width * SHRINK, d: p.length * SHRINK, h: 0.3, x: cx, y: 0.15, z: cz, color: p.color, shape: p.shape })
        continue
      }

      // A small gap between tiers (proportional to tier height, capped so it
      // stays subtle even for very tall cargo) makes the seam readable
      // without visually inflating the stack's true height much.
      const gap = Math.min(0.05, p.height * 0.08)
      const tierPitch = p.height + gap

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
            y: layer * tierPitch + p.height / 2,
            color: p.color,
            shape: p.shape,
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
            y: layer * tierPitch + p.height / 2,
            color: p.color,
            shape: p.shape,
          })
        }
        continue
      }

      // Pyramid pile for stacked pipes: decompose `layers` round units into
      // decreasing rows — base row widest, each row above one unit narrower
      // — nested in the "valley" of the row below, the way round stock
      // (pipes/rebar) actually piles up. Boxes/barrels above stack straight
      // instead, which is physically correct for square/upright cargo but
      // was, until now, also being applied to pipes, which is not.
      const acrossIsX = !(p.width >= p.length) // the pipe's own axis runs along whichever world axis is "long"; rows spread out along the OTHER one
      const base = Math.max(1, Math.round(Math.sqrt(2 * layers)))
      let remaining = layers
      let rowIndex = 0
      let seq = 0
      while (remaining > 0) {
        const rowCount = Math.min(remaining, Math.max(1, base - rowIndex))
        const rowY = radius + rowIndex * radius * SQRT3
        for (let i = 0; i < rowCount; i++) {
          const across = (i - (rowCount - 1) / 2) * radius * 2
          out.push({
            key: `${p.itemId}-${thisIdx}-${seq++}`,
            placementId,
            pinData,
            radius,
            cylLen,
            rot,
            x: cx + (acrossIsX ? across : 0),
            z: cz + (acrossIsX ? 0 : across),
            y: rowY,
            color: p.color,
            shape: p.shape,
          })
        }
        remaining -= rowCount
        rowIndex++
      }
    }
    return out
  }, [result.placed, deckWidth, deckLength, mode, manualPlacements, pinnedPlacements])

  const selectedSet = useMemo(
    () => new Set(mode === 'manual' ? selectedManualIds : selectedPinIds),
    [mode, selectedManualIds, selectedPinIds]
  )

  const handleClick = (placementId: string | undefined, pinData: PinData | undefined) => (e: ThreeEvent<MouseEvent>) => {
    if (!placementId) {
      // Auto mode, not pinned yet — pin it where it already sits (mirrors
      // the 2D view's click-to-pin behaviour) so it becomes selectable and
      // movable instead of staying a dead click.
      if (pinData) {
        e.stopPropagation()
        onPinInPlace?.(pinData)
      }
      return
    }
    e.stopPropagation()
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    if (mode === 'manual') onSelectManual?.(placementId, additive)
    else onSelectPin?.(placementId, additive)
  }

  const maxDim = Math.max(deckWidth, deckLength, 1)

  // minDistance used to be based purely on the deck's own size (maxDim),
  // so on a full-size deck the camera could never get closer than several
  // metres — nowhere near close enough to tell a 0.5-1m barrel/pipe's
  // rounded shape apart from a box at a glance, no matter how far a user
  // scrolled in. Let the camera approach small cargo much more closely
  // when it's present, without changing the existing zoom range for decks
  // that only have large cargo (containers/pallets) on them.
  const minCargoDim = result.placed.length
    ? Math.min(...result.placed.flatMap((p) => [p.width, p.length, p.height || 0.3]))
    : maxDim
  const minDistance = Math.min(maxDim * 0.3, Math.max(0.5, minCargoDim * 1.2))

  return (
    <div className="w-full rounded-lg border overflow-hidden bg-slate-100" style={{ height: 480 }}>
      <Canvas
        camera={{ position: [maxDim * 0.7, maxDim * 0.65, maxDim * 0.9], fov: 45 }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[maxDim, maxDim * 1.5, maxDim]} intensity={1} />

        {/* Deck base plane */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[deckWidth, deckLength]} />
          <meshStandardMaterial color="#e2e8f0" />
          <Edges color="#1e293b" />
        </mesh>

        {boxes.map((b) => {
          // Selection is shown as an outline around the mesh's own silhouette
          // (not by tinting its material) — a dark preset color stays exactly
          // that color whether selected or not; only a thin yellow ring gets
          // added on top. For a cylinder viewed end-on, that ring reads as a
          // highlighted circle around the pipe's round cross-section.
          const isSelected = !!b.placementId && selectedSet.has(b.placementId)
          if (b.radius === undefined) {
            return (
              <mesh key={b.key} position={[b.x, b.y, b.z]} onClick={handleClick(b.placementId, b.pinData)}>
                <boxGeometry args={[b.w!, b.h!, b.d!]} />
                <meshStandardMaterial color={b.color} />
                <Edges color="#0f172a" />
                {isSelected && <Outlines thickness={3} color="#facc15" />}
              </mesh>
            )
          }
          return (
            <mesh key={b.key} position={[b.x, b.y, b.z]} rotation={b.rot} onClick={handleClick(b.placementId, b.pinData)}>
              <cylinderGeometry args={[b.radius, b.radius, b.cylLen, 24]} />
              <meshStandardMaterial attach="material-0" color={b.color} />
              <meshStandardMaterial attach="material-1" color={PIPE_CAP_COLOR} />
              <meshStandardMaterial attach="material-2" color={PIPE_CAP_COLOR} />
              <Edges color="#0f172a" />
              {isSelected && <Outlines thickness={3} color="#facc15" />}
            </mesh>
          )
        })}

        <OrbitControls
          makeDefault
          maxPolarAngle={Math.PI / 2 - 0.02}
          minDistance={minDistance}
          maxDistance={maxDim * 4}
        />
      </Canvas>
    </div>
  )
}
