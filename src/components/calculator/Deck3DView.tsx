'use client'

import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Edges } from '@react-three/drei'
import type { PackingResult } from '@/lib/packing'

interface Deck3DViewProps {
  result: PackingResult
  deckWidth: number
  deckLength: number
}

// Read-only 3D snapshot of the current layout — camera rotate/zoom only, no
// drag/pin/zone editing (that stays in the 2D DeckVisualization). Reuses the
// same PackingResult the 2D view gets; no new placement math.
export default function Deck3DView({ result, deckWidth, deckLength }: Deck3DViewProps) {
  // Deck plane sits in XZ; height (Y) is item.height per tier. Each stacked
  // layer is rendered as its own box (with a thin gap between them) instead
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
    const out: { key: string; w: number; d: number; h: number; x: number; y: number; z: number; color: string; shape?: 'box' | 'cylinder' }[] = []
    for (const p of result.placed) {
      const x = p.x + p.width / 2 - deckWidth / 2
      const z = p.y + p.length / 2 - deckLength / 2
      const layers = Math.max(1, p.stackedCount)
      if (p.height <= 0) {
        out.push({ key: `${p.itemId}-${p.index}`, w: p.width * SHRINK, d: p.length * SHRINK, h: 0.3, x, y: 0.15, z, color: p.color, shape: p.shape })
        continue
      }
      // A small gap between tiers (proportional to tier height, capped so it
      // stays subtle even for very tall cargo) makes the seam readable
      // without visually inflating the stack's true height much.
      const gap = Math.min(0.05, p.height * 0.08)
      const tierPitch = p.height + gap
      for (let layer = 0; layer < layers; layer++) {
        out.push({
          key: `${p.itemId}-${p.index}-${layer}`,
          w: p.width * SHRINK,
          d: p.length * SHRINK,
          h: p.height,
          x,
          z,
          y: layer * tierPitch + p.height / 2,
          color: p.color,
          shape: p.shape,
        })
      }
    }
    return out
  }, [result.placed, deckWidth, deckLength])

  const maxDim = Math.max(deckWidth, deckLength, 1)

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
          if (b.shape !== 'cylinder') {
            return (
              <mesh key={b.key} position={[b.x, b.y, b.z]}>
                <boxGeometry args={[b.w, b.h, b.d]} />
                <meshStandardMaterial color={b.color} />
                <Edges color="#0f172a" />
              </mesh>
            )
          }
          // A cylinder's own geometry axis runs along Y. A barrel-shaped
          // footprint (roughly square, tall) keeps that default orientation
          // standing up. A pipe-shaped footprint (one dimension much longer
          // than the other, both much larger than its height) instead lies
          // on its side — rotated so the cylinder's axis runs along whichever
          // of width/depth is the long one, with the radius taken from the
          // short footprint dimension (its round cross-section).
          const longSpan = Math.max(b.w, b.d)
          const shortSpan = Math.min(b.w, b.d)
          const isPipe = longSpan > shortSpan * 1.5 && longSpan > b.h * 1.5
          const radius = isPipe ? Math.min(shortSpan, b.h) / 2 : shortSpan / 2
          const cylinderLength = isPipe ? longSpan : b.h
          const rotation: [number, number, number] = isPipe
            ? (b.w >= b.d ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0])
            : [0, 0, 0]
          return (
            <mesh key={b.key} position={[b.x, b.y, b.z]} rotation={rotation}>
              <cylinderGeometry args={[radius, radius, cylinderLength, 24]} />
              <meshStandardMaterial color={b.color} />
              <Edges color="#0f172a" />
            </mesh>
          )
        })}

        <OrbitControls
          makeDefault
          maxPolarAngle={Math.PI / 2 - 0.02}
          minDistance={maxDim * 0.3}
          maxDistance={maxDim * 4}
        />
      </Canvas>
    </div>
  )
}
