'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Edges } from '@react-three/drei'
import { Maximize, Minimize } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { rotateOutline90, decomposePipePyramid, type PackingResult, type ManualPlacement, type PinnedPlacement } from '@/lib/packing'

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
  // Real (possibly non-rectangular) deck silhouette — see DeckConfig.outline
  // in calculator.ts. Undefined = plain rectangle floor, today's behavior.
  deckOutline?: { x: number; y: number }[]
  mode: 'auto' | 'manual'
  manualPlacements: ManualPlacement[]
  pinnedPlacements: PinnedPlacement[]
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

// 3D snapshot of the current layout — camera rotate/zoom only, no editing.
// Clicking a mesh still updates the shared selection store (so switching to
// 2D shows it already selected there, ready for the arrow-key/Space
// shortcuts or drag), and an auto-mode click on a not-yet-pinned item pins
// it in place first (mirroring the 2D view's click-to-pin), but nothing in
// 3D itself moves/rotates cargo or shows a selection highlight.
export default function Deck3DView({
  result,
  deckWidth,
  deckLength,
  deckOutline,
  mode,
  manualPlacements,
  pinnedPlacements,
  onSelectManual,
  onSelectPin,
  onPinInPlace,
}: Deck3DViewProps) {
  // Fullscreen toggle — expands this specific container (not the whole
  // page) via the browser's real Fullscreen API, so OrbitControls/canvas
  // interactions keep working unchanged and Escape/the browser's own exit
  // control both work for free. `isFullscreen` is driven off the
  // `fullscreenchange` event rather than just the click handler, so it
  // stays correct if the user exits via Escape instead of the button.
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      containerRef.current?.requestFullscreen()
    }
  }

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
            y: layer * tierPitch0,
            color: p.color,
          })
        }
        continue
      }

      if (p.height <= 0) {
        out.push({ key: `${p.itemId}-${thisIdx}`, placementId, pinData, w: p.width * SHRINK, d: p.length * SHRINK, h: 0.3, x: cx, y: 0.15, z: cz, color: p.color })
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
            y: layer * tierPitch + p.height / 2,
            color: p.color,
          })
        }
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
            y: layer * tierPitch + p.height / 2,
            color: p.color,
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
            y: rowY,
            color: p.color,
          })
        }
      }
    }
    return out
  }, [result.placed, deckWidth, deckLength, mode, manualPlacements, pinnedPlacements])

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
    <div
      ref={containerRef}
      className={
        'relative w-full rounded-lg border overflow-hidden bg-slate-100' +
        (isFullscreen ? ' h-screen w-screen' : '')
      }
      style={isFullscreen ? undefined : { height: 480 }}
    >
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="absolute bottom-2 right-2 z-10 h-7 w-7 rounded-lg border bg-card/95 shadow-sm backdrop-blur-sm"
        title={isFullscreen ? 'Свернуть из полноэкранного режима' : 'Развернуть на весь экран'}
        onClick={toggleFullscreen}
      >
        {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
      </Button>
      <Canvas
        camera={{ position: [maxDim * 0.7, maxDim * 0.65, maxDim * 0.9], fov: 45 }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[maxDim, maxDim * 1.5, maxDim]} intensity={1} />

        {/* Deck base — real (possibly non-rectangular) silhouette when an
            outline is set, matching the 2D clipped render; otherwise the
            plain rectangle floor as before. */}
        {deckOutline && deckOutline.length >= 3 ? (
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0, 0]}
          >
            <extrudeGeometry
              args={[
                new THREE.Shape(
                  deckOutline.map((p) => new THREE.Vector2(p.x - deckWidth / 2, -(p.y - deckLength / 2)))
                ),
                { depth: 0.02, bevelEnabled: false },
              ]}
            />
            <meshStandardMaterial color="#e2e8f0" />
            <Edges color="#1e293b" />
          </mesh>
        ) : (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
            <planeGeometry args={[deckWidth, deckLength]} />
            <meshStandardMaterial color="#e2e8f0" />
            <Edges color="#1e293b" />
          </mesh>
        )}

        {boxes.map((b) => {
          // No visual selection highlight in 3D — clicking still updates the
          // shared selection state (so 2D reflects it after switching back),
          // but nothing here tints or outlines the mesh; cargo always shows
          // its own true color. 3D stays camera-only for editing (move/
          // rotate happen in 2D, via drag or the arrow-key/Space shortcuts).
          if (b.customOutline) {
            // Extrude the real (possibly concave) silhouette. The shape is
            // built in local XY with Y negated, then rotated -90° about X —
            // that combination maps local extrusion depth to world Y (up)
            // while keeping local X/Y aligned with world X/Z exactly like
            // the 2D top-down view (no mirroring), see rotateOutline90 usage
            // above for why the outline itself needs no further correction.
            const shape = new THREE.Shape(b.customOutline.map((p) => new THREE.Vector2(p.x, -p.y)))
            return (
              <mesh
                key={b.key}
                position={[b.x, b.y, b.z]}
                rotation={[-Math.PI / 2, 0, 0]}
                onClick={handleClick(b.placementId, b.pinData)}
              >
                <extrudeGeometry args={[shape, { depth: b.depth ?? 0.3, bevelEnabled: false }]} />
                <meshStandardMaterial color={b.color} />
                <Edges color="#0f172a" />
              </mesh>
            )
          }
          if (b.radius === undefined) {
            return (
              <mesh key={b.key} position={[b.x, b.y, b.z]} onClick={handleClick(b.placementId, b.pinData)}>
                <boxGeometry args={[b.w!, b.h!, b.d!]} />
                <meshStandardMaterial color={b.color} />
                <Edges color="#0f172a" />
              </mesh>
            )
          }
          if (b.radialSegments !== undefined) {
            // Odd-shaped "Объекты" cargo (circle/oval/triangle/diamond) —
            // one solid color, no pipe-style end-cap split.
            return (
              <mesh
                key={b.key}
                position={[b.x, b.y, b.z]}
                rotation={b.rot}
                scale={[1, 1, b.scaleZ ?? 1]}
                onClick={handleClick(b.placementId, b.pinData)}
              >
                <cylinderGeometry args={[b.radius, b.radius, b.cylLen, b.radialSegments]} />
                <meshStandardMaterial color={b.color} />
                <Edges color="#0f172a" />
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
