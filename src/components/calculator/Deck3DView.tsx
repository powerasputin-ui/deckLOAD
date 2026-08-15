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
  // Deck plane sits in XZ; height (Y) is item.height * stacked layers. Items
  // without a set height still render as a thin slab, matching the 2D
  // fallback so an empty "height" field doesn't make cargo invisible.
  const boxes = useMemo(
    () =>
      result.placed.map((p, i) => {
        const h = p.height > 0 ? p.height * Math.max(1, p.stackedCount) : 0.3
        return {
          key: `${p.itemId}-${i}`,
          w: p.width,
          d: p.length,
          h,
          // Center of the footprint, deck-space (0,0) at one corner -> centre
          // the whole scene on the deck's own centre so OrbitControls orbits
          // around the middle of the layout, not a far corner.
          x: p.x + p.width / 2 - deckWidth / 2,
          z: p.y + p.length / 2 - deckLength / 2,
          y: h / 2,
          color: p.color,
        }
      }),
    [result.placed, deckWidth, deckLength]
  )

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

        {boxes.map((b) => (
          <mesh key={b.key} position={[b.x, b.y, b.z]}>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial color={b.color} />
            <Edges color="#0f172a" />
          </mesh>
        ))}

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
