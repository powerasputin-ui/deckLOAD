'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { clampCrop, computeCalibratedZoom, cropAndCompressToDataUrl, type CropState } from '@/lib/imageCrop'
import { UNIT_LABEL, type Unit } from '@/store/calculator'

interface PhotoCropDialogProps {
  open: boolean
  bitmap: ImageBitmap | null
  // width/length ratio of the deck at the moment the dialog opened — fixed
  // for the lifetime of this dialog instance so it can't drift if the deck
  // is resized elsewhere while the crop UI is open.
  aspectRatio: number
  // Real deck width/length (deck.unit) — used only by scale calibration
  // (computeCalibratedZoom needs an actual real-world size, not just the
  // unit-agnostic aspect ratio above).
  deckWidth: number
  deckLength: number
  unit: Unit
  onConfirm: (dataUrl: string) => void
  onCancel: () => void
}

// Fixed on-screen viewport size for the crop frame, capped so it comfortably
// fits the dialog regardless of the deck's aspect ratio (a near-square deck
// and a very elongated one both need a sane frame size). Must stay under the
// dialog's own inner content width — DialogContent is `sm:max-w-md` (28rem =
// 448px) with `p-6` (24px) padding on each side, leaving ~400px; 480 (the
// previous value) overflowed past the dialog's right edge.
const MAX_VIEWPORT_W = 380
const MAX_VIEWPORT_H = 280

type InteractionMode = 'pan' | 'calibrate'

// Small numeric text input for the calibration distance — mirrors this
// codebase's established small-numeric-field convention (MiniNumField in
// Sidebar.tsx, NumField in ItemList.tsx: each file keeps its own local
// copy rather than sharing one), simplified since there's no external
// "value" to reconcile against — just a fresh text buffer per calibration.
function CalDistanceInput({
  value,
  unit,
  onChange,
}: {
  value: string
  unit: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-[9px] text-muted-foreground leading-none block">
        Реальное расстояние{unit ? ` (${unit})` : ''}
      </label>
      <Input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 text-[11px] px-1"
        placeholder="напр. 5.2"
      />
    </div>
  )
}

export function PhotoCropDialog({
  open,
  bitmap,
  aspectRatio,
  deckWidth,
  unit,
  onConfirm,
  onCancel,
}: PhotoCropDialogProps) {
  const viewport = useMemo(() => {
    let w = MAX_VIEWPORT_W
    let h = w / aspectRatio
    if (h > MAX_VIEWPORT_H) {
      h = MAX_VIEWPORT_H
      w = h * aspectRatio
    }
    return { w, h }
  }, [aspectRatio])

  const [crop, setCrop] = useState<CropState>({ offsetX: 0, offsetY: 0, zoom: 1 })
  const dragRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null)

  // Re-center/fit whenever a new bitmap is loaded (dialog re-opened with a
  // different photo) — render-time "compare previous prop" adjustment,
  // matching this app's established pattern instead of a useEffect.
  const [prevBitmap, setPrevBitmap] = useState(bitmap)
  if (bitmap !== prevBitmap) {
    setPrevBitmap(bitmap)
    if (bitmap) {
      const fitted = clampCrop({ offsetX: 0, offsetY: 0, zoom: 0 }, bitmap.width, bitmap.height, viewport.w, viewport.h)
      // Center the fitted image in the viewport rather than pinning it to
      // the top-left corner.
      const scaledW = bitmap.width * fitted.zoom
      const scaledH = bitmap.height * fitted.zoom
      setCrop({ zoom: fitted.zoom, offsetX: (viewport.w - scaledW) / 2, offsetY: (viewport.h - scaledH) / 2 })
    }
  }

  // Two-point scale calibration: click two points on the photo whose real
  // distance you know, type that distance, and the dialog computes the
  // zoom that makes the deck's real width span the viewport exactly —
  // instead of eyeballing the "Масштаб" slider. Purely optional/additive;
  // panning/zooming manually keeps working exactly as before.
  const [mode, setMode] = useState<InteractionMode>('pan')
  const [calPoints, setCalPoints] = useState<{ x: number; y: number }[]>([])
  const [calZoomAtClick, setCalZoomAtClick] = useState<number | null>(null)
  const [calDistanceText, setCalDistanceText] = useState('')
  // The manual slider's ceiling (minZoom * 6) is a heuristic for eyeballing
  // by hand — a calibration result is a deliberate, math-derived target the
  // user explicitly asked for, so it must never be silently clamped to that
  // ceiling. Raised on-demand only when a calibration actually needs it.
  const [calibratedMaxZoom, setCalibratedMaxZoom] = useState<number | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bitmap) return
    canvas.width = viewport.w
    canvas.height = viewport.h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, viewport.w, viewport.h)
    ctx.drawImage(bitmap, crop.offsetX, crop.offsetY, bitmap.width * crop.zoom, bitmap.height * crop.zoom)

    if (mode === 'calibrate' && calPoints.length > 0) {
      ctx.save()
      ctx.strokeStyle = '#ef4444'
      ctx.fillStyle = '#ef4444'
      ctx.lineWidth = 2
      if (calPoints.length === 2) {
        ctx.beginPath()
        ctx.moveTo(calPoints[0].x, calPoints[0].y)
        ctx.lineTo(calPoints[1].x, calPoints[1].y)
        ctx.stroke()
      }
      for (const p of calPoints) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
  }, [bitmap, crop, viewport, mode, calPoints])

  if (!bitmap) return null

  const minZoom = clampCrop({ offsetX: 0, offsetY: 0, zoom: 0 }, bitmap.width, bitmap.height, viewport.w, viewport.h).zoom
  const maxZoom = Math.max(minZoom * 6, calibratedMaxZoom ?? 0)

  const resetCalibration = () => {
    setMode('pan')
    setCalPoints([])
    setCalDistanceText('')
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode === 'calibrate') {
      if (calPoints.length >= 2) return
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      setCalPoints((pts) => {
        const next = [...pts, { x, y }]
        if (next.length === 1) setCalZoomAtClick(crop.zoom)
        return next
      })
      return
    }
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffsetX: crop.offsetX, startOffsetY: crop.offsetY }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode === 'calibrate') return
    const drag = dragRef.current
    if (!drag || !bitmap) return
    const nextOffsetX = drag.startOffsetX + (e.clientX - drag.startX)
    const nextOffsetY = drag.startOffsetY + (e.clientY - drag.startY)
    setCrop((c) => clampCrop({ ...c, offsetX: nextOffsetX, offsetY: nextOffsetY }, bitmap.width, bitmap.height, viewport.w, viewport.h))
  }
  const handlePointerUp = () => {
    if (mode === 'calibrate') return
    dragRef.current = null
  }

  const handleZoomChange = (nextZoom: number) => {
    if (!bitmap) return
    // Zoom around the viewport's center so the visible middle of the photo
    // stays roughly put instead of jumping toward the top-left corner.
    const cx = viewport.w / 2
    const cy = viewport.h / 2
    const bitmapX = (cx - crop.offsetX) / crop.zoom
    const bitmapY = (cy - crop.offsetY) / crop.zoom
    const nextOffsetX = cx - bitmapX * nextZoom
    const nextOffsetY = cy - bitmapY * nextZoom
    setCrop(clampCrop({ offsetX: nextOffsetX, offsetY: nextOffsetY, zoom: nextZoom }, bitmap.width, bitmap.height, viewport.w, viewport.h))
  }

  const isValidDistance = (text: string) => {
    const v = Number(text.replace(',', '.'))
    return !isNaN(v) && v > 0
  }

  const handleApplyCalibration = () => {
    if (!bitmap || calPoints.length !== 2 || calZoomAtClick === null) return
    const realDistance = Number(calDistanceText.replace(',', '.'))
    if (isNaN(realDistance) || realDistance <= 0) return

    const canvasPxDistance = Math.hypot(calPoints[1].x - calPoints[0].x, calPoints[1].y - calPoints[0].y)
    const bitmapPxDistance = canvasPxDistance / calZoomAtClick

    const { zoom: newZoom, clampedToMinCover } = computeCalibratedZoom(
      bitmapPxDistance,
      realDistance,
      deckWidth,
      bitmap.width,
      bitmap.height,
      viewport.w,
      viewport.h
    )

    if (clampedToMinCover) {
      toast.warning('Фото не покрывает всю палубу при таком масштабе — масштаб ограничен минимальным значением')
    } else if (newZoom > minZoom * 6) {
      setCalibratedMaxZoom(newZoom)
    }

    // Re-center on the calibration points' midpoint so the just-measured
    // feature stays visually put as the zoom changes, then clamp back
    // in-bounds as usual.
    const midX = (calPoints[0].x + calPoints[1].x) / 2
    const midY = (calPoints[0].y + calPoints[1].y) / 2
    const bitmapMidX = (midX - crop.offsetX) / crop.zoom
    const bitmapMidY = (midY - crop.offsetY) / crop.zoom
    const nextOffsetX = midX - bitmapMidX * newZoom
    const nextOffsetY = midY - bitmapMidY * newZoom

    setCrop(clampCrop({ offsetX: nextOffsetX, offsetY: nextOffsetY, zoom: newZoom }, bitmap.width, bitmap.height, viewport.w, viewport.h))
    resetCalibration()
  }

  const handleConfirm = () => {
    const dataUrl = cropAndCompressToDataUrl(bitmap, crop, viewport.w, viewport.h, aspectRatio)
    onConfirm(dataUrl)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Настройте фото палубы</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <p className="text-xs text-muted-foreground self-start">
            Перетащите фото, чтобы выбрать нужный участок — рамка повторяет пропорции палубы.
          </p>
          <canvas
            ref={canvasRef}
            width={viewport.w}
            height={viewport.h}
            className="rounded-md border cursor-move touch-none"
            style={{ width: viewport.w, height: viewport.h }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          {mode === 'pan' ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start h-7 text-xs"
                onClick={() => { setMode('calibrate'); setCalPoints([]); setCalDistanceText('') }}
              >
                Откалибровать по известному расстоянию
              </Button>
              <div className="w-full space-y-1.5">
                <div className="text-xs text-muted-foreground">Масштаб</div>
                <input
                  type="range"
                  min={minZoom}
                  max={maxZoom}
                  step={(maxZoom - minZoom) / 100}
                  value={crop.zoom}
                  onChange={(e) => handleZoomChange(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            </>
          ) : (
            <div className="w-full space-y-2 rounded-md border p-2">
              <p className="text-xs text-muted-foreground">
                {calPoints.length < 2
                  ? `Отметьте на фото две точки известного расстояния (${calPoints.length}/2)`
                  : 'Введите реальное расстояние между точками'}
              </p>
              {calPoints.length === 2 && (
                <CalDistanceInput value={calDistanceText} unit={UNIT_LABEL[unit]} onChange={setCalDistanceText} />
              )}
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={resetCalibration}>
                  Отмена калибровки
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={calPoints.length < 2 || !isValidDistance(calDistanceText)}
                  onClick={handleApplyCalibration}
                >
                  Применить калибровку
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Отмена
          </Button>
          <Button type="button" size="sm" onClick={handleConfirm}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
