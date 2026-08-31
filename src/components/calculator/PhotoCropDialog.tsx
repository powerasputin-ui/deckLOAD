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

// Fallback viewport-max before the adaptive size (below) has measured the
// browser window — matches the fixed size this dialog used before it became
// responsive, so there's no flash of a differently-sized canvas.
const FALLBACK_MAX_W = 380
const FALLBACK_MAX_H = 280

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
  // Adaptive viewport cap: sized off the actual browser window (not a fixed
  // constant) so the crop/calibration canvas is genuinely usable instead of
  // a cramped fixed box — capped so it doesn't dominate a huge monitor, and
  // floored so a tiny window still gets a workable size. Recomputed on
  // resize while the dialog is open.
  const [maxViewport, setMaxViewport] = useState({ w: FALLBACK_MAX_W, h: FALLBACK_MAX_H })
  useEffect(() => {
    if (!open) return
    const compute = () => {
      setMaxViewport({
        w: Math.max(360, Math.min(window.innerWidth * 0.8, 900)),
        h: Math.max(260, Math.min(window.innerHeight * 0.65, 640)),
      })
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [open])

  const viewport = useMemo(() => {
    let w = maxViewport.w
    let h = w / aspectRatio
    if (h > maxViewport.h) {
      h = maxViewport.h
      w = h * aspectRatio
    }
    return { w, h }
  }, [aspectRatio, maxViewport])

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

  // The viewport can now change size while the dialog is open (browser
  // window resize) — re-clamp so `crop` never drifts out of bounds. Same
  // render-time "compare previous" pattern as the bitmap-load block above,
  // not a useEffect (this codebase's lint rules forbid synchronous setState
  // inside effects). Harmless no-op if the bitmap block above already set a
  // valid crop for the new viewport this same render — clampCrop on an
  // already-in-bounds crop just returns it unchanged.
  const [prevViewport, setPrevViewport] = useState(viewport)
  if ((viewport.w !== prevViewport.w || viewport.h !== prevViewport.h) && bitmap) {
    setPrevViewport(viewport)
    setCrop((c) => clampCrop(c, bitmap.width, bitmap.height, viewport.w, viewport.h))
  }

  // Two-point scale calibration: click two points on the photo whose real
  // distance you know, type that distance, and the dialog computes the
  // zoom that makes the deck's real width span the viewport exactly —
  // instead of eyeballing the "Масштаб" slider. Purely optional/additive;
  // panning/zooming manually keeps working exactly as before.
  const [mode, setMode] = useState<InteractionMode>('pan')
  const [calPoints, setCalPoints] = useState<{ x: number; y: number }[]>([])
  const [calDistanceText, setCalDistanceText] = useState('')
  // Whole-photo "contain" view used only while calibrating — independent of
  // `crop` (which stays aspect-locked to the deck and may not show the
  // whole photo at once). A stable computed value for as long as bitmap/
  // viewport don't change, so calibration math never needs to guess what
  // transform was in effect when a point was clicked.
  const calibrationView = useMemo(() => {
    if (!bitmap) return null
    const zoom = Math.min(viewport.w / bitmap.width, viewport.h / bitmap.height)
    const scaledW = bitmap.width * zoom
    const scaledH = bitmap.height * zoom
    return { zoom, offsetX: (viewport.w - scaledW) / 2, offsetY: (viewport.h - scaledH) / 2 }
  }, [bitmap, viewport])
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
    if (mode === 'calibrate' && calibrationView) {
      // Whole photo, letterboxed to fit — not the deck-aspect-locked crop
      // frame — so any two reference points are reachable regardless of
      // the current pan/zoom state.
      ctx.drawImage(
        bitmap,
        calibrationView.offsetX,
        calibrationView.offsetY,
        bitmap.width * calibrationView.zoom,
        bitmap.height * calibrationView.zoom
      )
    } else {
      ctx.drawImage(bitmap, crop.offsetX, crop.offsetY, bitmap.width * crop.zoom, bitmap.height * crop.zoom)
    }

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
  }, [bitmap, crop, viewport, mode, calPoints, calibrationView])

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
      setCalPoints((pts) => [...pts, { x, y }])
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
    if (!bitmap || calPoints.length !== 2 || !calibrationView) return
    const realDistance = Number(calDistanceText.replace(',', '.'))
    if (isNaN(realDistance) || realDistance <= 0) return

    // Calibration points were clicked against the whole-photo "contain"
    // view, not `crop` — convert via calibrationView, which is stable for
    // as long as calibration mode has been active (no zoom/pan possible
    // while calibrating), unlike the old approach of snapshotting crop.zoom
    // at click time.
    const bitmapPointFor = (p: { x: number; y: number }) => ({
      x: (p.x - calibrationView.offsetX) / calibrationView.zoom,
      y: (p.y - calibrationView.offsetY) / calibrationView.zoom,
    })
    const b0 = bitmapPointFor(calPoints[0])
    const b1 = bitmapPointFor(calPoints[1])
    const bitmapPxDistance = Math.hypot(b1.x - b0.x, b1.y - b0.y)

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

    // Center the resulting pan/crop view on the calibration midpoint (in
    // bitmap space, already derived above), then clamp back in-bounds.
    const bitmapMidX = (b0.x + b1.x) / 2
    const bitmapMidY = (b0.y + b1.y) / 2
    const nextOffsetX = viewport.w / 2 - bitmapMidX * newZoom
    const nextOffsetY = viewport.h / 2 - bitmapMidY * newZoom

    setCrop(clampCrop({ offsetX: nextOffsetX, offsetY: nextOffsetY, zoom: newZoom }, bitmap.width, bitmap.height, viewport.w, viewport.h))
    resetCalibration()
  }

  const handleConfirm = () => {
    const dataUrl = cropAndCompressToDataUrl(bitmap, crop, viewport.w, viewport.h, aspectRatio)
    onConfirm(dataUrl)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className="sm:max-w-[min(94vw,940px)]">
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
                  ? `Показано всё фото — отметьте на нём две точки известного расстояния (${calPoints.length}/2)`
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
