// Pan/zoom crop math + final composite for the deck background photo tool
// (src/components/calculator/PhotoCropDialog.tsx). Sibling to
// imageCompression.ts — that module still handles the old "no crop, just
// downscale the whole image" path; this one crops FIRST (to the deck's
// exact aspect ratio) and downscales the already-cropped result, so the
// two constants below are intentionally duplicated rather than shared, to
// keep each module self-contained.
const MAX_OUTPUT_DIMENSION = 1600
const JPEG_QUALITY = 0.8

export interface CropState {
  // CSS-px position of the bitmap's top-left corner relative to the
  // viewport's top-left corner. Always <= 0 once clamped (the bitmap can
  // only be dragged so its edges recede past the viewport, never reveal a
  // gap inside it).
  offsetX: number
  offsetY: number
  // Display px per source-bitmap px.
  zoom: number
}

// The smallest zoom at which the scaled bitmap still fully covers the
// viewport in both axes — the "fit to frame, no empty space" floor the
// zoom slider must never go below.
export function minZoomForCover(bitmapW: number, bitmapH: number, viewportW: number, viewportH: number): number {
  return Math.max(viewportW / bitmapW, viewportH / bitmapH)
}

// Re-clamps zoom (never below the cover floor) and offset (bitmap must
// still fully cover the viewport at the resulting zoom) after any drag or
// zoom-slider change.
export function clampCrop(
  crop: CropState,
  bitmapW: number,
  bitmapH: number,
  viewportW: number,
  viewportH: number
): CropState {
  const minZoom = minZoomForCover(bitmapW, bitmapH, viewportW, viewportH)
  const zoom = Math.max(minZoom, crop.zoom)
  const scaledW = bitmapW * zoom
  const scaledH = bitmapH * zoom
  const minOffsetX = viewportW - scaledW
  const minOffsetY = viewportH - scaledH
  const offsetX = Math.min(0, Math.max(minOffsetX, crop.offsetX))
  const offsetY = Math.min(0, Math.max(minOffsetY, crop.offsetY))
  return { offsetX, offsetY, zoom }
}

// Composites exactly the region visible inside the viewport frame (in
// source-bitmap coordinates, derived from the current pan/zoom) onto an
// output canvas sized to the deck's aspect ratio, capped at
// MAX_OUTPUT_DIMENSION on the longer side, then re-encodes as JPEG — the
// saved image already has the deck's exact aspect ratio, so nothing
// downstream needs to stretch it anymore.
export function cropAndCompressToDataUrl(
  bitmap: ImageBitmap,
  crop: CropState,
  viewportW: number,
  viewportH: number,
  frameAspect: number
): string {
  const srcX = -crop.offsetX / crop.zoom
  const srcY = -crop.offsetY / crop.zoom
  const srcW = viewportW / crop.zoom
  const srcH = viewportH / crop.zoom

  let outW = MAX_OUTPUT_DIMENSION
  let outH = Math.round(outW / frameAspect)
  if (outH > MAX_OUTPUT_DIMENSION) {
    outH = MAX_OUTPUT_DIMENSION
    outW = Math.round(outH * frameAspect)
  }

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(bitmap, srcX, srcY, srcW, srcH, 0, 0, outW, outH)
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}
