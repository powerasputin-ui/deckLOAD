'use client'

import { useMemo, useRef, useState, useCallback } from 'react'
import {
  computeFreeRects,
  clampToDeck,
  collidesWith,
  type PackingResult,
  type PlacedItem,
  type ManualPlacement,
  type PinnedPlacement,
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
  // Interactive auto mode
  pinnedPlacements: PinnedPlacement[]
  selectedPinIds: string[]
  onPinPlaced?: (placed: { itemId: string; name: string; x: number; y: number; width: number; length: number; layers: number; rotated: boolean; color: string; weight?: number }) => void
  onUpdatePinned?: (id: string, x: number, y: number) => void
  onRemovePinned?: (id: string) => void
  onRotatePinned?: (id: string) => void
  onTogglePinSelection?: (id: string, additive: boolean) => void
  onClearSelection?: () => void
  // Manual mode rotate
  onRotateManual?: (id: string) => void
}

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
  pinnedPlacements,
  selectedPinIds,
  onPinPlaced,
  onUpdatePinned,
  onRemovePinned,
  onRotatePinned,
  onTogglePinSelection,
  onClearSelection,
  onRotateManual,
}: DeckVisualizationProps) {
  const { deckWidth, deckLength } = result
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)
  const [dragState, setDragState] = useState<{
    id: string
    startMouse: { x: number; y: number }
    startPlace: { x: number; y: number }
  } | null>(null)
  const [pinDrag, setPinDrag] = useState<{
    id: string
    startDeck: { x: number; y: number }
    startPlace: { x: number; y: number }
    moved: boolean
  } | null>(null)
  const [selectedManual, setSelectedManual] = useState<string | null>(null)

  const isInteractiveAuto = mode === 'auto' && onPinPlaced && onUpdatePinned

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
      layers: 1,
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

  // Pin a placed auto-mode item so it becomes user-controlled
  const handlePinPointerDown = (
    e: React.PointerEvent,
    placed: PlacedItem,
    existingPinId?: string
  ) => {
    if (!isInteractiveAuto) return
    e.stopPropagation()
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    // If clicking an already-pinned item, keep it; otherwise create a pin
    let pinId = existingPinId
    if (!pinId) {
      pinId = onPinPlaced({
        itemId: placed.itemId,
        name: placed.name,
        x: placed.x,
        y: placed.y,
        width: placed.width,
        length: placed.length,
        layers: placed.layers,
        rotated: placed.rotated,
        color: placed.color,
        weight: placed.weight,
      })
    } else if (!additive) {
      onTogglePinSelection?.(pinId, false)
    }
    if (additive && pinId) {
      onTogglePinSelection?.(pinId, true)
    }
    const startDeck = screenToDeck(e.clientX, e.clientY)
    if (!startDeck || !pinId) return
    setPinDrag({
      id: pinId,
      startDeck,
      startPlace: { x: placed.x, y: placed.y },
      moved: false,
    })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  // Gap-aware collision resolution with "sliding" along obstacles.
  // Tries full delta, then X-only, then Y-only; if all collide, performs a
  // binary search along the movement vector to slide as close to the target as
  // possible without overlapping neighbours (instead of snapping back to start).
  const resolveDragPosition = (
    targetX: number,
    targetY: number,
    width: number,
    length: number,
    currentX: number,
    currentY: number,
    others: { x: number; y: number; width: number; length: number }[]
  ): { x: number; y: number } => {
    const tryPos = (x: number, y: number): { x: number; y: number } | null => {
      const clamped = clampToDeck(
        { x, y, width, length },
        deckWidth,
        deckLength,
        edgePad
      )
      if (!collidesWith({ ...clamped, width, length }, others, gap)) {
        return { x: clamped.x, y: clamped.y }
      }
      return null
    }

    // 1) full delta, 2) X-only, 3) Y-only
    const candidates: { x: number; y: number }[] = [
      { x: targetX, y: targetY },
      { x: targetX, y: currentY },
      { x: currentX, y: targetY },
    ]
    for (const c of candidates) {
      const res = tryPos(c.x, c.y)
      if (res) return res
    }

    // 4) Binary search along the movement vector to slide as close as possible
    let lo = 0
    let hi = 1
    let best: { x: number; y: number } | null = null
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2
      const x = currentX + (targetX - currentX) * mid
      const y = currentY + (targetY - currentY) * mid
      const res = tryPos(x, y)
      if (res) {
        best = res
        lo = mid
      } else {
        hi = mid
      }
    }
    return best ?? { x: currentX, y: currentY }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (mode === 'manual' && activeStamp && !dragState) {
      const pos = screenToDeck(e.clientX, e.clientY)
      if (pos) setHoverPos(pos)
    }
    if (dragState && onMoveManual) {
      const pos = screenToDeck(e.clientX, e.clientY)
      if (!pos) return
      const startDeck = screenToDeck(dragState.startMouse.x, dragState.startMouse.y)
      if (!startDeck) return
      const deltaX = pos.x - startDeck.x
      const deltaY = pos.y - startDeck.y
      const nx = dragState.startPlace.x + deltaX
      const ny = dragState.startPlace.y + deltaY
      const mp = manualPlacements.find((m) => m.id === dragState.id)
      if (mp) {
        const others = manualPlacements
          .filter((m) => m.id !== dragState.id)
          .map((m) => ({ x: m.x, y: m.y, width: m.width, length: m.length }))
        const resolved = resolveDragPosition(
          nx, ny, mp.width, mp.length, mp.x, mp.y, others
        )
        onMoveManual(dragState.id, resolved.x, resolved.y)
      }
    }
    if (pinDrag && onUpdatePinned) {
      const pos = screenToDeck(e.clientX, e.clientY)
      if (!pos) return
      const deltaX = pos.x - pinDrag.startDeck.x
      const deltaY = pos.y - pinDrag.startDeck.y
      if (Math.abs(deltaX) > 0.1 || Math.abs(deltaY) > 0.1) {
        setPinDrag((d) => (d ? { ...d, moved: true } : d))
      }
      const pin = pinnedPlacements.find((p) => p.id === pinDrag.id)
      if (!pin) return
      const nx = pinDrag.startPlace.x + deltaX
      const ny = pinDrag.startPlace.y + deltaY
      // Prevent overlap with OTHER pinned items (auto-packed items reflow)
      const others = pinnedPlacements
        .filter((p) => p.id !== pinDrag.id)
        .map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length }))
      const resolved = resolveDragPosition(
        nx, ny, pin.width, pin.length, pin.x, pin.y, others
      )
      onUpdatePinned(pinDrag.id, resolved.x, resolved.y)
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    // Click on empty deck area in interactive auto mode clears selection
    if (isInteractiveAuto && !pinDrag && !dragState) {
      const target = e.target as Element
      // Only clear if clicked directly on the SVG background or deck rect
      if (target.tagName === 'rect' || target.tagName === 'svg' || target.tagName === 'SVG') {
        const fill = target.getAttribute('fill')
        if (fill === '#ffffff' || fill === 'url(#deck-grid)' || target.tagName === 'svg') {
          onClearSelection?.()
        }
      }
    }
    setDragState(null)
    setPinDrag(null)
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
          // Find pinned placement matching this placed item (same position + itemId)
          const matchingPin = isInteractiveAuto
            ? pinnedPlacements.find(
                (pin) =>
                  pin.itemId === p.itemId &&
                  Math.abs(pin.x - p.x) < 0.01 &&
                  Math.abs(pin.y - p.y) < 0.01
              )
            : undefined
          const isPinnedSelected = !!matchingPin && selectedPinIds.includes(matchingPin.id)
          return (
            <PlacedRect
              key={mode === 'manual' ? `m-${p.manualId}` : `p-${idx}`}
              item={p}
              x={toX(p.x)}
              y={toY(p.y)}
              w={pw}
              h={ph}
              hovered={isHover || isSelected || isPinnedSelected}
              showLabels={showLabels}
              fmt={fmt}
              onHover={onHover}
              manualMode={mode === 'manual'}
              pinned={!!matchingPin}
              pinnedSelected={isPinnedSelected}
              onPointerDown={
                mode === 'manual' && p.manualId
                  ? (e) => handleManualPointerDown(e, manualPlacements.find((m) => m.id === p.manualId)!)
                  : isInteractiveAuto
                    ? (e) => handlePinPointerDown(e, p, matchingPin?.id)
                    : undefined
              }
            />
          )
        })}

        {/* Auto mode: rotate + delete buttons on a selected pinned item (single selection) */}
        {isInteractiveAuto &&
          selectedPinIds.length === 1 &&
          (() => {
            const pin = pinnedPlacements.find((p) => p.id === selectedPinIds[0])
            if (!pin) return null
            const rcx = toX(pin.x)
            const rcy = toY(pin.y)
            const dcx = toX(pin.x + pin.width)
            const dcy = toY(pin.y)
            return (
              <>
                {onRotatePinned && (
                  <g
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRotatePinned(pin.id)
                    }}
                  >
                    <circle cx={rcx} cy={rcy} r={9} fill="#7c3aed" stroke="#fff" strokeWidth={1.5} />
                    <text x={rcx} y={rcy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#fff">↻</text>
                  </g>
                )}
                {onRemovePinned && (
                  <g
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemovePinned(pin.id)
                    }}
                  >
                    <circle cx={dcx} cy={dcy} r={9} fill="#ef4444" stroke="#fff" strokeWidth={1.5} />
                    <text x={dcx} y={dcy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#fff">✕</text>
                  </g>
                )}
              </>
            )
          })()}

        {/* Manual mode: rotate + delete buttons on selected */}
        {mode === 'manual' &&
          selectedManual &&
          (() => {
            const mp = manualPlacements.find((m) => m.id === selectedManual)
            if (!mp) return null
            const rcx = toX(mp.x)
            const rcy = toY(mp.y)
            const dcx = toX(mp.x + mp.width)
            const dcy = toY(mp.y)
            return (
              <>
                {onRotateManual && (
                  <g
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRotateManual(mp.id)
                    }}
                  >
                    <circle cx={rcx} cy={rcy} r={9} fill="#7c3aed" stroke="#fff" strokeWidth={1.5} />
                    <text x={rcx} y={rcy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#fff">↻</text>
                  </g>
                )}
                {onRemoveManual && (
                  <g
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveManual(mp.id)
                      setSelectedManual(null)
                    }}
                  >
                    <circle cx={dcx} cy={dcy} r={9} fill="#ef4444" stroke="#fff" strokeWidth={1.5} />
                    <text x={dcx} y={dcy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#fff">✕</text>
                  </g>
                )}
              </>
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
  pinned,
  pinnedSelected,
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
  pinned?: boolean
  pinnedSelected?: boolean
}) {
  const strokeColor = pinnedSelected
    ? '#7c3aed'
    : pinned
      ? '#0f172a'
      : hovered
        ? '#0f172a'
        : 'rgba(15,23,42,0.55)'
  const strokeWidth = pinnedSelected ? 3 : pinned || hovered ? 2 : 1
  const cursor = manualMode
    ? onPointerDown ? 'move' : 'default'
    : onPointerDown
      ? 'grab'
      : 'pointer'
  return (
    <g
      onMouseEnter={() => onHover(item.itemId)}
      onMouseLeave={() => onHover(null)}
      onPointerDown={onPointerDown}
      style={{ cursor, transition: 'opacity 0.15s' }}
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2}
        fill={item.color}
        fillOpacity={hovered ? 0.95 : 0.78}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={pinned ? '4 2' : undefined}
      />
      {pinned && (
        <g className="pointer-events-none">
          <rect x={x + w - 16} y={y + h - 14} width={14} height={11} rx={2} fill="rgba(124,58,237,0.9)" />
          <text x={x + w - 9} y={y + h - 5} fontSize={8} fontWeight={700} textAnchor="middle" fill="#fff" className="select-none">PIN</text>
        </g>
      )}
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
