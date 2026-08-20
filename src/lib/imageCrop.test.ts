import { describe, it, expect } from 'vitest'
import { computeCalibratedZoom, minZoomForCover } from './imageCrop'

describe('computeCalibratedZoom', () => {
  it('computes the zoom that makes the deck width span the viewport, for a large enough photo', () => {
    // canvasPxDistance=100 at calZoomAtClick=0.5 -> bitmapPxDistance=200
    // realDistance=2 -> bitmapPxPerRealUnit=100
    // deckWidth=20, viewport.w=380 -> idealZoom = 380/(20*100) = 0.19
    const bitmapW = 4000
    const bitmapH = 3000
    const viewportW = 380
    const viewportH = 280
    const result = computeCalibratedZoom(200, 2, 20, bitmapW, bitmapH, viewportW, viewportH)
    expect(result.clampedToMinCover).toBe(false)
    expect(result.zoom).toBeCloseTo(0.19, 5)
    // Sanity: the ideal zoom really is above the cover floor for this photo.
    expect(result.zoom).toBeGreaterThanOrEqual(minZoomForCover(bitmapW, bitmapH, viewportW, viewportH))
  })

  it('clamps to minZoomForCover when the typed distance implies the photo cannot cover the full deck', () => {
    const bitmapW = 4000
    const bitmapH = 3000
    const viewportW = 380
    const viewportH = 280
    // A tiny real distance for the same pixel span implies a huge scale
    // (bitmapPxPerRealUnit), which drives the ideal zoom far below the
    // cover floor — the photo doesn't actually contain that much real-world
    // extent at the deck's real size.
    const result = computeCalibratedZoom(200, 0.001, 20, bitmapW, bitmapH, viewportW, viewportH)
    expect(result.clampedToMinCover).toBe(true)
    expect(result.zoom).toBe(minZoomForCover(bitmapW, bitmapH, viewportW, viewportH))
  })

  it('falls back to minZoomForCover for degenerate input without NaN/Infinity', () => {
    const bitmapW = 4000
    const bitmapH = 3000
    const viewportW = 380
    const viewportH = 280
    const minZoom = minZoomForCover(bitmapW, bitmapH, viewportW, viewportH)

    expect(computeCalibratedZoom(0, 2, 20, bitmapW, bitmapH, viewportW, viewportH)).toEqual({
      zoom: minZoom,
      clampedToMinCover: true,
    })
    expect(computeCalibratedZoom(200, 0, 20, bitmapW, bitmapH, viewportW, viewportH)).toEqual({
      zoom: minZoom,
      clampedToMinCover: true,
    })
    expect(computeCalibratedZoom(200, 2, 0, bitmapW, bitmapH, viewportW, viewportH)).toEqual({
      zoom: minZoom,
      clampedToMinCover: true,
    })
  })
})
