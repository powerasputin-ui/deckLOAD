import { describe, it, expect, vi, afterEach } from 'vitest'
import { compressImageToDataUrl } from './imageCompression'

// Audit 2026-11-09: a photo squeezed to 160 px passed every test — the
// module was at 0 % of its branches. The browser's decoding and canvas are
// stood in for; what is checked is the size it draws at and how it encodes.

const original = {
  createImageBitmap: (globalThis as { createImageBitmap?: unknown }).createImageBitmap,
  getContext: HTMLCanvasElement.prototype.getContext,
  toDataURL: HTMLCanvasElement.prototype.toDataURL,
}

function stub(width: number, height: number, withContext = true) {
  const bitmap = { width, height, close: vi.fn() }
  ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => bitmap)
  const drawImage = vi.fn()
  HTMLCanvasElement.prototype.getContext = vi.fn(() => (withContext ? { drawImage } : null)) as never
  const toDataURL = vi.fn(() => 'data:image/jpeg;base64,AAAA')
  HTMLCanvasElement.prototype.toDataURL = toDataURL as never
  return { bitmap, drawImage, toDataURL }
}

const photo = () => new File([new Uint8Array([1, 2, 3])], 'deck.jpg', { type: 'image/jpeg' })

afterEach(() => {
  ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = original.createImageBitmap
  HTMLCanvasElement.prototype.getContext = original.getContext
  HTMLCanvasElement.prototype.toDataURL = original.toDataURL
})

describe('compressImageToDataUrl', () => {
  it('brings a large photo down to 1600 px on its long side, keeping its proportions, as a JPEG at 0.8', async () => {
    const { bitmap, drawImage, toDataURL } = stub(4000, 3000)
    const out = await compressImageToDataUrl(photo())
    expect(out).toEqual({ dataUrl: 'data:image/jpeg;base64,AAAA', width: 1600, height: 1200 })
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 1200)
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8)
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('takes the long side whichever it is', async () => {
    stub(3000, 4000)
    expect(await compressImageToDataUrl(photo())).toMatchObject({ width: 1200, height: 1600 })
  })

  it('never enlarges a small one', async () => {
    const { drawImage } = stub(800, 600)
    expect(await compressImageToDataUrl(photo())).toMatchObject({ width: 800, height: 600 })
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600)
  })

  it('says so when the browser gives no canvas to draw on', async () => {
    stub(4000, 3000, false)
    await expect(compressImageToDataUrl(photo())).rejects.toThrow('Canvas 2D context unavailable')
  })
})
