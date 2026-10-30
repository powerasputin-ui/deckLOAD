'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { Expand, Maximize, Shrink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/ThemeProvider'
import { fitCamera } from '@/lib/cameraFit'
import { cargoToneForNumber } from '@/lib/cargoPalette'
import { HULL_SIDE_LABEL, deckDrawnTransposed, hullSideEdges, type DrawingEdge, type HullSide } from '@/lib/deckDrawing'
import { DRAG_THRESHOLD_PX, isStackSelected, type StackSelection } from '@/lib/stackSelection'
import { THEME_TOKENS } from '@/lib/theme'
import { BOW_ARROW } from './DeckDrawingFrame'
import { autoPlacementKey } from '@/store/calculator'
import { rotateOutline90, decomposePipePyramid, type PackingResult, type ManualPlacement, type PinnedPlacement } from '@/lib/packing'
import { pipeNestTierOffsets } from '@/lib/pipeNest'

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
  // Which end of the deck's length is the bow, for the side names.
  deckForwardIsPositiveY?: boolean
  // Pixels at the right of the view covered by the inspector (spec 5.4).
  coveredRight?: number
  mode: 'auto' | 'manual'
  manualPlacements: ManualPlacement[]
  pinnedPlacements: PinnedPlacement[]
  onSelectManual?: (id: string, additive: boolean) => void
  onSelectPin?: (id: string, additive: boolean) => void
  // Auto mode only: clicking a mesh the algorithm placed (no pin yet)
  // selects it, same as in 2D. It used to pin it on the spot — including at
  // the end of a camera orbit that started on it, since a 3D click has no
  // movement threshold — after which auto mode stopped placing that cargo.
  onSelectAuto?: (p: PinData, additive: boolean) => void
  // Cargo id → number in the list; the tone follows from it, same as in 2D
  // and the PDF (spec 9.2).
  cargoNumberByItemId?: Map<string, number>
  // The stacks selected (shared with 2D), outlined in the accent here too.
  selection?: StackSelection
  // Where the canvas tools go, next to 2D's (spec 6.10): «Вписать» and full
  // screen. Without it they sit in the canvas's corner.
  toolbarContainer?: HTMLElement | null
}

const SQRT3 = Math.sqrt(3)

// The two flat round end caps of every cylinder (pipe or barrel) always get
// this color, distinct from the cargo's own side-surface color — a fixed,
// permanent detail (not tied to selection) so a pipe reads as a hollow tube
// with visible ends rather than a plain solid rod. `CylinderGeometry`
// exposes 3 material groups by default: 0 = the lateral surface, 1 = top
// cap, 2 = bottom cap.
const PIPE_CAP_COLOR = '#cbd5e1'

// Every surface sits a hair behind its own edges, so the outlines — the
// deck's and each stack's, as in 2D — aren't hidden under the faces they
// lie on.
const SURFACE = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const

// The outline of the mesh it is placed in: the mesh's edges as plain lines.
// drei's <Edges> draws them as screen-space quads, which some WebGL
// implementations (the software one included) never show. Only edges
// sharper than 20°: a pipe's 24 sides meet at 15°, and its outline is its
// two ends, not a stripe down every side.
function Outline({ color }: { color: string }) {
  const ref = useRef<THREE.LineSegments>(null)
  useLayoutEffect(() => {
    const line = ref.current
    const mesh = line?.parent
    if (!line || !(mesh instanceof THREE.Mesh) || line.userData.of === mesh.geometry) return
    line.userData.of = mesh.geometry
    line.geometry.dispose()
    line.geometry = new THREE.EdgesGeometry(mesh.geometry, 20)
  })
  useEffect(() => {
    const line = ref.current
    return () => line?.geometry.dispose()
  }, [])
  return (
    <lineSegments ref={ref} raycast={() => null}>
      <lineBasicMaterial color={color} />
    </lineSegments>
  )
}

// 3D snapshot of the current layout — camera rotate/zoom only, no editing.
// Clicking a mesh updates the shared selection (the inspector opens, and 2D
// shows it selected too); the selected stacks are outlined in the accent
// (spec 6.3). Like in 2D, a click only selects — it never pins a
// not-yet-pinned item. Nothing in 3D itself moves or rotates cargo.
export default function Deck3DView({
  result,
  deckWidth,
  deckLength,
  deckOutline,
  deckForwardIsPositiveY = true,
  coveredRight = 0,
  mode,
  manualPlacements,
  pinnedPlacements,
  onSelectManual,
  onSelectPin,
  onSelectAuto,
  cargoNumberByItemId,
  selection,
  toolbarContainer,
}: Deck3DViewProps) {
  const { resolved: theme } = useTheme()
  const palette = THEME_TOKENS[theme]
  const accent = palette.accent
  const isSelected = (b: { placementId?: string; pinData?: PinData }) =>
    !!selection &&
    isStackSelected({ placementId: b.placementId, autoKey: b.pinData ? autoPlacementKey(b.pinData) : undefined }, mode, selection)
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
            color: tone,
          })
        }
        continue
      }

      if (p.height <= 0) {
        out.push({ key: `${p.itemId}-${thisIdx}`, placementId, pinData, w: p.width * SHRINK, d: p.length * SHRINK, h: 0.3, x: cx, y: 0.15, z: cz, color: tone })
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
              y: tierY,
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
            y: layer * tierPitch + p.height / 2,
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
            y: layer * tierPitch + p.height / 2,
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
            y: rowY,
            color: tone,
          })
        }
      }
    }
    return out
  }, [result.placed, deckWidth, deckLength, mode, manualPlacements, pinnedPlacements, cargoNumberByItemId])

  const handleClick = (placementId: string | undefined, pinData: PinData | undefined) => (e: ThreeEvent<MouseEvent>) => {
    // The end of a camera turn that started on a stack, not a choice of it.
    if (e.delta > DRAG_THRESHOLD_PX) return
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    if (!placementId) {
      // Auto mode, not pinned yet — select it without pinning (see onSelectAuto).
      if (pinData) {
        e.stopPropagation()
        onSelectAuto?.(pinData, additive)
      }
      return
    }
    e.stopPropagation()
    if (mode === 'manual') onSelectManual?.(placementId, additive)
    else onSelectPin?.(placementId, additive)
  }

  const maxDim = Math.max(deckWidth, deckLength, 1)

  // Laid out as the 2D plan is (spec 6.1): the deck's long side across the
  // screen. 2D draws a deck longer than it is wide transposed — deck y along
  // the screen's x — which is a reflection, so the scene takes the same one
  // and 3D shows each side where 2D shows it. The camera then looks from the
  // plan's bottom edge (+z), the way one looks at the drawing.
  const transposed = deckDrawnTransposed(deckWidth, deckLength)
  const planMatrix = useMemo(
    () => (transposed ? new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1) : new THREE.Matrix4()),
    [transposed]
  )
  const planRef = useRef<THREE.Group>(null)
  const drawnWidth = transposed ? deckLength : deckWidth
  const drawnDepth = transposed ? deckWidth : deckLength
  // «Вписать» brings the camera back to the whole deck.
  const [fitRequest, setFitRequest] = useState(0)

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

  const tools = (
    <>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Вписать" title="Вписать" onClick={() => setFitRequest((n) => n + 1)}>
        <Maximize className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label={isFullscreen ? 'Свернуть из полноэкранного режима' : 'Развернуть на весь экран'}
        title={isFullscreen ? 'Свернуть из полноэкранного режима' : 'Развернуть на весь экран'}
        onClick={toggleFullscreen}
      >
        {isFullscreen ? <Shrink className="h-4 w-4" aria-hidden="true" /> : <Expand className="h-4 w-4" aria-hidden="true" />}
      </Button>
    </>
  )

  return (
    // The whole deck area, like the 2D plan — the page's own background
    // around the deck, in either theme.
    <div ref={containerRef} className={'relative h-full w-full overflow-hidden bg-paper' + (isFullscreen ? ' h-screen w-screen' : '')}>
      {toolbarContainer && !isFullscreen
        ? createPortal(<div className="flex items-center gap-0.5 rounded-md border bg-surface p-0.5">{tools}</div>, toolbarContainer)
        : <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md border bg-surface p-0.5 shadow-sm">{tools}</div>}
      {/* A narrow field of view, so the near edge of the deck isn't much
          wider than the far one and the plan reads as in 2D. No tone
          mapping, and the light set so that a top face shows its cargo's
          own tone, as in 2D and the legend; the faces towards the camera a
          little darker. */}
      <Canvas flat camera={{ position: [0, maxDim * 0.8, maxDim * 0.6], fov: 30 }} dpr={[1, 2]}>
        <FitView
          plan={planRef}
          content={boxes}
          outline={deckOutline}
          deckWidth={deckWidth}
          deckLength={deckLength}
          coveredRight={coveredRight}
          request={fitRequest}
        />
        <ambientLight intensity={1.7} />
        <directionalLight position={[0.3, 1, 0.45]} intensity={1.64} />

        <group ref={planRef} matrix={planMatrix} matrixAutoUpdate={false}>
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
            <meshStandardMaterial color={palette.deck} {...SURFACE} />
            <Outline color={palette.deckOutline} />
          </mesh>
        ) : (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
            <planeGeometry args={[deckWidth, deckLength]} />
            <meshStandardMaterial color={palette.deck} {...SURFACE} />
            <Outline color={palette.deckOutline} />
          </mesh>
        )}

        {boxes.map((b) => {
          // A selected stack: accent edges and a light accent glow over its
          // own tone. 3D stays camera-only for editing (move/rotate happen in
          // 2D, via drag or the keys).
          const selected = isSelected(b)
          const edgeColor = selected ? accent : '#0f172a'
          const glow = selected ? { emissive: accent, emissiveIntensity: 0.35 } : {}
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
                <meshStandardMaterial color={b.color} {...glow} {...SURFACE} />
                <Outline color={edgeColor} />
              </mesh>
            )
          }
          if (b.radius === undefined) {
            return (
              <mesh key={b.key} position={[b.x, b.y, b.z]} onClick={handleClick(b.placementId, b.pinData)}>
                <boxGeometry args={[b.w!, b.h!, b.d!]} />
                <meshStandardMaterial color={b.color} {...glow} {...SURFACE} />
                <Outline color={edgeColor} />
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
                <meshStandardMaterial color={b.color} {...glow} {...SURFACE} />
                <Outline color={edgeColor} />
              </mesh>
            )
          }
          return (
            <mesh key={b.key} position={[b.x, b.y, b.z]} rotation={b.rot} onClick={handleClick(b.placementId, b.pinData)}>
              <cylinderGeometry args={[b.radius, b.radius, b.cylLen, 24]} />
              <meshStandardMaterial attach="material-0" color={b.color} {...glow} {...SURFACE} />
              <meshStandardMaterial attach="material-1" color={PIPE_CAP_COLOR} {...SURFACE} />
              <meshStandardMaterial attach="material-2" color={PIPE_CAP_COLOR} {...SURFACE} />
              <Outline color={edgeColor} />
            </mesh>
          )
        })}

        </group>

        <DeckSides
          sides={hullSideEdges(deckWidth, deckLength, deckForwardIsPositiveY)}
          width={drawnWidth}
          depth={drawnDepth}
          container={containerRef}
        />

        <OrbitControls
          makeDefault
          maxPolarAngle={Math.PI / 2 - 0.02}
          minDistance={minDistance}
          // Room beyond the fit, which on a narrow canvas stands far back.
          maxDistance={maxDim * 8}
        />
      </Canvas>
    </div>
  )
}

// Which side of the hull each edge of the deck is, named as 2D's drawing
// frame names them (spec 6.1): beside the middle of each edge, the names on
// the left and right edges turned to read upwards. They stay level however
// the camera turns, on a backing of the page's colour where a stack rises
// behind them. They go into the view's own container: left to find one
// itself, drei moves them once the canvas takes events, and loses one.
const SIDE_SHIFT: Record<DrawingEdge, string> = {
  top: 'translate(-50%, -50%) translate(0, -14px)',
  bottom: 'translate(-50%, -50%) translate(0, 14px)',
  left: 'translate(-50%, -50%) translate(-14px, 0) rotate(-90deg)',
  right: 'translate(-50%, -50%) translate(14px, 0) rotate(-90deg)',
}

function DeckSides({
  sides,
  width,
  depth,
  container,
}: {
  sides: Record<HullSide, DrawingEdge>
  width: number
  depth: number
  container: React.RefObject<HTMLDivElement | null>
}) {
  const at = (edge: DrawingEdge): [number, number, number] =>
    edge === 'top' ? [0, 0, -depth / 2] : edge === 'bottom' ? [0, 0, depth / 2] : edge === 'left' ? [-width / 2, 0, 0] : [width / 2, 0, 0]
  return (Object.keys(sides) as HullSide[]).map((side) => {
    const edge = sides[side]
    return (
      <Html
        key={side}
        position={at(edge)}
        portal={container as React.RefObject<HTMLElement>}
        zIndexRange={[10, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div
          data-hull-side={side}
          data-edge={edge}
          className="select-none whitespace-nowrap rounded-sm bg-paper/85 px-1 text-xs font-semibold tracking-[0.08em] text-ink"
          style={{ transform: SIDE_SHIFT[edge] }}
        >
          {side === 'bow' ? `${BOW_ARROW[edge]} ${HULL_SIDE_LABEL[side]}` : HULL_SIDE_LABEL[side]}
        </div>
      </Html>
    )
  })
}

// The camera on the whole deck, as 2D's «Вписать» puts it (spec 6.10): from
// the plan's bottom edge, raised to look down at it, and back just far
// enough for the deck and every stack on it to fill the canvas with a
// margin (cameraFit.ts). On first sight, and again when the cargo, the
// canvas or the inspector over it changes while the camera is where this
// put it; once the user has turned or zoomed it, only a new deck or
// «Вписать» moves it. While the inspector is open the picture's centre is
// the middle of what it leaves open, and the fit is to that part.
const ELEVATION = (60 * Math.PI) / 180
// Leaves the side names room outside the deck.
const FILL = 0.9

function FitView({
  plan,
  content,
  outline,
  deckWidth,
  deckLength,
  coveredRight,
  request,
}: {
  plan: React.RefObject<THREE.Group | null>
  // What is drawn: a new value means a new picture to fit.
  content: unknown
  outline: unknown
  deckWidth: number
  deckLength: number
  coveredRight: number
  request: number
}) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3
    update: () => void
    addEventListener: (type: 'change', listener: () => void) => void
    removeEventListener: (type: 'change', listener: () => void) => void
  } | null
  // Turned: the camera has moved other than by this. A click that only
  // picks a stack leaves it as it was.
  const turned = useRef(false)
  const fitting = useRef(false)
  useEffect(() => {
    if (!controls) return
    const onChange = () => {
      if (!fitting.current) turned.current = true
    }
    controls.addEventListener('change', onChange)
    return () => controls.removeEventListener('change', onChange)
  }, [controls])
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    if (coveredRight > 0) camera.setViewOffset(size.width, size.height, coveredRight / 2, 0, size.width, size.height)
    else camera.clearViewOffset()
  }, [camera, size.width, size.height, coveredRight])
  // Before the first frame, so the camera never shows anything else first;
  // the reset ahead of the fit it allows.
  useLayoutEffect(() => {
    turned.current = false
  }, [deckWidth, deckLength, request])
  useLayoutEffect(() => {
    const group = plan.current
    if (turned.current || !group || size.width <= 0 || size.height <= 0 || !(camera instanceof THREE.PerspectiveCamera)) return
    // The corners of every mesh's box, where the plan's transform puts it —
    // forced, as before the first frame nothing has applied it yet.
    group.updateMatrixWorld(true)
    const box = new THREE.Box3()
    const points = group.children.flatMap((child) => {
      box.setFromObject(child)
      return [box.min.x, box.max.x].flatMap((x) => [box.min.y, box.max.y].flatMap((y) => [box.min.z, box.max.z].map((z) => ({ x, y, z }))))
    })
    const open = Math.max(1, size.width - coveredRight)
    const fit = fitCamera(points, { fov: camera.fov, aspect: open / size.height, elevation: ELEVATION, fill: FILL })
    camera.position.set(...fit.position)
    camera.lookAt(...fit.target)
    if (controls) {
      fitting.current = true
      controls.target.set(...fit.target)
      controls.update()
      fitting.current = false
    }
  }, [camera, controls, plan, content, outline, size.width, size.height, coveredRight, deckWidth, deckLength, request])
  return null
}
