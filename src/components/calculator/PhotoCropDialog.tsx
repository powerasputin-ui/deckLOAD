'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { clampCrop, cropAndCompressToDataUrl, type CropState } from '@/lib/imageCrop'

interface PhotoCropDialogProps {
  open: boolean
  bitmap: ImageBitmap | null
  // width/length ratio of the deck at the moment the dialog opened — fixed
  // for the lifetime of this dialog instance so it can't drift if the deck
  // is resized elsewhere while the crop UI is open.
  aspectRatio: number
  onConfirm: (dataUrl: string) => void
  onCancel: () => void
}

// Fixed on-screen viewport size for the crop frame, capped so it comfortably
// fits the dialog regardless of the deck's aspect ratio (a near-square deck
// and a very elongated one both need a sane frame size).
const MAX_VIEWPORT_W = 480
const MAX_VIEWPORT_H = 360

export function PhotoCropDialog({ open, bitmap, aspectRatio, onConfirm, onCancel }: PhotoCropDialogProps) {
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
  }, [bitmap, crop, viewport])

  if (!bitmap) return null

  const minZoom = clampCrop({ offsetX: 0, offsetY: 0, zoom: 0 }, bitmap.width, bitmap.height, viewport.w, viewport.h).zoom
  const maxZoom = minZoom * 6

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffsetX: crop.offsetX, startOffsetY: crop.offsetY }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || !bitmap) return
    const nextOffsetX = drag.startOffsetX + (e.clientX - drag.startX)
    const nextOffsetY = drag.startOffsetY + (e.clientY - drag.startY)
    setCrop((c) => clampCrop({ ...c, offsetX: nextOffsetX, offsetY: nextOffsetY }, bitmap.width, bitmap.height, viewport.w, viewport.h))
  }
  const handlePointerUp = () => {
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
