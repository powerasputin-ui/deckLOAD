'use client'

import { useMemo, useRef, useState, useCallback } from 'react'
import {
  computeFreeRects,
  clampToDeck,
  collidesWith,
  type PackingResult,
  type PlacedItem,
  type ManualPlacement,
} from '@/lib/packing'
import { UNIT_LABEL } from '@/store/calculator'
import { v4 as uuid } from 'uuid'

interface DeckVisualizationProps {
  result: PackingResult
  unit: 'm' | 'cm' | 'ft'
  gap: number
  boardOffset: number
  showFreeSpace: boolean
  showGrid: boolean
  showLabels: boolean
  hoveredItemId: string | null
  onHover: (id: string | null) => void
  mode: 'auto' | 'manual'
  activeStamp: { id: string; width: number; length: number; color: string; name: string; weight?: number } | null
  stampRotated: boolean
  onPlace?: (p: ManualPlacement) => void
  onMoveManual?: (id: string, x: number, y: number) => void
  onRemoveManual?: (id: string) => void
  manualPlacements: ManualPlacement[]
}

const EDGE_PAD_PX = 6 // visual inset so items never touch the deck border

export function DeckVisualization({
  result,
  unit,
  gap,
  boardOffset,
  showFreeSpace,
  showGrid,
  showLabels,
  hoveredItemId,
  onHover,
  mode,
  activeStamp,
  stampRotated,
  onPlace,
  onMoveManual,
  onRemoveManual,
  manualPlacements,
}: DeckVisualizationProps) {
  const { deckWidth, deckLength } = result
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)
  const [dragState, setDragState] = useState<{
    id: string
    startMouse: { x: number; y: number }
    startPlace: { x: number; y: number }
  } | null>(null)
  const [selectedManual, setSelectedManual] = useState<string | null>(null)

  const edgePad = boardOffset

  const freeRects = useMemo(
    () => computeFreeRects(deckWidth, deckLength, result.placed, gap, boardOffset),
    [deckWidth, deckLength, result.placed, gap, boardOffset]
  )

  // Layout geometry
  const maxW = 900
  const maxH = 560
  const pad = 32
  const scale = Math.min(
    (maxW - pad * 2) / Math.max(deckWidth, 1),
    (maxH - pad * 2) / Math.max(deckLength, 1)
  )
  const w = deckWidth * scale
  const h = deckLength * scale
  const offX = (maxW - w) / 2
  const offY = (maxH - h) / 2

  const gridStep = (() => {
    const dim = Math.max(deckWidth, deckLength)
    if (dim <= 6) return 0.5
    if (dim <= 20) return 1
    if (dim <= 60) return 5
    return 10
  })()

  // Convert screen px (inside deck) -> deck coords
  const screenToDeck = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return null
      const pt = svg.createSVGPoint()
      pt.x = clientX
      pt.y = clientY
      const ctm = svg.getScreenCTM()
      if (!ctm) return null
      const p = pt.matrixTransform(ctm.inverse())
      const dx = (p.x - offX) / scale
      const dy = (p.y - offY) / scale
      return { x: dx, y: dy }
    },
    [offX, offY, scale]
  )

  const toX = (v: number) => offX + v * scale
  const toY = (v: number) => offY + v * scale
  const fmt = (v: number) => {
    const r = Math.round(v * 100) / 100
    return Number.isInteger(r) ? `${r}` : r.toFixed(2)
  }

  const stampDims = activeStamp
    ? stampRotated
      ? { w: activeStamp.length, l: activeStamp.width }
      : { w: activeStamp.width, l: activeStamp.length }
    : null

  const handleDeckClick = (e: React.MouseEvent) => {
    if (mode !== 'manual' || !activeStamp || !stampDims || !onPlace) return
    const pos = screenToDeck(e.clientX, e.clientY)
    if (!pos) return
    // Snap so the item's top-left is at the cursor, then clamp inside deck
    const clamped = clampToDeck(
      { x: pos.x, y: pos.y, width: stampDims.w, length: stampDims.l },
      deckWidth,
      deckLength,
      edgePad
    )
    // Check collision with existing manual placements
    const others = manualPlacements
      .filter((m) => m.id !== 'preview')
      .map((m) => ({ x: m.x, y: m.y, width: m.width, length: m.length }))
    if (collidesWith({ ...clamped, width: stampDims.w, length: stampDims.l }, others, gap)) {
      return // ignore overlapping placement
    }
    onPlace({
      id: uuid(),
      itemId: activeStamp.id,
      name: activeStamp.name,
      x: clamped.x,
      y: clamped.y,
      width: stampDims.w,
      length: stampDims.l,
      rotated: stampRotated,
      color: activeStamp.color,
      weight: activeStamp.weight,
    })
  }

  const handleManualPointerDown = (
    e: React.PointerEvent,
    mp: ManualPlacement
  ) => {
    if (mode !== 'manual') return
    e.stopPropagation()
    setSelectedManual(mp.id)
    setDragState({
      id: mp.id,
      startMouse: { x: e.clientX, y: e.clientY },
      startPlace: { x: mp.x, y: mp.y },
    })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (mode === 'manual' && activeStamp && !dragState) {
      const pos = screenToDeck(e.clientX, e.clientY)
      if (pos) setHoverPos(pos)
    }
    if (dragState && onMoveManual) {
      const pos = screenToDeck(e.clientX, e.clientY)
      if (!pos) return
      const dx = pos.x - (dragState.startMouse.x ? 0 : 0)
      void dx
      // Use delta in deck coords
      const startDeck = screenToDeck(dragState.startMouse.x, dragState.startMouse.y)
      if (!startDeck) return
      const deltaX = pos.x - startDeck.x
      const deltaY = pos.y - startDeck.y
      const nx = dragState.startPlace.x + deltaX
      const ny = dragState.startPlace.y + deltaY
      const mp = manualPlacements.find((m) => m.id === dragState.id)
      if (mp) {
        const clamped = clampToDeck(
          { x: nx, y: ny, width: mp.width, length: mp.length },
          deckWidth,
          deckLength,
          edgePad
        )
        onMoveManual(dragState.id, clamped.x, clamped.y)
      }
    }
  }

  const handlePointerUp = () => {
    setDragState(null)
  }

  const handleManualLeave = () => {
    setHoverPos(null)
  }

  const hasContent = result.placed.length > 0 || deckWidth > 0

  // Manual mode: rendered items come from manualPlacements; auto: from result.placed
  const renderedItems: (PlacedItem & { manualId?: string })[] =
    mode === 'manual'
      ? manualPlacements.map((m, i) => ({
          itemId: m.itemId,
          name: m.name,
          x: m.x,
          y: m.y,
          width: m.width,
          length: m.length,
          rotated: m.rotated,
          color: m.color,
          weight: m.weight,
          index: i,
          manualId: m.id,
        }))
      : result.placed

  return (
    <div className="w-full overflow-x-auto" onMouseLeave={handleManualLeave}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${maxW} ${maxH}`}
        className="w-full h-auto"
        style={{ maxHeight: 560, cursor: mode === 'manual' && activeStamp ? 'crosshair' : 'default' }}
        onClick={mode === 'manual' ? handleDeckClick : undefined}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <defs>
          <pattern
            id="deck-grid"
            width={gridStep * scale}
            height={gridStep * scale}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${gridStep * scale} 0 L 0 0 0 ${gridStep * scale}`}
              fill="none"
              stroke="#cbd5e1"
              strokeWidth={0.5}
            />
          </pattern>
          <pattern id="free-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(16,185,129,0.28)" strokeWidth="3" />
          </pattern>
        </defs>

        {/* Deck background */}
        <rect
          x={offX}
          y={offY}
          width={w}
          height={h}
          rx={6}
          fill="#ffffff"
          stroke="#1e293b"
          strokeWidth={2}
        />
        {showGrid && hasContent && (
          <rect x={offX} y={offY} width={w} height={h} rx={6} fill="url(#deck-grid)" />
        )}

        {/* Edge padding border (usable region) */}
        {edgePad > 0 && (
          <rect
            x={toX(edgePad)}
            y={toY(edgePad)}
            width={(deckWidth - edgePad * 2) * scale}
            height={(deckLength - edgePad * 2) * scale}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={0.75}
            strokeDasharray="3 3"
            opacity={0.6}
          />
        )}

        {/* Free space */}
        {showFreeSpace &&
          freeRects.map((fr, i) => {
            const fw = fr.width * scale
            const fh = fr.height * scale
            if (fw < 2 || fh < 2) return null
            return (
              <g key={`free-${i}`}>
                <rect
                  x={toX(fr.x)}
                  y={toY(fr.y)}
                  width={fw}
                  height={fh}
                  fill="url(#free-hatch)"
                  stroke="rgba(16,185,129,0.45)"
                  strokeWidth={0.75}
                  strokeDasharray="4 3"
                />
                {fw > 40 && fh > 24 && (
                  <text
                    x={toX(fr.x) + fw / 2}
                    y={toY(fr.y) + fh / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="select-none"
                    fontSize={11}
                    fill="rgba(5,150,105,0.9)"
                  >
                    {fmt(fr.width)}×{fmt(fr.height)}
                  </text>
                )}
              </g>
            )
          })}

        {/* Placed items */}
        {renderedItems.map((p, idx) => {
          const pw = p.width * scale
          const ph = p.length * scale
          const isHover = hoveredItemId === p.itemId
          const isSelected = mode === 'manual' && selectedManual === p.manualId
          return (
            <PlacedRect
              key={mode === 'manual' ? `m-${p.manualId}` : `p-${idx}`}
              item={p}
              x={toX(p.x)}
              y={toY(p.y)}
              w={pw}
              h={ph}
              hovered={isHover || isSelected}
              showLabels={showLabels}
              fmt={fmt}
              onHover={onHover}
              manualMode={mode === 'manual'}
              onPointerDown={mode === 'manual' && p.manualId ? (e) => handleManualPointerDown(e, manualPlacements.find((m) => m.id === p.manualId)!) : undefined}
            />
          )
        })}

        {/* Manual mode: delete button on selected */}
        {mode === 'manual' &&
          selectedManual &&
          onRemoveManual &&
          (() => {
            const mp = manualPlacements.find((m) => m.id === selectedManual)
            if (!mp) return null
            const cx = toX(mp.x + mp.width)
            const cy = toY(mp.y)
            return (
              <g
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation()
                  onRemoveManual(mp.id)
                  setSelectedManual(null)
                }}
              >
                <circle cx={cx} cy={cy} r={9} fill="#ef4444" stroke="#fff" strokeWidth={1.5} />
                <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#fff">✕</text>
              </g>
            )
          })()}

        {/* Manual mode: preview stamp at cursor */}
        {mode === 'manual' && activeStamp && stampDims && hoverPos && !dragState && (
          <rect
            x={toX(clampToDeck({ x: hoverPos.x, y: hoverPos.y, width: stampDims.w, length: stampDims.l }, deckWidth, deckLength, edgePad).x)}
            y={toY(clampToDeck({ x: hoverPos.x, y: hoverPos.y, width: stampDims.w, length: stampDims.l }, deckWidth, deckLength, edgePad).y)}
            width={stampDims.w * scale}
            height={stampDims.l * scale}
            rx={2}
            fill={activeStamp.color}
            fillOpacity={0.35}
            stroke={activeStamp.color}
            strokeWidth={1.5}
            strokeDasharray="4 2"
            pointerEvents="none"
          />
        )}

        {/* Dimension labels */}
        <text x={offX + w / 2} y={offY - 12} textAnchor="middle" fontSize={13} fontWeight={600} fill="#0f172a">
          {fmt(deckWidth)} {UNIT_LABEL[unit]}
        </text>
        <text
          x={offX - 16}
          y={offY + h / 2}
          textAnchor="middle"
          fontSize={13}
          fontWeight={600}
          fill="#0f172a"
          transform={`rotate(-90 ${offX - 16} ${offY + h / 2})`}
        >
          {fmt(deckLength)} {UNIT_LABEL[unit]}
        </text>
        <circle cx={offX} cy={offY} r={3} fill="#0f172a" />
      </svg>
    </div>
  )
}

function PlacedRect({
  item,
  x,
  y,
  w,
  h,
  hovered,
  showLabels,
  fmt,
  onHover,
  manualMode,
  onPointerDown,
}: {
  item: PlacedItem
  x: number
  y: number
  w: number
  h: number
  hovered: boolean
  showLabels: boolean
  fmt: (v: number) => string
  onHover: (id: string | null) => void
  manualMode: boolean
  onPointerDown?: (e: React.PointerEvent) => void
}) {
  return (
    <g
      onMouseEnter={() => onHover(item.itemId)}
      onMouseLeave={() => onHover(null)}
      onPointerDown={onPointerDown}
      style={{ cursor: manualMode ? (onPointerDown ? 'move' : 'default') : 'pointer', transition: 'opacity 0.15s' }}
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2}
        fill={item.color}
        fillOpacity={hovered ? 0.95 : 0.78}
        stroke={hovered ? '#0f172a' : 'rgba(15,23,42,0.55)'}
        strokeWidth={hovered ? 2 : 1}
      />
      {showLabels && w > 30 && h > 18 && (
        <>
          <text x={x + 4} y={y + 13} fontSize={Math.min(12, w / 8)} fontWeight={600} fill="#fff" className="select-none pointer-events-none">
            {clip(item.name, w)}
          </text>
          <text x={x + 4} y={y + 27} fontSize={Math.min(10, w / 10)} fill="rgba(255,255,255,0.92)" className="select-none pointer-events-none">
            {fmt(item.width)}×{fmt(item.length)}
            {item.rotated ? ' ↻' : ''}
          </text>
        </>
      )}
      {item.layers > 1 && w >= 16 && h >= 16 && (
        <g className="pointer-events-none">
          <rect x={x + w - 22} y={y + 2} width={20} height={14} rx={3} fill="rgba(0,0,0,0.55)" />
          <text x={x + w - 12} y={y + 12} fontSize={9} fontWeight={700} textAnchor="middle" fill="#fff" className="select-none">
            ×{item.layers}
          </text>
        </g>
      )}
      {item.rotated && item.layers <= 1 && w >= 16 && h >= 16 && (
        <text x={x + w - 6} y={y + 12} fontSize={10} textAnchor="end" fill="rgba(255,255,255,0.9)" className="select-none pointer-events-none">
          ↻
        </text>
      )}
    </g>
  )
}

function clip(s: string, w: number): string {
  const max = Math.max(4, Math.floor(w / 7))
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
