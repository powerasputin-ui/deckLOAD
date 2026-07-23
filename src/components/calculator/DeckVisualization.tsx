'use client'

import { useMemo } from 'react'
import {
  computeFreeRects,
  type PackingResult,
  type PlacedItem,
} from '@/lib/packing'
import { UNIT_LABEL } from '@/store/calculator'
import { cn } from '@/lib/utils'

interface DeckVisualizationProps {
  result: PackingResult
  unit: 'm' | 'cm' | 'ft'
  showFreeSpace: boolean
  showGrid: boolean
  showLabels: boolean
  hoveredItemId: string | null
  onHover: (id: string | null) => void
}

export function DeckVisualization({
  result,
  unit,
  showFreeSpace,
  showGrid,
  showLabels,
  hoveredItemId,
  onHover,
}: DeckVisualizationProps) {
  const { deckWidth, deckLength, placed } = result

  const freeRects = useMemo(
    () => computeFreeRects(deckWidth, deckLength, placed),
    [deckWidth, deckLength, placed]
  )

  // Fit deck into a viewport with padding
  const maxW = 900
  const maxH = 560
  const pad = 28
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

  const toX = (v: number) => offX + v * scale
  const toY = (v: number) => offY + v * scale

  const fmt = (v: number) => {
    const r = Math.round(v * 100) / 100
    return Number.isInteger(r) ? `${r}` : r.toFixed(2)
  }

  const hasContent = placed.length > 0 || deckWidth > 0

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${maxW} ${maxH}`}
        className="w-full h-auto min-h-[320px]"
        style={{ maxHeight: 560 }}
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
          <pattern
            id="free-hatch"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="8" height="8" fill="transparent" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="8"
              stroke="hsl(142 71% 45% / 0.18)"
              strokeWidth="3"
            />
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
          <rect
            x={offX}
            y={offY}
            width={w}
            height={h}
            rx={6}
            fill="url(#deck-grid)"
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
                  stroke="hsl(142 71% 45% / 0.45)"
                  strokeWidth={0.75}
                  strokeDasharray="4 3"
                />
                {fw > 36 && fh > 22 && (
                  <text
                    x={toX(fr.x) + fw / 2}
                    y={toY(fr.y) + fh / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="select-none"
                    fontSize={11}
                    fill="hsl(142 71% 35% / 0.85)"
                  >
                    {fmt(fr.width)}×{fmt(fr.height)}
                  </text>
                )}
              </g>
            )
          })}

        {/* Placed items */}
        {placed.map((p) => {
          const pw = p.width * scale
          const ph = p.length * scale
          const isHover = hoveredItemId === p.itemId
          return (
            <PlacedRect
              key={`p-${p.index}`}
              item={p}
              x={toX(p.x)}
              y={toY(p.y)}
              w={pw}
              h={ph}
              hovered={isHover}
              showLabels={showLabels}
              fmt={fmt}
              onHover={onHover}
            />
          )
        })}

        {/* Dimension labels */}
        <text
          x={offX + w / 2}
          y={offY - 10}
          textAnchor="middle"
          fontSize={13}
          fontWeight={600}
          fill="#0f172a"
        >
          {fmt(deckWidth)} {UNIT_LABEL[unit]}
        </text>
        <text
          x={offX - 14}
          y={offY + h / 2}
          textAnchor="middle"
          fontSize={13}
          fontWeight={600}
          fill="#0f172a"
          transform={`rotate(-90 ${offX - 14} ${offY + h / 2})`}
        >
          {fmt(deckLength)} {UNIT_LABEL[unit]}
        </text>

        {/* Corner origin marker */}
        <circle
          cx={offX}
          cy={offY}
          r={3}
          fill="#0f172a"
        />
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
}) {
  const stroke = hovered ? '#0f172a' : 'rgba(15,23,42,0.55)'
  return (
    <g
      onMouseEnter={() => onHover(item.itemId)}
      onMouseLeave={() => onHover(null)}
      className="cursor-pointer"
      style={{ transition: 'opacity 0.15s' }}
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2}
        fill={item.color}
        fillOpacity={hovered ? 0.95 : 0.78}
        stroke={stroke}
        strokeWidth={hovered ? 2 : 1}
      />
      {showLabels && w > 30 && h > 18 && (
        <>
          <text
            x={x + 4}
            y={y + 13}
            fontSize={Math.min(12, w / 8)}
            fontWeight={600}
            fill="#fff"
            className="select-none pointer-events-none"
          >
            {clip(item.name, w)}
          </text>
          <text
            x={x + 4}
            y={y + 27}
            fontSize={Math.min(10, w / 10)}
            fill="rgba(255,255,255,0.92)"
            className="select-none pointer-events-none"
          >
            {fmt(item.width)}×{fmt(item.length)}
            {item.rotated ? ' ↻' : ''}
          </text>
        </>
      )}
      {item.rotated && w >= 16 && h >= 16 && (
        <text
          x={x + w - 6}
          y={y + 12}
          fontSize={10}
          textAnchor="end"
          fill="rgba(255,255,255,0.9)"
          className="select-none pointer-events-none"
        >
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
