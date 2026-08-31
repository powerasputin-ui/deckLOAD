// Downscales/re-encodes an uploaded photo before it ever reaches the store —
// this app persists whole projects as one JSON blob in localStorage (see
// src/store/projects.ts, saveToStorage) with only ~5-10MB shared across
// every project, and an unscaled phone photo (several MB) could quickly
// exhaust that. Only the resulting data URL is ever stored; the original
// file/blob is discarded.
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.8

// Returns the compressed output's own pixel dimensions alongside the data
// URL — callers that place the image as a free-floating rect (deck
// background photo) need its aspect ratio to size that rect sensibly, and
// re-decoding the already-compressed data URL just to read its dimensions
// back out would be wasteful when this function already has them on hand.
export async function compressImageToDataUrl(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()

  return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), width: w, height: h }
}
