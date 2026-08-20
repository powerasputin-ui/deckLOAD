'use client'

import { useMemo, useRef, useState, useCallback, useEffect, forwardRef } from 'react'
import { ZoomIn, ZoomOut, Maximize, Image as ImageIcon, Upload, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PhotoCropDialog } from './PhotoCropDialog'
import {
  computeFreeRects,
  computeGridStep,
  clampToDeck,
  collidesPrecisely,
  rectInsidePolygon,
  erodePolygon,
  dedupePolygonVertices,
  withClearanceFootprint,
  lashingPointExclusionRects,
  rotateOutline90,
  resolveSnappedDragPosition,
  checkLoadDensity,
  checkLashingBalance,
  DEFAULT_VESSEL_MOTION,
  violatesSeparation,
  type PackingResult,
  type PlacedItem,
  type ManualPlacement,
  type PinnedPlacement,
  type LoadZone,
  type SeparationRule,
  type LashingPoint,
  type VesselMotion,
  type ClearanceMargin,
} from '@/lib/packing'
import { UNIT_LABEL } from '@/store/calculator'
import { fmtNumber } from '@/lib/utils'
import { v4 as uuid } from 'uuid'
import { toast } from 'sonner'

interface DeckVisualizationProps {
  result: PackingResult
  unit: 'm' | 'cm' | 'ft'
  gap: number
  boardOffset: number
  showFreeSpace: boolean
  showGrid: boolean
  showLabels: boolean
  backgroundImage?: string
  backgroundImageOpacity?: number
  onSetBackgroundImage?: (dataUrl: string | null) => void
  onSetBackgroundImageOpacity?: (opacity: number) => void
  // Real (possibly non-rectangular) deck silhouette — see DeckConfig.outline
  // in calculator.ts. Undefined = plain rectangle, today's behavior.
  deckOutline?: { x: number; y: number }[]
  editingDeckOutline?: boolean
  onSetDeckOutline?: (outline: { x: number; y: number }[] | undefined) => void
  onSetEditingDeckOutline?: (v: boolean) => void
  hoveredItemId: string | null
  onHover: (id: string | null) => void
  mode: 'auto' | 'manual'
  activeStamp: { id: string; width: number; length: number; color: string; name: string; weight?: number; shape?: PlacedItem['shape']; outline?: { x: number; y: number }[] } | null
  stampRotated: boolean
  onPlace?: (p: ManualPlacement) => void
  onMoveManual?: (id: string, x: number, y: number) => void
  onUpdateManualClearance?: (id: string, margin: ClearanceMargin) => void
  onRemoveManual?: (id: string) => void
  // Dragging one placement onto another of the same item merges them into a
  // single stacked footprint (layers add up, the dragged one is removed).
  onMergeManual?: (draggedId: string, targetId: string) => void
  manualPlacements: ManualPlacement[]
  // Interactive auto mode
  pinnedPlacements: PinnedPlacement[]
  selectedPinIds: string[]
  onPinPlaced?: (placed: { itemId: string; name: string; x: number; y: number; width: number; length: number; layers: number; rotated: boolean; color: string; weight?: number }) => string | undefined
  onUpdatePinned?: (id: string, x: number, y: number) => void
  onUpdatePinnedClearance?: (id: string, margin: ClearanceMargin) => void
  onMergePinned?: (draggedId: string, targetId: string) => void
  onRemovePinned?: (id: string) => void
  onRotatePinned?: (id: string) => void
  onTogglePinSelection?: (id: string, additive: boolean) => void
  onClearSelection?: () => void
  // Manual mode rotate
  onRotateManual?: (id: string) => void
  // Layer change (per-placement)
  onLayerChangePinned?: (id: string, delta: number) => void
  onLayerChangeManual?: (id: string, delta: number) => void
  // Layer validation info for single-selected placement
  getLayerInfo?: (itemId: string, currentLayers: number, excludeId?: string) => { maxPhys: number; canIncrease: boolean; canDecrease: boolean; blockReason?: string }
  // Manual multi-selection
  selectedManualIds?: string[]
  onToggleManualSelection?: (id: string, additive: boolean) => void
  onClearManualSelection?: () => void
  // Maritime/offshore extras
  loadZones?: LoadZone[]
  lashingPoints?: LashingPoint[]
  categoryByItemId?: Map<string, string | undefined>
  separationRules?: SeparationRule[]
  placingLashingPoint?: boolean
  onPlaceLashingPoint?: (
    x: number,
    y: number,
    corner?: { placementId: string; cornerX: number; cornerY: number }
  ) => void
  onUpdateLashingPoint?: (id: string, patch: { x?: number; y?: number }) => void
  vesselMotion?: VesselMotion
  onUpdateLoadZone?: (id: string, patch: { x?: number; y?: number; width?: number; length?: number }) => void
  // Custom hand-drawn cargo outline ("Нарисовать"): armed boolean + finish
  // callback, mirroring placingLashingPoint/onPlaceLashingPoint. Points are
  // raw deck-meter coordinates in click order; normalization into a
  // local-origin outline happens in page.tsx, keeping this component "dumb".
  drawingCustomShape?: boolean
  onFinishDrawing?: (points: { x: number; y: number }[]) => void
}

export const DeckVisualization = forwardRef<SVGSVGElement, DeckVisualizationProps>(function DeckVisualization({
  result,
  unit,
  gap,
  boardOffset,
  showFreeSpace,
  showGrid,
  showLabels,
  backgroundImage,
  backgroundImageOpacity,
  onSetBackgroundImage,
  onSetBackgroundImageOpacity,
  deckOutline,
  editingDeckOutline,
  onSetDeckOutline,
  onSetEditingDeckOutline,
  hoveredItemId,
  onHover,
  mode,
  activeStamp,
  stampRotated,
  onPlace,
  onMoveManual,
  onUpdateManualClearance,
  onRemoveManual,
  onMergeManual,
  manualPlacements,
  pinnedPlacements,
  selectedPinIds,
  onPinPlaced,
  onUpdatePinned,
  onUpdatePinnedClearance,
  onMergePinned,
  onRemovePinned,
  onRotatePinned,
  onTogglePinSelection,
  onClearSelection,
  onRotateManual,
  onLayerChangePinned,
  onLayerChangeManual,
  getLayerInfo,
  selectedManualIds,
  onToggleManualSelection,
  onClearManualSelection,
  loadZones,
  lashingPoints,
  categoryByItemId,
  separationRules,
  placingLashingPoint,
  onPlaceLashingPoint,
  onUpdateLashingPoint,
  vesselMotion,
  onUpdateLoadZone,
  drawingCustomShape,
  onFinishDrawing,
}: DeckVisualizationProps, forwardedRef) {
  const { deckWidth, deckLength } = result
  const svgRef = useRef<SVGSVGElement>(null)
  const setSvgRef = useCallback(
    (node: SVGSVGElement | null) => {
      svgRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    },
    [forwardedRef]
  )
  // Zoom/pan: viewBox stays at maxW×maxH (deck-unit conversion below is
  // unaffected), but we can show a smaller/shifted window into it. Since
  // screenToDeck reads getScreenCTM() (which already reflects the current
  // viewBox), all existing click/drag placement math keeps working unchanged.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  // Deck background photo: file picker opens the crop dialog with the raw
  // decoded bitmap (no compression yet — that happens once, on crop
  // confirm, against the already-cropped region). Compressed data
  // URL/opacity live in the store (deck.backgroundImage), threaded in as
  // plain props like every other deck setting this component never reaches
  // into useCalculator for.
  const backgroundFileInputRef = useRef<HTMLInputElement>(null)
  const [cropBitmap, setCropBitmap] = useState<ImageBitmap | null>(null)
  const handleBackgroundFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    try {
      const bitmap = await createImageBitmap(file)
      setCropBitmap(bitmap)
    } catch {
      toast.error('Не удалось загрузить фото палубы')
    }
  }
  const handleCropConfirm = (dataUrl: string) => {
    onSetBackgroundImage?.(dataUrl)
    cropBitmap?.close?.()
    setCropBitmap(null)
  }
  const handleCropCancel = () => {
    cropBitmap?.close?.()
    setCropBitmap(null)
  }
  // Right-click deck menu: "Редактировать" (deck outline) / "Загрузить
  // фото" (same upload flow as the toolbar button — reuses the same hidden
  // file input, no duplicate upload logic). Screen-space {x,y}, not deck
  // coords, since the menu is a position:fixed overlay.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const handleDeckContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [contextMenu])
  const [panDrag, setPanDrag] = useState<{ startMouse: { x: number; y: number }; startPan: { x: number; y: number } } | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)
  const [lashingHoverPos, setLashingHoverPos] = useState<{ x: number; y: number } | null>(null)
  // Two-step lashing placement: first click picks the nearest corner of a
  // pinned/manual cargo placement (a still-auto-placed item isn't eligible —
  // its position can move on the next repack), second click drops the deck
  // anchor. Cleared whenever placement mode is disarmed.
  const [pendingLashingCorner, setPendingLashingCorner] = useState<{
    placementId: string
    itemId: string
    cornerX: number
    cornerY: number
  } | null>(null)
  const [selectedLashingId, setSelectedLashingId] = useState<string | null>(null)
  const [lashingAnchorDrag, setLashingAnchorDrag] = useState<{
    id: string
    startMouse: { x: number; y: number }
    startPos: { x: number; y: number }
  } | null>(null)
  // Reset the pending corner when placement mode is disarmed. Done inline
  // during render, comparing against a plain-state "previous value" — the
  // React-documented way to adjust state on a prop change ("You Might Not
  // Need an Effect") — rather than a useEffect (extra render pass) or a ref
  // read during render (disallowed by this project's lint rules).
  const [prevPlacingLashingPoint, setPrevPlacingLashingPoint] = useState(placingLashingPoint)
  if (placingLashingPoint !== prevPlacingLashingPoint) {
    setPrevPlacingLashingPoint(placingLashingPoint)
    if (!placingLashingPoint && pendingLashingCorner) setPendingLashingCorner(null)
  }
  // Custom-shape drawing: confirmed points + live cursor position, same
  // local-state split as pendingLashingCorner/lashingHoverPos. Reset on
  // disarm via the same "compare against previous prop" render-time pattern
  // (not useEffect — this project's lint rules forbid setState in effects).
  const [drawingPoints, setDrawingPoints] = useState<{ x: number; y: number }[]>([])
  const [drawHoverPos, setDrawHoverPos] = useState<{ x: number; y: number } | null>(null)
  const [prevDrawingCustomShape, setPrevDrawingCustomShape] = useState(drawingCustomShape)
  if (drawingCustomShape !== prevDrawingCustomShape) {
    setPrevDrawingCustomShape(drawingCustomShape)
    if (!drawingCustomShape && drawingPoints.length) setDrawingPoints([])
  }
  // Deck outline editor: drag existing vertices, click a mid-edge to insert
  // a new one, "×" a vertex to remove it (min 3 kept). Seeded fresh every
  // time the mode is armed — from the current deck.outline if one exists,
  // else the plain bounding-box rectangle's 4 corners (editing always starts
  // from "currently a rectangle" when nothing's been drawn yet).
  const [editingOutline, setEditingOutline] = useState<{ x: number; y: number }[]>([])
  const [draggingVertexIndex, setDraggingVertexIndex] = useState<number | null>(null)
  const [prevEditingDeckOutline, setPrevEditingDeckOutline] = useState(editingDeckOutline)
  if (editingDeckOutline !== prevEditingDeckOutline) {
    setPrevEditingDeckOutline(editingDeckOutline)
    if (editingDeckOutline) {
      setEditingOutline(
        deckOutline && deckOutline.length >= 3
          ? deckOutline
          : [
              { x: 0, y: 0 },
              { x: deckWidth, y: 0 },
              { x: deckWidth, y: deckLength },
              { x: 0, y: deckLength },
            ]
      )
    } else {
      setDraggingVertexIndex(null)
    }
  }
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  type ZoneDrag = {
    id: string
    kind: 'move' | 'resize'
    corner?: 'nw' | 'ne' | 'sw' | 'se'
    startMouse: { x: number; y: number }
    startRect: { x: number; y: number; width: number; length: number }
  }
  const [zoneDrag, setZoneDrag] = useState<ZoneDrag | null>(null)
  // Dragging a clearance-zone corner handle changes 1-2 adjacent margin
  // sides at once (not a freestanding rect move/resize like LoadZone —
  // the rect is always cargo footprint + margin, so the handle edits the
  // margin, and the cargo itself never moves).
  const [clearanceDrag, setClearanceDrag] = useState<{
    kind: 'manual' | 'pin'
    id: string
    corner: 'nw' | 'ne' | 'sw' | 'se'
    startMouse: { x: number; y: number }
    startMargin: ClearanceMargin
  } | null>(null)
  // While dragging a placement over another same-item placement, this holds
  // the id of the potential merge target (see handlePointerMove).
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null)
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
  // Single-selection for manual mode uses selectedManualIds[0] from store (single source of truth)
  const selectedManual = selectedManualIds?.[0] ?? null

  // Throttle drag commits so the store (and the expensive auto-packer) is not
  // updated on every pointermove event. We keep the latest position in a ref and
  // flush it at most every 50 ms, plus always on pointerup.
  const lastDragCommit = useRef(0)
  const pendingDrag = useRef<{
    id: string
    x: number
    y: number
    kind: 'manual' | 'pin'
  } | null>(null)
  const dragTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (dragTimeout.current) {
        clearTimeout(dragTimeout.current)
        dragTimeout.current = null
      }
    }
  }, [])

  const flushPendingDrag = useCallback(() => {
    if (!pendingDrag.current) return
    const { id, x, y, kind } = pendingDrag.current
    pendingDrag.current = null
    if (dragTimeout.current) {
      clearTimeout(dragTimeout.current)
      dragTimeout.current = null
    }
    if (kind === 'manual') {
      onMoveManual?.(id, x, y)
    } else {
      onUpdatePinned?.(id, x, y)
    }
  }, [onMoveManual, onUpdatePinned])

  const scheduleDragCommit = useCallback(
    (id: string, x: number, y: number, kind: 'manual' | 'pin') => {
      pendingDrag.current = { id, x, y, kind }
      const now = performance.now()
      if (now - lastDragCommit.current >= 50) {
        if (dragTimeout.current) clearTimeout(dragTimeout.current)
        dragTimeout.current = null
        lastDragCommit.current = now
        flushPendingDrag()
      } else if (!dragTimeout.current) {
        dragTimeout.current = setTimeout(() => {
          dragTimeout.current = null
          lastDragCommit.current = performance.now()
          flushPendingDrag()
        }, 50 - (now - lastDragCommit.current))
      }
    },
    [flushPendingDrag]
  )

  const isInteractiveAuto = mode === 'auto' && onPinPlaced && onUpdatePinned

  const edgePad = boardOffset

  const freeRects = useMemo(
    () => computeFreeRects(deckWidth, deckLength, result.placed, gap, boardOffset, deckOutline),
    [deckWidth, deckLength, result.placed, gap, boardOffset, deckOutline]
  )

  // Board offset along the real contour, not the bounding box — see
  // erodePolygon's own comment in packing.ts. Used everywhere a placement
  // needs to stay clear of both the deck's cut edges AND its normal board
  // offset margin; undefined when there's no custom outline (rectangle deck
  // keeps using the existing edgePad-based clamp/checks, unchanged).
  const usableOutline = useMemo(
    () => (deckOutline && deckOutline.length >= 3 ? erodePolygon(deckOutline, boardOffset) : undefined),
    [deckOutline, boardOffset]
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

  const gridStep = computeGridStep(deckWidth, deckLength)

  // Zoom/pan window into the fixed maxW×maxH user-space coordinate system.
  const MIN_ZOOM = 1
  const MAX_ZOOM = 4
  const viewBoxW = maxW / zoom
  const viewBoxH = maxH / zoom
  const clampPan = useCallback(
    (p: { x: number; y: number }, vbW: number, vbH: number) => ({
      x: Math.min(Math.max(p.x, 0), Math.max(0, maxW - vbW)),
      y: Math.min(Math.max(p.y, 0), Math.max(0, maxH - vbH)),
    }),
    []
  )

  // Convert a screen point to the current viewBox's user-space coordinates
  // (i.e. same units as pan.x/pan.y — NOT deck units like screenToDeck below).
  const screenToViewBox = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return null
      const pt = svg.createSVGPoint()
      pt.x = clientX
      pt.y = clientY
      const ctm = svg.getScreenCTM()
      if (!ctm) return null
      const p = pt.matrixTransform(ctm.inverse())
      return { x: p.x, y: p.y }
    },
    []
  )

  // Zooms so that the given point, expressed in the same user-space units as
  // pan.x/pan.y (0..maxW / 0..maxH), stays visually fixed under itself.
  const zoomAtPoint = useCallback(
    (anchor: { x: number; y: number }, nextZoom: number) => {
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
      setZoom((prevZoom) => {
        const nextW = maxW / clamped
        const nextH = maxH / clamped
        const fracX = (anchor.x - pan.x) / (maxW / prevZoom)
        const fracY = (anchor.y - pan.y) / (maxH / prevZoom)
        setPan(clampPan({ x: anchor.x - fracX * nextW, y: anchor.y - fracY * nextH }, nextW, nextH))
        return clamped
      })
    },
    [clampPan, pan]
  )

  const zoomAtScreenPoint = useCallback(
    (clientX: number, clientY: number, nextZoom: number) => {
      const anchor = screenToViewBox(clientX, clientY)
      if (!anchor) {
        setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom)))
        return
      }
      zoomAtPoint(anchor, nextZoom)
    },
    [screenToViewBox, zoomAtPoint]
  )

  const zoomAtCenter = useCallback(
    (nextZoom: number) => {
      zoomAtPoint({ x: pan.x + viewBoxW / 2, y: pan.y + viewBoxH / 2 }, nextZoom)
    },
    [zoomAtPoint, pan, viewBoxW, viewBoxH]
  )

  const resetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  // zoomAtScreenPoint reads the latest zoom via a ref so the wheel listener
  // below (which subscribes once per svg mount) doesn't need to be
  // re-attached on every zoom/pan change.
  const zoomRef = useRef(zoom)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])
  const zoomAtScreenPointRef = useRef(zoomAtScreenPoint)
  useEffect(() => {
    zoomAtScreenPointRef.current = zoomAtScreenPoint
  }, [zoomAtScreenPoint])

  // Native (non-passive) wheel listener — React's onWheel prop is attached
  // as a passive listener, so calling preventDefault() inside a JSX onWheel
  // handler does NOT stop the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const step = e.deltaY > 0 ? -0.25 : 0.25
      zoomAtScreenPointRef.current(e.clientX, e.clientY, zoomRef.current + step)
    }
    svg.addEventListener('wheel', handleWheel, { passive: false })
    return () => svg.removeEventListener('wheel', handleWheel)
  }, [])

  // Suppresses the click-through that would otherwise place a cargo stamp
  // (manual mode) right after a pan-drag gesture releases over the deck.
  const panMovedRef = useRef(false)

  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return
    const target = e.target as Element
    if (!(target === svgRef.current || target.hasAttribute('data-deck-background'))) return
    panMovedRef.current = false
    setPanDrag({ startMouse: { x: e.clientX, y: e.clientY }, startPan: pan })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

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
  const fmt = fmtNumber

  // The rotate/delete/layer +/- controls anchor to an item's own corners in
  // screen space — fine for normal cargo, but a thin item like a pipe
  // (e.g. 9.5 x 0.15m) renders its short side as a near-zero pixel span, so
  // two opposite corners collapse onto the same point and the controls pile
  // up on top of each other. Anchor to a box centered on the item instead,
  // clamped to a minimum on-screen span, so controls always have room to
  // sit apart regardless of how thin the real footprint is.
  const MIN_CONTROL_SPAN = 44
  const controlAnchors = (x: number, y: number, width: number, length: number) => {
    const left = toX(x)
    const top = toY(y)
    const pxW = toX(x + width) - left
    const pxH = toY(y + length) - top
    const effW = Math.max(pxW, MIN_CONTROL_SPAN)
    const effH = Math.max(pxH, MIN_CONTROL_SPAN)
    const ccx = left + pxW / 2
    const ccy = top + pxH / 2
    return {
      rcx: ccx - effW / 2,
      rcy: ccy - effH / 2,
      dcx: ccx + effW / 2,
      dcy: ccy - effH / 2,
      lcx: ccx + effW / 2,
      lcy: ccy + effH / 2,
    }
  }

  const stampDims = activeStamp
    ? stampRotated
      ? { w: activeStamp.length, l: activeStamp.width }
      : { w: activeStamp.width, l: activeStamp.length }
    : null

  // First click of lashing placement: if it lands on a pinned (auto mode) or
  // manual placement, return that placement's stable id + nearest corner so
  // the lashing can be attached to it. A still-auto-placed (unpinned) item
  // isn't eligible — its position can move on the next repack — so it falls
  // through to the plain-unattached-point behavior below, same as clicking
  // empty deck.
  const findAttachableCorner = (
    deckX: number,
    deckY: number
  ): { placementId: string; itemId: string; cornerX: number; cornerY: number } | null => {
    for (const p of renderedItems) {
      if (deckX < p.x || deckX > p.x + p.width || deckY < p.y || deckY > p.y + p.length) continue
      const placementId =
        mode === 'manual'
          ? p.manualId
          : pinnedPlacements.find(
              (pin) => pin.itemId === p.itemId && Math.abs(pin.x - p.x) < 0.01 && Math.abs(pin.y - p.y) < 0.01
            )?.id
      if (!placementId) return null
      const corners = [
        { x: p.x, y: p.y },
        { x: p.x + p.width, y: p.y },
        { x: p.x, y: p.y + p.length },
        { x: p.x + p.width, y: p.y + p.length },
      ]
      let best = corners[0]
      let bestDist = Infinity
      for (const c of corners) {
        const d = Math.hypot(c.x - deckX, c.y - deckY)
        if (d < bestDist) {
          bestDist = d
          best = c
        }
      }
      return { placementId, itemId: p.itemId, cornerX: best.x, cornerY: best.y }
    }
    return null
  }

  // Lashing-point placement is independent of auto/manual mode. Two-step when
  // the first click lands on an attachable placement (see above): the click
  // arms the corner instead of placing anything, and the NEXT click drops the
  // deck anchor and creates the attached point. Otherwise (empty deck, or an
  // unpinned auto-placed item) a single click drops a plain unattached point,
  // same as before this feature existed — no edge margin, real lashing
  // points are often right at the rail.
  const handleLashingClick = (e: React.MouseEvent): boolean => {
    if (!placingLashingPoint || !onPlaceLashingPoint) return false
    const pos = screenToDeck(e.clientX, e.clientY)
    if (!pos) return true
    const x = Math.max(0, Math.min(deckWidth, pos.x))
    const y = Math.max(0, Math.min(deckLength, pos.y))
    if (!pendingLashingCorner) {
      const corner = findAttachableCorner(x, y)
      if (corner) {
        setPendingLashingCorner(corner)
        return true
      }
      onPlaceLashingPoint(x, y)
      return true
    }
    onPlaceLashingPoint(x, y, pendingLashingCorner)
    setPendingLashingCorner(null)
    return true
  }

  const CLOSE_LOOP_PIXEL_RADIUS = 10

  // Point-by-point outline drawing: each click appends a vertex; clicking
  // near the first vertex (once >=3 exist) closes the loop and hands the raw
  // points to onFinishDrawing. Same short-circuit shape as handleLashingClick.
  const handleDrawClick = (e: React.MouseEvent): boolean => {
    if (!drawingCustomShape || !onFinishDrawing) return false
    const pos = screenToDeck(e.clientX, e.clientY)
    if (!pos) return true
    const x = Math.max(0, Math.min(deckWidth, pos.x))
    const y = Math.max(0, Math.min(deckLength, pos.y))
    if (drawingPoints.length >= 3) {
      const first = drawingPoints[0]
      const distPx = Math.hypot(toX(x) - toX(first.x), toY(y) - toY(first.y))
      if (distPx <= CLOSE_LOOP_PIXEL_RADIUS) {
        onFinishDrawing(drawingPoints)
        setDrawingPoints([])
        return true
      }
    }
    setDrawingPoints((pts) => [...pts, { x, y }])
    return true
  }

  const EDGE_INSERT_PIXEL_RADIUS = 10

  // Editor click: clicking near an existing vertex handle is handled by
  // that handle's own onPointerDown (drag), so any click that reaches here
  // means "insert a new vertex" — find the nearest edge segment (by
  // perpendicular screen-px distance) and splice a point in after it. Short
  // clicks that land far from every edge are ignored (dead corner-click,
  // same as clicking empty deck space elsewhere in this file).
  const handleOutlineEditClick = (e: React.MouseEvent): boolean => {
    if (!editingDeckOutline) return false
    const pos = screenToDeck(e.clientX, e.clientY)
    if (!pos) return true
    const x = Math.max(0, Math.min(deckWidth, pos.x))
    const y = Math.max(0, Math.min(deckLength, pos.y))
    let bestIndex = -1
    let bestDistPx = Infinity
    for (let i = 0; i < editingOutline.length; i++) {
      const a = editingOutline[i]
      const b = editingOutline[(i + 1) % editingOutline.length]
      const ax = toX(a.x), ay = toY(a.y), bx = toX(b.x), by = toY(b.y)
      const px = toX(x), py = toY(y)
      const dx = bx - ax, dy = by - ay
      const lenSq = dx * dx + dy * dy
      const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0
      const cx = ax + t * dx, cy = ay + t * dy
      const distPx = Math.hypot(px - cx, py - cy)
      if (distPx < bestDistPx) {
        bestDistPx = distPx
        bestIndex = i
      }
    }
    if (bestIndex >= 0 && bestDistPx <= EDGE_INSERT_PIXEL_RADIUS) {
      setEditingOutline((pts) => [...pts.slice(0, bestIndex + 1), { x, y }, ...pts.slice(bestIndex + 1)])
    }
    return true
  }

  const handleOutlineVertexPointerDown = (e: React.PointerEvent, index: number) => {
    e.stopPropagation()
    setDraggingVertexIndex(index)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const handleOutlineVertexRemove = (index: number) => {
    if (editingOutline.length <= 3) return
    setEditingOutline((pts) => pts.filter((_, i) => i !== index))
  }

  const handleOutlineConfirm = () => {
    // Cleans up any near-duplicate vertex a drag/insert interaction may have
    // left behind (see dedupePolygonVertices) before it ever reaches the
    // store — every downstream consumer (erosion, exclusion rects, area,
    // 3D extrusion) then always works with a well-formed polygon.
    onSetDeckOutline?.(dedupePolygonVertices(editingOutline))
    onSetEditingDeckOutline?.(false)
  }
  const handleOutlineCancel = () => {
    onSetEditingDeckOutline?.(false)
  }

  // Backspace removes the last placed vertex while drawing (Escape cancels
  // the whole in-progress drawing — handled in page.tsx's combined disarm
  // handler, alongside placingLashingPoint/activeStampId/pendingPresetStamp).
  useEffect(() => {
    if (!drawingCustomShape) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      setDrawingPoints((pts) => pts.slice(0, -1))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawingCustomShape])

  const handleDeckClick = (e: React.MouseEvent) => {
    if (panMovedRef.current) {
      panMovedRef.current = false
      return
    }
    if (handleDrawClick(e)) return
    if (handleOutlineEditClick(e)) return
    if (handleLashingClick(e)) return
    if (!activeStamp || !stampDims || !onPlace) return
    const pos = screenToDeck(e.clientX, e.clientY)
    if (!pos) return
    // Snap so the item's top-left is at the cursor, then clamp inside deck
    const clamped = clampToDeck(
      { x: pos.x, y: pos.y, width: stampDims.w, length: stampDims.l },
      deckWidth,
      deckLength,
      edgePad
    )
    // Check collision against whatever is currently rendered — manual
    // placements in manual mode, algorithm-placed/pinned items in auto mode
    // (renderedItems already resolves to the right source for either).
    // Checked in two passes so a rejection caused specifically by someone
    // else's clearance zone gets an explanation — plain overlap with a real
    // footprint is self-evident on screen and stays a silent no-op, like it
    // always has, but a click that's rejected only because of an invisible
    // inflated margin looked like the click just did nothing.
    const rawOthers = renderedItems.map((m) => ({ x: m.x, y: m.y, width: m.width, length: m.length, rotated: m.rotated, outline: m.outline }))
    const target = { ...clamped, width: stampDims.w, length: stampDims.l, rotated: stampRotated, outline: activeStamp.outline }
    if (collidesPrecisely(target, rawOthers, gap)) {
      return // ignore overlapping placement
    }
    if (usableOutline && !rectInsidePolygon(target, usableOutline)) {
      toast.warning('Здесь груз выходит за пределы палубы')
      return
    }
    // withClearanceFootprint returns the placement UNCHANGED (outline
    // intact) when it has no clearance margin, and a plain inflated
    // rectangle (outline dropped) when it does — so collidesPrecisely here
    // naturally does shape-accurate comparison in the common no-margin case
    // and falls back to bbox-only for an actual clearance zone (which is
    // inherently a padded rectangle, not a shape-precision concept). Plain
    // collidesWith here would treat every custom-shaped neighbour's full
    // bounding box as solid even with zero margin, falsely blocking clicks
    // into its notch right after the precise pass above just allowed it.
    const clearanceOthers = renderedItems.map((m) => withClearanceFootprint(m))
    if (collidesPrecisely(target, clearanceOthers, gap)) {
      toast.warning('Здесь нельзя разместить — зона отступа другого груза')
      return
    }
    // A lashing point's anchor needs rigging access — cargo can't be
    // dropped directly on top of one.
    if (lashingPoints && lashingPoints.length > 0) {
      const lashingExclusions = lashingPointExclusionRects(lashingPoints, gap)
      if (collidesPrecisely(target, lashingExclusions, gap)) {
        toast.warning('Здесь нельзя разместить — рядом точка крепления')
        return
      }
    }
    const category = categoryByItemId?.get(activeStamp.id)
    if (category && separationRules && separationRules.length > 0) {
      const othersWithCategory = renderedItems.map((m) => ({
        x: m.x,
        y: m.y,
        width: m.width,
        length: m.length,
        category: categoryByItemId?.get(m.itemId),
      }))
      if (
        violatesSeparation(
          { ...clamped, width: stampDims.w, length: stampDims.l, category },
          othersWithCategory,
          separationRules
        )
      ) {
        toast.warning(`Груз «${activeStamp.name}» нельзя разместить здесь — нарушена сепарация груза`)
        return
      }
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
    // Clear preview after placement
    setHoverPos(null)
  }

  const handleManualPointerDown = (
    e: React.PointerEvent,
    mp: ManualPlacement
  ) => {
    if (mode !== 'manual') return
    e.stopPropagation()
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    if (additive) {
      onToggleManualSelection?.(mp.id, true)
      return
    }
    // Single selection via store
    onToggleManualSelection?.(mp.id, false)
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

  // Finds another placement of the SAME item substantially overlapped by the
  // dragged rect's raw (pre-collision-resolution) target position — used to
  // arm a drag-to-stack merge instead of the usual collision-avoided move.
  const findMergeTarget = <T extends { id: string; itemId: string; x: number; y: number; width: number; length: number }>(
    draggedItemId: string,
    draggedId: string,
    x: number,
    y: number,
    width: number,
    length: number,
    placements: T[]
  ): string | null => {
    const draggedArea = width * length
    if (draggedArea <= 0) return null
    let best: { id: string; overlap: number } | null = null
    for (const p of placements) {
      if (p.id === draggedId || p.itemId !== draggedItemId) continue
      const ox = Math.max(0, Math.min(x + width, p.x + p.width) - Math.max(x, p.x))
      const oy = Math.max(0, Math.min(y + length, p.y + p.length) - Math.max(y, p.y))
      const overlapArea = ox * oy
      if (overlapArea <= 0) continue
      const frac = overlapArea / draggedArea
      if (frac > 0.35 && (!best || overlapArea > best.overlap)) {
        best = { id: p.id, overlap: overlapArea }
      }
    }
    return best?.id ?? null
  }

  // Tetris-style snap/lock drag resolution: snaps to the grid and magnetically
  // locks flush against neighbours/margins when close enough, falling back to
  // gap-aware vector-sliding when nothing is nearby to lock onto.
  const resolveDragPosition = (
    targetX: number,
    targetY: number,
    width: number,
    length: number,
    currentX: number,
    currentY: number,
    others: { x: number; y: number; width: number; length: number }[]
  ): { x: number; y: number } =>
    resolveSnappedDragPosition(
      targetX,
      targetY,
      width,
      length,
      currentX,
      currentY,
      others,
      deckWidth,
      deckLength,
      edgePad,
      gap,
      gridStep
    )

  const handlePointerMove = (e: React.PointerEvent) => {
    if (panDrag) {
      const svg = svgRef.current
      const rect = svg?.getBoundingClientRect()
      if (rect && rect.width > 0) {
        // Screen-px delta -> viewBox-unit delta, using the current render scale.
        const unitsPerPx = viewBoxW / rect.width
        const dx = (e.clientX - panDrag.startMouse.x) * unitsPerPx
        const dy = (e.clientY - panDrag.startMouse.y) * unitsPerPx
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) panMovedRef.current = true
        setPan(clampPan({ x: panDrag.startPan.x - dx, y: panDrag.startPan.y - dy }, viewBoxW, viewBoxH))
      }
      return
    }
    if (placingLashingPoint) {
      const pos = screenToDeck(e.clientX, e.clientY)
      setLashingHoverPos(pos)
    }
    if (drawingCustomShape) {
      const pos = screenToDeck(e.clientX, e.clientY)
      setDrawHoverPos(pos)
    }
    if (draggingVertexIndex !== null) {
      const pos = screenToDeck(e.clientX, e.clientY)
      if (pos) {
        const x = Math.max(0, Math.min(deckWidth, pos.x))
        const y = Math.max(0, Math.min(deckLength, pos.y))
        setEditingOutline((pts) => pts.map((p, i) => (i === draggingVertexIndex ? { x, y } : p)))
      }
    }
    if (activeStamp && !dragState && !pinDrag) {
      const pos = screenToDeck(e.clientX, e.clientY)
      if (pos) {
        // Only show preview if cursor is inside the deck usable area
        const off = edgePad
        const inside =
          pos.x >= off &&
          pos.y >= off &&
          pos.x <= deckWidth - off &&
          pos.y <= deckLength - off
        if (inside) {
          setHoverPos(pos)
        } else {
          setHoverPos(null)
        }
      }
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
        const target = onMergeManual
          ? findMergeTarget(mp.itemId, mp.id, nx, ny, mp.width, mp.length, manualPlacements)
          : null
        setMergeTargetId(target)
        if (!target) {
          // Source "others" from renderedItems (not raw manualPlacements) so
          // outline data is available for the precise post-check below —
          // ManualPlacement itself never carries outline, only PlacedItem
          // (resolved fresh from the source CargoItem) does.
          const draggedRendered = renderedItems.find((m) => m.manualId === dragState.id)
          const lashingExclusions = lashingPoints?.length ? lashingPointExclusionRects(lashingPoints, gap) : []
          const preciseOthers: { x: number; y: number; width: number; length: number; rotated?: boolean; outline?: { x: number; y: number }[]; clearanceMargin?: ClearanceMargin }[] = [
            ...renderedItems.filter((m) => m.manualId !== dragState.id),
            ...lashingExclusions,
          ]
          const others = preciseOthers.map((m) => withClearanceFootprint(m))
          const resolved = resolveDragPosition(
            nx, ny, mp.width, mp.length, mp.x, mp.y, others
          )
          const resolvedTarget = { x: resolved.x, y: resolved.y, width: mp.width, length: mp.length, rotated: mp.rotated, outline: draggedRendered?.outline }
          const insideDeck = !usableOutline || rectInsidePolygon(resolvedTarget, usableOutline)
          if (insideDeck && !collidesPrecisely(resolvedTarget, preciseOthers, gap)) {
            scheduleDragCommit(dragState.id, resolved.x, resolved.y, 'manual')
          }
        }
      }
    }
    if (zoneDrag && onUpdateLoadZone) {
      const pos = screenToDeck(e.clientX, e.clientY)
      if (!pos) return
      const minSize = 0.3
      if (zoneDrag.kind === 'move') {
        const startDeck = screenToDeck(zoneDrag.startMouse.x, zoneDrag.startMouse.y)
        if (!startDeck) return
        const deltaX = pos.x - startDeck.x
        const deltaY = pos.y - startDeck.y
        const nx = Math.max(0, Math.min(deckWidth - zoneDrag.startRect.width, zoneDrag.startRect.x + deltaX))
        const ny = Math.max(0, Math.min(deckLength - zoneDrag.startRect.length, zoneDrag.startRect.y + deltaY))
        onUpdateLoadZone(zoneDrag.id, { x: nx, y: ny })
      } else if (zoneDrag.corner) {
        const r = zoneDrag.startRect
        const clampedX = Math.max(0, Math.min(deckWidth, pos.x))
        const clampedY = Math.max(0, Math.min(deckLength, pos.y))
        let opp: { x: number; y: number }
        switch (zoneDrag.corner) {
          case 'nw': opp = { x: r.x + r.width, y: r.y + r.length }; break
          case 'ne': opp = { x: r.x, y: r.y + r.length }; break
          case 'sw': opp = { x: r.x + r.width, y: r.y }; break
          case 'se': opp = { x: r.x, y: r.y }; break
        }
        const newX = Math.min(clampedX, opp.x - minSize)
        const newY = Math.min(clampedY, opp.y - minSize)
        const patch =
          zoneDrag.corner === 'nw'
            ? { x: Math.max(0, newX), y: Math.max(0, newY), width: opp.x - Math.max(0, newX), length: opp.y - Math.max(0, newY) }
            : zoneDrag.corner === 'ne'
              ? { x: opp.x, y: Math.max(0, newY), width: Math.max(minSize, clampedX - opp.x), length: opp.y - Math.max(0, newY) }
              : zoneDrag.corner === 'sw'
                ? { x: Math.max(0, newX), y: opp.y, width: opp.x - Math.max(0, newX), length: Math.max(minSize, clampedY - opp.y) }
                : { x: opp.x, y: opp.y, width: Math.max(minSize, clampedX - opp.x), length: Math.max(minSize, clampedY - opp.y) }
        onUpdateLoadZone(zoneDrag.id, patch)
      }
    }
    if (clearanceDrag) {
      const pos = screenToDeck(e.clientX, e.clientY)
      if (!pos) return
      const startDeck = screenToDeck(clearanceDrag.startMouse.x, clearanceDrag.startMouse.y)
      if (!startDeck) return
      const deltaX = pos.x - startDeck.x
      const deltaY = pos.y - startDeck.y
      const m = clearanceDrag.startMargin
      const next: ClearanceMargin = { ...m }
      if (clearanceDrag.corner === 'nw' || clearanceDrag.corner === 'ne') next.top = Math.max(0, m.top - deltaY)
      else next.bottom = Math.max(0, m.bottom + deltaY)
      if (clearanceDrag.corner === 'nw' || clearanceDrag.corner === 'sw') next.left = Math.max(0, m.left - deltaX)
      else next.right = Math.max(0, m.right + deltaX)
      if (clearanceDrag.kind === 'manual') onUpdateManualClearance?.(clearanceDrag.id, next)
      else onUpdatePinnedClearance?.(clearanceDrag.id, next)
    }
    if (lashingAnchorDrag && onUpdateLashingPoint) {
      const pos = screenToDeck(e.clientX, e.clientY)
      if (!pos) return
      const startDeck = screenToDeck(lashingAnchorDrag.startMouse.x, lashingAnchorDrag.startMouse.y)
      if (!startDeck) return
      const deltaX = pos.x - startDeck.x
      const deltaY = pos.y - startDeck.y
      const nx = Math.max(0, Math.min(deckWidth, lashingAnchorDrag.startPos.x + deltaX))
      const ny = Math.max(0, Math.min(deckLength, lashingAnchorDrag.startPos.y + deltaY))
      onUpdateLashingPoint(lashingAnchorDrag.id, { x: nx, y: ny })
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
      const target = onMergePinned
        ? findMergeTarget(pin.itemId, pin.id, nx, ny, pin.width, pin.length, pinnedPlacements)
        : null
      setMergeTargetId(target)
      if (!target) {
        // Prevent overlap with OTHER pinned items (auto-packed items reflow).
        // Sourced from renderedItems (not raw pinnedPlacements) so outline
        // data is available — same reasoning as the manual-drag branch above.
        const draggedRendered = renderedItems.find(
          (p2) => p2.itemId === pin.itemId && Math.abs(p2.x - pin.x) < 0.01 && Math.abs(p2.y - pin.y) < 0.01
        )
        const lashingExclusions = lashingPoints?.length ? lashingPointExclusionRects(lashingPoints, gap) : []
        const preciseOthers: { x: number; y: number; width: number; length: number; rotated?: boolean; outline?: { x: number; y: number }[]; clearanceMargin?: ClearanceMargin }[] = [
          ...renderedItems.filter((p2) => p2 !== draggedRendered),
          ...lashingExclusions,
        ]
        const others = preciseOthers.map((p2) => withClearanceFootprint(p2))
        const resolved = resolveDragPosition(
          nx, ny, pin.width, pin.length, pin.x, pin.y, others
        )
        const resolvedTarget = { x: resolved.x, y: resolved.y, width: pin.width, length: pin.length, rotated: pin.rotated, outline: draggedRendered?.outline }
        const insideDeck = !usableOutline || rectInsidePolygon(resolvedTarget, usableOutline)
        if (insideDeck && !collidesPrecisely(resolvedTarget, preciseOthers, gap)) {
          scheduleDragCommit(pinDrag.id, resolved.x, resolved.y, 'pin')
        }
      }
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    // A merge target was armed while dragging — merge instead of the usual
    // position commit (skip flushPendingDrag: no move was scheduled for this
    // drag while a merge target was active, see handlePointerMove).
    if (mergeTargetId) {
      if (dragState && onMergeManual) onMergeManual(dragState.id, mergeTargetId)
      else if (pinDrag && onMergePinned) onMergePinned(pinDrag.id, mergeTargetId)
      pendingDrag.current = null
      setMergeTargetId(null)
      setDragState(null)
      setPinDrag(null)
      setZoneDrag(null)
      setClearanceDrag(null)
      setPanDrag(null)
      return
    }
    // Always flush any pending drag position before releasing the pointer
    flushPendingDrag()
    // Click on empty deck area clears selection (pins in auto mode, load zones always) —
    // but not while a stamp is armed: that click is about placing a NEW item
    // elsewhere, not about dismissing the current selection, and clearing it
    // first (pointerup fires before the click that actually places the item)
    // made the sidebar's lashing panel lose track of whichever placement the
    // user had just been configuring, even when the new item landed cleanly.
    if (!pinDrag && !dragState && !zoneDrag && !clearanceDrag && !panDrag && !activeStamp) {
      const target = e.target as Element
      // Only clear if clicked directly on the deck background (marked via a
      // data attribute) or the SVG root itself — not coupled to fill colors,
      // which can change with theming.
      if (target === svgRef.current || target.hasAttribute('data-deck-background')) {
        if (isInteractiveAuto) onClearSelection?.()
        setSelectedZoneId(null)
      }
    }
    setDragState(null)
    setPinDrag(null)
    setZoneDrag(null)
    setClearanceDrag(null)
    setPanDrag(null)
    setLashingAnchorDrag(null)
    setDraggingVertexIndex(null)
  }

  // A cancelled gesture (browser gesture, tab switch, context menu) never fires
  // pointerup, so without this the drag state machine could get stuck and a
  // pending throttled commit could fire later on stale data.
  const handlePointerCancel = (e: React.PointerEvent) => {
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    pendingDrag.current = null
    if (dragTimeout.current) {
      clearTimeout(dragTimeout.current)
      dragTimeout.current = null
    }
    setDragState(null)
    setPinDrag(null)
    setZoneDrag(null)
    setClearanceDrag(null)
    setPanDrag(null)
    setMergeTargetId(null)
    setLashingAnchorDrag(null)
    setDraggingVertexIndex(null)
  }

  const handleManualLeave = () => {
    setHoverPos(null)
  }

  const handleZonePointerDown = (e: React.PointerEvent, zone: LoadZone) => {
    if (!onUpdateLoadZone) return
    e.stopPropagation()
    setSelectedZoneId(zone.id)
    setZoneDrag({
      id: zone.id,
      kind: 'move',
      startMouse: { x: e.clientX, y: e.clientY },
      startRect: { x: zone.x, y: zone.y, width: zone.width, length: zone.length },
    })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const handleZoneCornerPointerDown = (
    e: React.PointerEvent,
    zone: LoadZone,
    corner: 'nw' | 'ne' | 'sw' | 'se'
  ) => {
    if (!onUpdateLoadZone) return
    e.stopPropagation()
    setSelectedZoneId(zone.id)
    setZoneDrag({
      id: zone.id,
      kind: 'resize',
      corner,
      startMouse: { x: e.clientX, y: e.clientY },
      startRect: { x: zone.x, y: zone.y, width: zone.width, length: zone.length },
    })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const handleClearanceCornerPointerDown = (
    e: React.PointerEvent,
    kind: 'manual' | 'pin',
    id: string,
    margin: ClearanceMargin,
    corner: 'nw' | 'ne' | 'sw' | 'se'
  ) => {
    e.stopPropagation()
    setClearanceDrag({
      kind,
      id,
      corner,
      startMouse: { x: e.clientX, y: e.clientY },
      startMargin: margin,
    })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const hasContent = result.placed.length > 0 || deckWidth > 0

  // Both modes render from `result.placed` — it's already the correctly
  // computed PlacedItem list (packingResultFromManual for manual mode,
  // packDeck for auto), including fields like `shape` and real `height`
  // that a hand-rebuilt object here previously had to remember to copy one
  // by one and silently could (and did) drop. `manualId` is resolved the
  // same index-matching way Deck3DView already does it (placementIdFor) —
  // packingResultFromManual builds placed[i].index = i from this exact
  // manualPlacements array in the same order, so the two stay aligned.
  const renderedItems: (PlacedItem & { manualId?: string })[] =
    mode === 'manual'
      ? result.placed.map((p) => ({ ...p, manualId: manualPlacements[p.index]?.id }))
      : result.placed

  const backgroundCursor = panDrag
    ? 'grabbing'
    : zoom > 1
      ? 'grab'
      : placingLashingPoint || activeStamp || drawingCustomShape || editingDeckOutline
        ? 'crosshair'
        : 'default'

  return (
    <div className="w-full overflow-x-auto relative" onMouseLeave={handleManualLeave}>
      {/* pointer-events-none on the container + pointer-events-auto on each
          button: this panel floats over the deck's top-right corner, which
          is also where an outline-editor vertex handle can sit — without
          this split the panel's own (non-interactive) padding silently
          swallowed clicks/drags meant for the SVG underneath it. */}
      <div className="absolute right-2 top-2 z-10 flex flex-col gap-1 rounded-lg border bg-card/95 p-1 shadow-sm backdrop-blur-sm pointer-events-none">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 pointer-events-auto"
          title="Увеличить"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => zoomAtCenter(zoom + 0.5)}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 pointer-events-auto"
          title="Уменьшить"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => zoomAtCenter(zoom - 0.5)}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 pointer-events-auto"
          title="Сбросить масштаб"
          disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
          onClick={resetZoom}
        >
          <Maximize className="h-4 w-4" />
        </Button>
        <input
          ref={backgroundFileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleBackgroundFileChange}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant={backgroundImage ? 'secondary' : 'ghost'}
              className="h-7 w-7 pointer-events-auto"
              title="Фоновое фото палубы"
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="left" align="start" className="w-64 p-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Фоновое фото
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs"
              onClick={() => backgroundFileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              {backgroundImage ? 'Заменить фото' : 'Загрузить фото'}
            </Button>
            {backgroundImage && (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Прозрачность</span>
                    <span>{Math.round((backgroundImageOpacity ?? 0.5) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={backgroundImageOpacity ?? 0.5}
                    onChange={(e) => onSetBackgroundImageOpacity?.(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full h-8 text-xs text-destructive hover:text-destructive"
                  onClick={() => onSetBackgroundImage?.(null)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Удалить фото
                </Button>
              </>
            )}
          </PopoverContent>
        </Popover>
      </div>
      <svg
        ref={setSvgRef}
        viewBox={`${pan.x} ${pan.y} ${viewBoxW} ${viewBoxH}`}
        className="w-full h-auto"
        style={{ maxHeight: 560, cursor: backgroundCursor, touchAction: 'none' }}
        onClick={mode === 'manual' || placingLashingPoint || activeStamp || drawingCustomShape || editingDeckOutline ? handleDeckClick : undefined}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => { setHoverPos(null); setLashingHoverPos(null) }}
        onContextMenu={handleDeckContextMenu}
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
          {deckOutline && deckOutline.length >= 3 && (
            <clipPath id="deck-outline-clip">
              <polygon points={deckOutline.map((p) => `${toX(p.x)},${toY(p.y)}`).join(' ')} />
            </clipPath>
          )}
        </defs>

        {/* Deck background — clipped to the real (possibly non-rectangular)
            outline when one is set, so the white fill/grid/photo all
            respect the cut shape instead of drawing a full rectangle with
            cargo just silently blocked in the excluded corners. Every rect
            below stays untouched; only the wrapping clip changes. */}
        <g clipPath={deckOutline && deckOutline.length >= 3 ? 'url(#deck-outline-clip)' : undefined}>
          <rect
            data-deck-background="true"
            x={offX}
            y={offY}
            width={w}
            height={h}
            rx={6}
            fill="#ffffff"
            stroke="#1e293b"
            strokeWidth={2}
          />

          {/* Optional real deck photo, aligned to the exact same rect the deck
              background/grid use so it rescales in lockstep with deck-size and
              zoom changes. Drawn AFTER the opaque white background rect (an
              SVG rect fill is fully opaque — an image behind it would just be
              hidden) but before the grid overlay and everything else.
              Stretch-to-fill (not slice) is intentional — the goal is
              aligning a real photo to the deck's real rectangle corner-to-
              corner, and slicing would crop it unpredictably depending on the
              source aspect ratio. pointer-events:none keeps every existing
              pan/drag/click handler working through it. */}
          {backgroundImage && (
            <image
              href={backgroundImage}
              x={offX}
              y={offY}
              width={w}
              height={h}
              opacity={backgroundImageOpacity ?? 0.5}
              preserveAspectRatio="none"
              style={{ pointerEvents: 'none' }}
            />
          )}

          {showGrid && hasContent && (
            <rect data-deck-background="true" x={offX} y={offY} width={w} height={h} rx={6} fill="url(#deck-grid)" />
          )}
        </g>

        {/* The cut edge itself, drawn as a visible stroke so it reads as an
            intentional boundary rather than a clip artifact. */}
        {deckOutline && deckOutline.length >= 3 && (
          <polygon
            points={deckOutline.map((p) => `${toX(p.x)},${toY(p.y)}`).join(' ')}
            fill="none"
            stroke="#1e293b"
            strokeWidth={2}
            className="pointer-events-none"
          />
        )}

        {/* Edge padding border (usable region) — follows the real contour
            (usableOutline) on a non-rectangular deck instead of a plain
            inset rectangle, matching what click/drag/auto-pack actually
            enforce. */}
        {edgePad > 0 &&
          (usableOutline ? (
            <polygon
              points={usableOutline.map((p) => `${toX(p.x)},${toY(p.y)}`).join(' ')}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={0.75}
              strokeDasharray="3 3"
              opacity={0.6}
              className="pointer-events-none"
            />
          ) : (
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
          ))}

        {/* Free space — a SINGLE filled path (outer boundary minus each
            placed item as a hole, fill-rule="evenodd"), not one <rect> per
            freeRects entry. freeRects itself stays rect-based (it's real
            data other logic — findFreeSpotForItem in page.tsx — depends on),
            and on a sloped outline edge it's necessarily many narrow
            adjacent rects (see deckOutlineExclusionRects). Rendering that
            many separately-filled/anti-aliased rects side by side is what
            produced the "thick, coarse" hatching and overlapping labels on
            a hand-drawn shape: adjacent rect edges don't tile the pattern
            seamlessly, so abutting rects visibly double up. A single path
            has no seams and needs only one label, exactly like the plain
            rectangle case always has. */}
        {showFreeSpace && (() => {
          const halfGap = gap / 2
          const outerPts =
            deckOutline && deckOutline.length >= 3
              ? erodePolygon(deckOutline, Math.max(0, edgePad - halfGap))
              : (() => {
                  const ux = Math.max(0, edgePad - halfGap)
                  const uy = Math.max(0, edgePad - halfGap)
                  const uw = Math.max(0, deckWidth - edgePad * 2 + gap)
                  const ul = Math.max(0, deckLength - edgePad * 2 + gap)
                  return [
                    { x: ux, y: uy },
                    { x: ux + uw, y: uy },
                    { x: ux + uw, y: uy + ul },
                    { x: ux, y: uy + ul },
                  ]
                })()
          if (outerPts.length < 3) return null

          const holes = renderedItems
            .map((p) => ({
              x: p.x - halfGap,
              y: p.y - halfGap,
              width: p.width + gap,
              length: p.length + gap,
            }))
            .filter((r) => r.width > 0 && r.length > 0)

          const outerPath = `M ${outerPts.map((p) => `${toX(p.x)},${toY(p.y)}`).join(' L ')} Z`
          const holePath = holes
            .map((r) => {
              const x0 = toX(r.x)
              const y0 = toY(r.y)
              const x1 = toX(r.x + r.width)
              const y1 = toY(r.y + r.length)
              return `M ${x0},${y0} L ${x1},${y0} L ${x1},${y1} L ${x0},${y1} Z`
            })
            .join(' ')

          // Reuse the already-computed freeRects purely to pick where (and
          // whether) to show one dimension label, matching the single clean
          // "WxH" label the plain-rectangle case has always shown.
          const largest = [...freeRects].sort((a, b) => b.width * b.height - a.width * a.height)[0]
          const lw = largest ? largest.width * scale : 0
          const lh = largest ? largest.height * scale : 0
          const showLabel = largest && lw > 40 && lh > 24

          return (
            <g clipPath={deckOutline && deckOutline.length >= 3 ? 'url(#deck-outline-clip)' : undefined}>
              <path d={`${outerPath} ${holePath}`} fillRule="evenodd" fill="url(#free-hatch)" />
              {showLabel && (
                <text
                  x={toX(largest.x) + lw / 2}
                  y={toY(largest.y) + lh / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="select-none pointer-events-none"
                  fontSize={11}
                  fill="rgba(5,150,105,0.9)"
                >
                  {fmt(largest.width)}×{fmt(largest.height)}
                </text>
              )}
            </g>
          )
        })()}

        {/* Load zones (deck load capacity per m²) */}
        {loadZones?.map((z) => {
          const zw = z.width * scale
          const zh = z.length * scale
          const zx = toX(z.x)
          const zy = toY(z.y)
          const isSelected = selectedZoneId === z.id
          const interactive = !!onUpdateLoadZone
          const corners: { key: 'nw' | 'ne' | 'sw' | 'se'; cx: number; cy: number }[] = [
            { key: 'nw', cx: zx, cy: zy },
            { key: 'ne', cx: zx + zw, cy: zy },
            { key: 'sw', cx: zx, cy: zy + zh },
            { key: 'se', cx: zx + zw, cy: zy + zh },
          ]
          return (
            <g key={`zone-${z.id}`}>
              <rect
                x={zx}
                y={zy}
                width={zw}
                height={zh}
                fill="rgba(59,130,246,0.06)"
                stroke={isSelected ? '#2563eb' : 'rgba(59,130,246,0.55)'}
                strokeWidth={isSelected ? 2 : 1}
                strokeDasharray="6 3"
                style={{ cursor: interactive ? 'move' : 'default' }}
                onPointerDown={interactive ? (e) => handleZonePointerDown(e, z) : undefined}
              />
              {zw > 30 && zh > 16 && (
                <text
                  x={zx + 4}
                  y={zy + 13}
                  fontSize={10}
                  fontWeight={600}
                  fill="rgba(37,99,235,0.9)"
                  className="select-none pointer-events-none"
                >
                  {z.maxLoadPerArea} т/м²
                </text>
              )}
              {interactive && isSelected &&
                corners.map((c) => (
                  <circle
                    key={c.key}
                    cx={c.cx}
                    cy={c.cy}
                    r={5}
                    fill="#2563eb"
                    stroke="#fff"
                    strokeWidth={1.2}
                    style={{ cursor: (c.key === 'nw' || c.key === 'se') ? 'nwse-resize' : 'nesw-resize' }}
                    onPointerDown={(e) => handleZoneCornerPointerDown(e, z, c.key)}
                  />
                ))}
            </g>
          )
        })}

        {/* Hard-blocking clearance zones — the alternative to individual
            lashing points (see clearanceMargin on ManualPlacement/
            PinnedPlacement). Red, not blue like LoadZone, since this is an
            actual placement-blocking boundary rather than an informational
            load-density warning. Per-side margin, so the rect isn't
            necessarily centered on the cargo. Corner drag-handles (same
            visual language as LoadZone's) appear only on the selected
            placement's zone, to avoid cluttering the screen with handles on
            every cargo that has one. */}
        {renderedItems
          .filter((p) => !!p.clearanceMargin)
          .map((p, i) => {
            const margin = p.clearanceMargin!
            const matchingPin = isInteractiveAuto
              ? pinnedPlacements.find(
                  (pin) =>
                    pin.itemId === p.itemId &&
                    Math.abs(pin.x - p.x) < 0.01 &&
                    Math.abs(pin.y - p.y) < 0.01
                )
              : undefined
            const kind: 'manual' | 'pin' = mode === 'manual' ? 'manual' : 'pin'
            const placementId = mode === 'manual' ? p.manualId : matchingPin?.id
            const isSelected =
              mode === 'manual'
                ? selectedManualIds?.includes(p.manualId ?? '') ?? false
                : !!placementId && selectedPinIds.includes(placementId)
            const canDrag = isSelected && !!placementId
            const zx = toX(p.x - margin.left)
            const zy = toY(p.y - margin.top)
            const zw = (p.width + margin.left + margin.right) * scale
            const zh = (p.length + margin.top + margin.bottom) * scale
            const corners: { key: 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number }[] = [
              { key: 'nw', x: zx, y: zy },
              { key: 'ne', x: zx + zw, y: zy },
              { key: 'sw', x: zx, y: zy + zh },
              { key: 'se', x: zx + zw, y: zy + zh },
            ]
            return (
              <g key={`clearance-${p.itemId}-${p.index}-${i}`}>
                <rect
                  x={zx}
                  y={zy}
                  width={zw}
                  height={zh}
                  fill="none"
                  stroke="rgba(220,38,38,0.5)"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  className="pointer-events-none"
                />
                {canDrag &&
                  corners.map((c) => (
                    <rect
                      key={c.key}
                      x={c.x - 4}
                      y={c.y - 4}
                      width={8}
                      height={8}
                      fill="#fff"
                      stroke="rgba(220,38,38,0.9)"
                      strokeWidth={1.5}
                      style={{ cursor: c.key === 'nw' || c.key === 'se' ? 'nwse-resize' : 'nesw-resize' }}
                      onPointerDown={(e) => handleClearanceCornerPointerDown(e, kind, placementId!, margin, c.key)}
                    />
                  ))}
              </g>
            )
          })}

        {/* Lashing-point placement preview (follows cursor while armed) */}
        {placingLashingPoint && lashingHoverPos && (
          <g className="pointer-events-none" opacity={0.55}>
            {pendingLashingCorner && (
              <line
                x1={toX(pendingLashingCorner.cornerX)}
                y1={toY(pendingLashingCorner.cornerY)}
                x2={toX(lashingHoverPos.x)}
                y2={toY(lashingHoverPos.y)}
                stroke="rgba(220,38,38,0.9)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            <circle cx={toX(lashingHoverPos.x)} cy={toY(lashingHoverPos.y)} r={6} fill="rgba(220,38,38,0.9)" stroke="#fff" strokeWidth={1.5} />
            <line x1={toX(lashingHoverPos.x) - 3} y1={toY(lashingHoverPos.y)} x2={toX(lashingHoverPos.x) + 3} y2={toY(lashingHoverPos.y)} stroke="#fff" strokeWidth={1.2} />
            <line x1={toX(lashingHoverPos.x)} y1={toY(lashingHoverPos.y) - 3} x2={toX(lashingHoverPos.x)} y2={toY(lashingHoverPos.y) + 3} stroke="#fff" strokeWidth={1.2} />
          </g>
        )}

        {/* Custom-shape drawing preview: confirmed points + a dashed segment
            to the cursor, with the first vertex highlighted once the loop
            can be closed (>=3 points placed). */}
        {drawingCustomShape && drawingPoints.length > 0 && (
          <g className="pointer-events-none" opacity={0.8}>
            <polyline
              points={drawingPoints.map((p) => `${toX(p.x)},${toY(p.y)}`).join(' ')}
              fill="none"
              stroke="rgba(37,99,235,0.9)"
              strokeWidth={1.5}
            />
            {drawHoverPos && (
              <line
                x1={toX(drawingPoints[drawingPoints.length - 1].x)}
                y1={toY(drawingPoints[drawingPoints.length - 1].y)}
                x2={toX(drawHoverPos.x)}
                y2={toY(drawHoverPos.y)}
                stroke="rgba(37,99,235,0.9)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {drawingPoints.map((p, i) => (
              <circle
                key={i}
                cx={toX(p.x)}
                cy={toY(p.y)}
                r={i === 0 && drawingPoints.length >= 3 ? 7 : 4}
                fill={i === 0 && drawingPoints.length >= 3 ? 'rgba(34,197,94,0.9)' : 'rgba(37,99,235,0.9)'}
                stroke="#fff"
                strokeWidth={1.2}
              />
            ))}
          </g>
        )}

        {/* Deck outline editor: live closed polygon, draggable vertex
            handles, and a small "×" per vertex to remove it (min 3 kept).
            Unlike the open-path custom-shape drawing above, this edits an
            already-closed shape — every vertex is always visible/draggable
            at once, not built up sequentially. */}
        {editingDeckOutline && editingOutline.length > 0 && (
          <g opacity={0.9}>
            <polygon
              points={editingOutline.map((p) => `${toX(p.x)},${toY(p.y)}`).join(' ')}
              fill="rgba(37,99,235,0.08)"
              stroke="rgba(37,99,235,0.9)"
              strokeWidth={1.5}
              className="pointer-events-none"
            />
            {editingOutline.map((p, i) => (
              <g key={i}>
                <circle
                  cx={toX(p.x)}
                  cy={toY(p.y)}
                  r={6}
                  fill="rgba(37,99,235,0.9)"
                  stroke="#fff"
                  strokeWidth={1.5}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => handleOutlineVertexPointerDown(e, i)}
                />
                {editingOutline.length > 3 && (
                  <g
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOutlineVertexRemove(i)
                    }}
                  >
                    <circle cx={toX(p.x) + 10} cy={toY(p.y) - 10} r={7} fill="#ef4444" stroke="#fff" strokeWidth={1.2} />
                    <text x={toX(p.x) + 10} y={toY(p.y) - 9} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={700} fill="#fff">
                      ×
                    </text>
                  </g>
                )}
              </g>
            ))}
          </g>
        )}

        {/* Placed items */}
        {renderedItems.map((p, idx) => {
          const pw = p.width * scale
          const ph = p.length * scale
          const isHover = hoveredItemId === p.itemId
          const isSelected =
            mode === 'manual' &&
            (selectedManual === p.manualId ||
              (selectedManualIds?.includes(p.manualId ?? '') ?? false))
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
          const category = categoryByItemId?.get(p.itemId)
          const totalWeight = (p.weight ?? 0) * p.stackedCount
          const overLoad = loadZones && loadZones.length > 0
            ? checkLoadDensity({ x: p.x, y: p.y, width: p.width, length: p.length }, totalWeight, loadZones)
            : null
          const placementId = mode === 'manual' ? p.manualId : matchingPin?.id
          const isMergeTarget = !!mergeTargetId && placementId === mergeTargetId
          const isBeingDragged =
            (mode === 'manual' && !!dragState && p.manualId === dragState.id) ||
            (isInteractiveAuto && !!pinDrag && matchingPin?.id === pinDrag.id)
          return (
            <PlacedRect
              key={mode === 'manual' ? `m-${p.manualId}` : `p-${idx}`}
              item={p}
              x={toX(p.x)}
              y={toY(p.y)}
              w={pw}
              h={ph}
              scale={scale}
              hovered={isHover || isSelected || isPinnedSelected}
              showLabels={showLabels}
              fmt={fmt}
              onHover={onHover}
              manualMode={mode === 'manual'}
              pinned={!!matchingPin}
              pinnedSelected={isPinnedSelected}
              category={category}
              overLoad={!!overLoad}
              overLoadTitle={overLoad ? `Нагрузка ${(overLoad.densityKgPerM2 / 1000).toFixed(2)} т/м² > лимит ${overLoad.limitTPerM2} т/м²` : undefined}
              mergeTarget={isMergeTarget}
              dimmed={isBeingDragged && !!mergeTargetId}
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

        {/* Persisted lashing points — a plain pin, or (if attached to a
            placement) a line from the cargo corner to the deck anchor plus a
            pass/fail badge from the CSS-Code-style securing check. Rendered
            AFTER placed items so a point/line near or under a cargo box's
            edge (very common — the corner IS a cargo corner) always paints
            on top and stays visible/clickable instead of being hidden
            underneath the cargo's fill. */}
        {lashingPoints?.map((pt) => {
          const px = toX(pt.x)
          const py = toY(pt.y)
          const isAttached = pt.placementId !== undefined && pt.cornerX !== undefined && pt.cornerY !== undefined
          const isSelected = selectedLashingId === pt.id
          // Live length readout while actively dragging this anchor — same
          // Math.hypot(dx,dy) distance checkLashingBalance already computes
          // for its direction unit vectors (packing.ts), just surfaced here
          // as a plain number instead of feeding a force calculation.
          const dragDistance =
            isAttached && lashingAnchorDrag?.id === pt.id
              ? Math.hypot(pt.x - pt.cornerX!, pt.y - pt.cornerY!)
              : null
          const interactive = !!onUpdateLashingPoint
          let check: ReturnType<typeof checkLashingBalance> = null
          if (isAttached) {
            // Match by the actual placement id, not just itemId — two pinned
            // placements can share the same cargo type, and matching on
            // itemId alone would silently grab whichever one happens to come
            // first, checking the wrong cargo's weight/position.
            const placement = renderedItems.find((p) => {
              if (mode === 'manual') return p.manualId === pt.placementId
              const pin = pinnedPlacements.find(
                (pn) => pn.itemId === p.itemId && Math.abs(pn.x - p.x) < 0.01 && Math.abs(pn.y - p.y) < 0.01
              )
              return pin?.id === pt.placementId
            })
            if (placement) {
              const attachedHere = (lashingPoints ?? []).filter((l) => l.placementId === pt.placementId)
              check = checkLashingBalance(placement, attachedHere, vesselMotion ?? DEFAULT_VESSEL_MOTION)
            }
          }
          return (
            <g key={`lash-${pt.id}`}>
              {isAttached && (
                <line
                  x1={toX(pt.cornerX!)}
                  y1={toY(pt.cornerY!)}
                  x2={px}
                  y2={py}
                  stroke={check ? (check.ok ? '#16a34a' : '#dc2626') : 'rgba(15,23,42,0.6)'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                />
              )}
              {dragDistance !== null && (
                <text
                  x={(toX(pt.cornerX!) + px) / 2}
                  y={(toY(pt.cornerY!) + py) / 2 - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="#0f172a"
                  className="select-none pointer-events-none"
                  style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}
                >
                  {fmt(dragDistance)} {UNIT_LABEL[unit]}
                </text>
              )}
              <circle
                cx={px}
                cy={py}
                r={6}
                fill={check ? (check.ok ? '#16a34a' : '#dc2626') : 'rgba(15,23,42,0.85)'}
                stroke="#fff"
                strokeWidth={1.5}
                style={{ cursor: interactive ? 'move' : 'default' }}
                onPointerDown={
                  interactive
                    ? (e) => {
                        e.stopPropagation()
                        setSelectedLashingId(pt.id)
                        setLashingAnchorDrag({ id: pt.id, startMouse: { x: e.clientX, y: e.clientY }, startPos: { x: pt.x, y: pt.y } })
                        ;(e.target as Element).setPointerCapture?.(e.pointerId)
                      }
                    : undefined
                }
              >
                {check && (
                  <title>
                    {`Груз ${check.ok ? 'закреплён' : 'НЕ закреплён'} — поперечно: ${check.transverse.availableKg.toFixed(0)}/${check.transverse.requiredKg.toFixed(0)} кг, продольно: ${check.longitudinal.availableKg.toFixed(0)}/${check.longitudinal.requiredKg.toFixed(0)} кг`}
                  </title>
                )}
              </circle>
              {!isAttached && (
                <>
                  <line x1={px - 3} y1={py} x2={px + 3} y2={py} stroke="#fff" strokeWidth={1.2} />
                  <line x1={px} y1={py - 3} x2={px} y2={py + 3} stroke="#fff" strokeWidth={1.2} />
                </>
              )}
              {pt.label && (
                <text x={px + 8} y={py + 3} fontSize={9} fill="rgba(15,23,42,0.9)" className="select-none pointer-events-none">
                  {pt.label}
                </text>
              )}
            </g>
          )
        })}

        {/* Auto mode: rotate + delete + layer buttons on a selected pinned item (single selection) */}
        {isInteractiveAuto &&
          selectedPinIds.length === 1 &&
          (() => {
            const pin = pinnedPlacements.find((p) => p.id === selectedPinIds[0])
            if (!pin) return null
            const { rcx, rcy, dcx, dcy, lcx, lcy } = controlAnchors(pin.x, pin.y, pin.width, pin.length)
            const layerInfo = getLayerInfo?.(pin.itemId, pin.layers, pin.id)
            const maxPhys = layerInfo?.maxPhys ?? 1
            const canInc = layerInfo?.canIncrease ?? true
            const blockReason = layerInfo?.blockReason
            return (
              <>
                {onRotatePinned && (
                  <g
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRotatePinned(pin.id)
                    }}
                  >
                    <circle cx={rcx} cy={rcy} r={16} fill="transparent" />
                    <circle cx={rcx} cy={rcy} r={9} fill="#7c3aed" stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
                    <text x={rcx} y={rcy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#fff" pointerEvents="none">↻</text>
                  </g>
                )}
                {onLayerChangePinned && (
                  <g
                    style={{ cursor: canInc ? 'pointer' : 'not-allowed' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (canInc) {
                        onLayerChangePinned(pin.id, 1)
                      } else {
                        toast.warning(blockReason ?? `Невозможно добавить ярус`)
                      }
                    }}
                  >
                    <title>{canInc ? `Добавить ярус ровно на этом месте (макс. ${maxPhys}) — чтобы сложить груз с соседним, перетащите один на другой` : (blockReason ?? `Заблокировано`)}</title>
                    <circle cx={lcx} cy={lcy - 13} r={17} fill="transparent" />
                    <circle cx={lcx} cy={lcy - 13} r={11} fill={canInc ? '#0ea5e9' : '#94a3b8'} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
                    <text x={lcx} y={lcy - 12} textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={700} fill="#fff" pointerEvents="none">+</text>
                  </g>
                )}
                {onLayerChangePinned && (
                  <g
                    style={{ cursor: pin.layers > 1 ? 'pointer' : 'not-allowed' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (pin.layers > 1) {
                        onLayerChangePinned(pin.id, -1)
                      } else {
                        toast.info('Минимум 1 ярус. Для удаления используйте ✕')
                      }
                    }}
                  >
                    <title>{pin.layers > 1 ? 'Убрать ярус' : 'Минимум 1 ярус'}</title>
                    <circle cx={lcx} cy={lcy + 13} r={17} fill="transparent" />
                    <circle cx={lcx} cy={lcy + 13} r={11} fill={pin.layers > 1 ? '#f59e0b' : '#94a3b8'} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
                    <text x={lcx} y={lcy + 14} textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={700} fill="#fff" pointerEvents="none">−</text>
                  </g>
                )}
                {onRemovePinned && (
                  <g
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemovePinned(pin.id)
                    }}
                  >
                    <circle cx={dcx} cy={dcy} r={16} fill="transparent" />
                    <circle cx={dcx} cy={dcy} r={9} fill="#ef4444" stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
                    <text x={dcx} y={dcy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#fff" pointerEvents="none">✕</text>
                  </g>
                )}
                {/* Layer count badge */}
                <g className="pointer-events-none">
                  <rect x={rcx + 11} y={rcy - 4} width={36} height={14} rx={3} fill="rgba(15,23,42,0.85)" />
                  <text x={rcx + 29} y={rcy + 6} fontSize={9} fontWeight={700} textAnchor="middle" fill="#fff" className="select-none">
                    {pin.layers} / {maxPhys} яр.
                  </text>
                </g>
              </>
            )
          })()}

        {/* Manual mode: rotate + delete + layer buttons on selected */}
        {mode === 'manual' &&
          selectedManual &&
          (() => {
            const mp = manualPlacements.find((m) => m.id === selectedManual)
            if (!mp) return null
            const { rcx, rcy, dcx, dcy, lcx, lcy } = controlAnchors(mp.x, mp.y, mp.width, mp.length)
            const currentLayers = Math.max(1, mp.layers)
            const layerInfo = getLayerInfo?.(mp.itemId, currentLayers, mp.id)
            const maxPhys = layerInfo?.maxPhys ?? 1
            const canInc = layerInfo?.canIncrease ?? true
            const blockReason = layerInfo?.blockReason
            return (
              <>
                {onRotateManual && (
                  <g
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRotateManual(mp.id)
                    }}
                  >
                    <circle cx={rcx} cy={rcy} r={16} fill="transparent" />
                    <circle cx={rcx} cy={rcy} r={9} fill="#7c3aed" stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
                    <text x={rcx} y={rcy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#fff" pointerEvents="none">↻</text>
                  </g>
                )}
                {onLayerChangeManual && (
                  <g
                    style={{ cursor: canInc ? 'pointer' : 'not-allowed' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (canInc) {
                        onLayerChangeManual(mp.id, 1)
                      } else {
                        toast.warning(blockReason ?? `Невозможно добавить ярус`)
                      }
                    }}
                  >
                    <title>{canInc ? `Добавить ярус ровно на этом месте (макс. ${maxPhys}) — чтобы сложить груз с соседним, перетащите один на другой` : (blockReason ?? `Заблокировано`)}</title>
                    <circle cx={lcx} cy={lcy - 13} r={17} fill="transparent" />
                    <circle cx={lcx} cy={lcy - 13} r={11} fill={canInc ? '#0ea5e9' : '#94a3b8'} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
                    <text x={lcx} y={lcy - 12} textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={700} fill="#fff" pointerEvents="none">+</text>
                  </g>
                )}
                {onLayerChangeManual && (
                  <g
                    style={{ cursor: currentLayers > 1 ? 'pointer' : 'not-allowed' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (currentLayers > 1) {
                        onLayerChangeManual(mp.id, -1)
                      } else {
                        toast.info('Минимум 1 ярус. Для удаления используйте ✕')
                      }
                    }}
                  >
                    <title>{currentLayers > 1 ? 'Убрать ярус' : 'Минимум 1 ярус'}</title>
                    <circle cx={lcx} cy={lcy + 13} r={17} fill="transparent" />
                    <circle cx={lcx} cy={lcy + 13} r={11} fill={currentLayers > 1 ? '#f59e0b' : '#94a3b8'} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
                    <text x={lcx} y={lcy + 14} textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={700} fill="#fff" pointerEvents="none">−</text>
                  </g>
                )}
                {onRemoveManual && (
                  <g
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveManual(mp.id)
                      onClearManualSelection?.()
                    }}
                  >
                    <circle cx={dcx} cy={dcy} r={16} fill="transparent" />
                    <circle cx={dcx} cy={dcy} r={9} fill="#ef4444" stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
                    <text x={dcx} y={dcy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#fff" pointerEvents="none">✕</text>
                  </g>
                )}
                {/* Layer count badge */}
                <g className="pointer-events-none">
                  <rect x={rcx + 11} y={rcy - 4} width={36} height={14} rx={3} fill="rgba(15,23,42,0.85)" />
                  <text x={rcx + 29} y={rcy + 6} fontSize={9} fontWeight={700} textAnchor="middle" fill="#fff" className="select-none">
                    {currentLayers} / {maxPhys} яр.
                  </text>
                </g>
              </>
            )
          })()}

        {/* Preview stamp at cursor (either mode, whenever a stamp is armed) */}
        {activeStamp && stampDims && hoverPos && !dragState && (
          <g pointerEvents="none">
            <FootprintShape
              shape={activeStamp.shape}
              x={toX(clampToDeck({ x: hoverPos.x, y: hoverPos.y, width: stampDims.w, length: stampDims.l }, deckWidth, deckLength, edgePad).x)}
              y={toY(clampToDeck({ x: hoverPos.x, y: hoverPos.y, width: stampDims.w, length: stampDims.l }, deckWidth, deckLength, edgePad).y)}
              w={stampDims.w * scale}
              h={stampDims.l * scale}
              fill={activeStamp.color}
              fillOpacity={0.35}
              stroke={activeStamp.color}
              strokeWidth={1.5}
              strokeDasharray="4 2"
              outline={activeStamp.outline}
              rotated={stampRotated}
              scale={scale}
            />
          </g>
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
      </svg>
      <PhotoCropDialog
        open={!!cropBitmap}
        bitmap={cropBitmap}
        aspectRatio={deckWidth / deckLength}
        onConfirm={handleCropConfirm}
        onCancel={handleCropCancel}
      />
      {contextMenu && (
        <div
          className="fixed z-50 w-48 rounded-lg border bg-card p-1 shadow-md"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 200),
            top: Math.min(contextMenu.y, window.innerHeight - 100),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              onSetEditingDeckOutline?.(true)
              setContextMenu(null)
            }}
          >
            Редактировать
          </button>
          <button
            type="button"
            className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              backgroundFileInputRef.current?.click()
              setContextMenu(null)
            }}
          >
            Загрузить фото
          </button>
        </div>
      )}
      {editingDeckOutline && (
        <div className="absolute left-2 bottom-2 z-10 flex gap-1.5 rounded-lg border bg-card/95 p-1.5 shadow-sm backdrop-blur-sm">
          <span className="self-center px-1.5 text-xs text-muted-foreground">
            Тяните точки, кликните на край — добавить точку
          </span>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={handleOutlineCancel}>
            Отмена
          </Button>
          <Button type="button" size="sm" className="h-7 text-xs" onClick={handleOutlineConfirm}>
            Сохранить
          </Button>
        </div>
      )}
    </div>
  )
})

// Draws a footprint as its actual shape instead of always a rectangle — a
// box/cylinder/undefined shape still gets the plain rounded rect (a real
// cylinder's roundness only shows in 3D; the 2D plan view can't show a
// side-on pipe's cross-section anyway, see the stacked-layers circle glyph
// below instead), but 'circle'/'oval'/'triangle'/'diamond' cargo (added for
// odd-shaped real cargo, not just cylinders) draws its true outline so it
// reads as its own shape from the top too, not just a labelled square.
function FootprintShape({
  shape,
  x,
  y,
  w,
  h,
  fill,
  fillOpacity,
  stroke,
  strokeWidth,
  strokeDasharray,
  outline,
  rotated,
  scale,
}: {
  shape?: PlacedItem['shape']
  x: number
  y: number
  w: number
  h: number
  fill: string
  fillOpacity: number
  stroke: string
  strokeWidth: number
  strokeDasharray?: string
  // Custom hand-drawn shapes: `outline` is the local, UNROTATED silhouette
  // (spans [0,origWidth]x[0,origLength]); `w`/`h` here are always the
  // POST-rotation bbox in screen px, so the original box is recovered by
  // swapping when `rotated` — same logic worldPolygon uses, kept in sync by
  // sharing rotateOutline90 rather than re-deriving it.
  outline?: { x: number; y: number }[]
  rotated?: boolean
  scale?: number
}) {
  const common = { fill, fillOpacity, stroke, strokeWidth, strokeDasharray }
  if (shape === 'custom' && outline && outline.length >= 3 && scale) {
    const origWidth = rotated ? h / scale : w / scale
    const origLength = rotated ? w / scale : h / scale
    const local = rotated ? rotateOutline90(outline, origWidth, origLength) : outline
    const points = local.map((p) => `${x + p.x * scale},${y + p.y * scale}`).join(' ')
    return <polygon points={points} strokeLinejoin="round" {...common} />
  }
  if (shape === 'circle' || shape === 'oval') {
    return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />
  }
  if (shape === 'triangle') {
    const points = `${x + w / 2},${y} ${x},${y + h} ${x + w},${y + h}`
    return <polygon points={points} strokeLinejoin="round" {...common} />
  }
  if (shape === 'diamond') {
    const points = `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`
    return <polygon points={points} strokeLinejoin="round" {...common} />
  }
  return <rect x={x} y={y} width={w} height={h} rx={2} {...common} />
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
  category,
  overLoad,
  overLoadTitle,
  mergeTarget,
  dimmed,
  scale,
}: {
  item: PlacedItem
  x: number
  y: number
  w: number
  h: number
  scale: number
  hovered: boolean
  showLabels: boolean
  fmt: (v: number) => string
  onHover: (id: string | null) => void
  manualMode: boolean
  onPointerDown?: (e: React.PointerEvent) => void
  pinned?: boolean
  pinnedSelected?: boolean
  category?: string
  overLoad?: boolean
  overLoadTitle?: string
  // Drag-to-stack: this placement is the potential landing spot for the item
  // currently being dragged (mergeTarget), or is itself being dragged toward
  // one (dimmed) — see findMergeTarget/handlePointerMove.
  mergeTarget?: boolean
  dimmed?: boolean
}) {
  const strokeColor = mergeTarget
    ? '#16a34a'
    : overLoad
      ? '#dc2626'
      : pinnedSelected
        ? '#7c3aed'
        : pinned
          ? '#0f172a'
          : hovered
            ? '#94a3b8'
            : 'rgba(15,23,42,0.55)'
  const strokeWidth = mergeTarget ? 4 : overLoad ? 3 : pinnedSelected ? 3 : pinned || hovered ? 2 : 1
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
      style={{ cursor, opacity: dimmed ? 0.4 : 1, transition: 'opacity 0.15s' }}
    >
      {/* Stacked-layers cue: faint offset "ghost" outlines behind the main
          box, so a multi-layer footprint visually reads as a physical pile
          rather than just the small "×N" badge. Round cargo (pipes/barrels)
          gets its own schematic "bundle of circles" glyph instead — see
          below — since a rectangular ghost-outline reads wrong for round
          stock, and a thin pipe's real w/h is often sub-pixel anyway. */}
      {item.layers > 1 && item.shape !== 'cylinder' && w >= 16 && h >= 16 && (
        <g className="pointer-events-none" opacity={0.5}>
          <rect x={x - 3} y={y - 3} width={w} height={h} rx={2} fill="none" stroke={item.color} strokeWidth={1.5} />
          {item.layers > 2 && (
            <rect x={x - 6} y={y - 6} width={w} height={h} rx={2} fill="none" stroke={item.color} strokeWidth={1.5} />
          )}
        </g>
      )}
      <FootprintShape
        shape={item.shape}
        x={x}
        y={y}
        w={w}
        h={h}
        fill={item.color}
        fillOpacity={hovered ? 0.95 : 0.78}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={mergeTarget ? '6 3' : pinned ? '4 2' : undefined}
        outline={item.outline}
        rotated={item.rotated}
        scale={scale}
      />
      {overLoadTitle && <title>{overLoadTitle}</title>}
      {overLoad && w >= 14 && h >= 14 && (
        <g className="pointer-events-none">
          <circle cx={x + 8} cy={y + 8} r={7} fill="#dc2626" stroke="#fff" strokeWidth={1.2} />
          <text x={x + 8} y={y + 11} fontSize={10} fontWeight={800} textAnchor="middle" fill="#fff" className="select-none">!</text>
        </g>
      )}
      {mergeTarget && (
        <g className="pointer-events-none">
          <rect x={x + w / 2 - 14} y={y + h / 2 - 12} width={28} height={24} rx={4} fill="rgba(22,163,74,0.95)" stroke="#fff" strokeWidth={1.5} />
          <text x={x + w / 2} y={y + h / 2 + 5} textAnchor="middle" fontSize={16} fontWeight={800} fill="#fff" className="select-none">+</text>
        </g>
      )}
      {category && showLabels && w > 30 && h > 30 && (
        <g className="pointer-events-none">
          <text x={x + 4} y={y + h - 5} fontSize={8} fill="rgba(255,255,255,0.85)" className="select-none">
            {category}
          </text>
        </g>
      )}
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
      {item.layers > 1 && item.shape === 'cylinder' && (() => {
        // Schematic "bundle of pipes" glyph — a row of small circles (one
        // per unit, up to however many fit) instead of a numeric badge, so
        // "several round items are stacked here" reads at a glance even
        // when the item itself renders far too thin on screen to show its
        // real cross-section (a 0.15m pipe is sub-pixel at deck scale).
        // Anchored to a minimum on-screen span so it doesn't collapse for
        // hairline-thin footprints, same reasoning as controlAnchors above.
        const dia = 7
        const gap = 2
        const glyphW = Math.max(w, 30)
        const cx = x + w / 2
        const cy = y + h / 2
        const maxFit = Math.max(1, Math.floor((glyphW + gap) / (dia + gap)))
        const overflow = item.layers > maxFit
        const circleCount = overflow ? maxFit - 1 : item.layers
        const startX = cx - ((circleCount + (overflow ? 1 : 0)) * (dia + gap) - gap) / 2 + dia / 2
        return (
          <g className="pointer-events-none">
            <rect x={startX - dia / 2 - 2} y={cy - dia / 2 - 2} width={(circleCount + (overflow ? 1 : 0)) * (dia + gap) - gap + 4} height={dia + 4} rx={3} fill="rgba(0,0,0,0.45)" />
            {Array.from({ length: circleCount }).map((_, i) => (
              <circle key={i} cx={startX + i * (dia + gap)} cy={cy} r={dia / 2} fill={item.color} stroke="#fff" strokeWidth={1} />
            ))}
            {overflow && (
              <text x={startX + circleCount * (dia + gap)} y={cy + 3} fontSize={8} fontWeight={700} textAnchor="middle" fill="#fff" className="select-none">
                +{item.layers - circleCount}
              </text>
            )}
          </g>
        )
      })()}
      {item.layers > 1 && item.shape !== 'cylinder' && w >= 16 && h >= 16 && (
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
