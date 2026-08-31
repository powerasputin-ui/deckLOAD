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

export interface CalibrationResult {
  zoom: number
  // True when the requested zoom was below minZoomForCover — the typed
  // real distance implies the photo doesn't cover the full deck at the
  // correct scale, so the result is clamped to the largest zoom that still
  // shows a gap-free frame instead of the (physically impossible) ideal.
  clampedToMinCover: boolean
}

// Two-point scale calibration: given the on-screen distance between two
// clicked points (already converted to bitmap-space px) and the real-world
// distance the user says that represents, compute the zoom that makes the
// deck's own real width span exactly the viewport. Only deckRealWidth (not
// length) is used — the crop frame's aspect ratio is locked to
// deckWidth/deckLength, so deriving from width alone is self-consistent.
export function computeCalibratedZoom(
  bitmapPxDistance: number,
  realDistance: number,
  deckRealWidth: number,
  bitmapW: number,
  bitmapH: number,
  viewportW: number,
  viewportH: number
): CalibrationResult {
  const minZoom = minZoomForCover(bitmapW, bitmapH, viewportW, viewportH)
  if (bitmapPxDistance <= 0 || realDistance <= 0 || deckRealWidth <= 0) {
    return { zoom: minZoom, clampedToMinCover: true }
  }
  const bitmapPxPerRealUnit = bitmapPxDistance / realDistance
  const idealZoom = viewportW / (deckRealWidth * bitmapPxPerRealUnit)
  if (idealZoom < minZoom) return { zoom: minZoom, clampedToMinCover: true }
  return { zoom: idealZoom, clampedToMinCover: false }
}

// A second, independent use of the same two-point-click mechanic as
// computeCalibratedZoom: once a real-world scale has been established from
// one reference distance (a printed dimension, a known object), convert any
// OTHER clicked pixel distance into a real-world one — e.g. measuring the
// deck's own extent in the photo, instead of guessing a px/m ratio by eye
// and hand-computing it outside the app (see vesselTemplates.ts's own
// Olympic Commander history for exactly what that manual process gets
// wrong: a spacing guessed once, never cross-checked, silently propagated).
export function computeRealDistance(bitmapPxDistance: number, refPxDistance: number, refRealDistance: number): number {
  if (refPxDistance <= 0) return 0
  return (bitmapPxDistance / refPxDistance) * refRealDistance
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
