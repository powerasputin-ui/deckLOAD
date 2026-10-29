// A deck photo as it lands (spec 8.1, «Фото палубы»): uploaded whole, never
// cropped — only downscaled and re-encoded for storage — and placed as a
// free rectangle in the deck's own coordinates, as wide as the deck at the
// photo's own aspect, centred along it: a starting guess the user then
// moves, scales or calibrates into place. Shared by the block in «Судно»
// and the deck's right-click «Загрузить фото».
import { compressImageToDataUrl } from './imageCompression'

export interface DeckPhotoRect {
  x: number
  y: number
  width: number
  length: number
}

export function initialPhotoRect(pixelWidth: number, pixelHeight: number, deckWidth: number, deckLength: number): DeckPhotoRect {
  const length = deckWidth * (pixelHeight / pixelWidth)
  return { x: 0, y: (deckLength - length) / 2, width: deckWidth, length }
}

export async function readDeckPhoto(file: File, deckWidth: number, deckLength: number): Promise<{ dataUrl: string; rect: DeckPhotoRect }> {
  const { dataUrl, width, height } = await compressImageToDataUrl(file)
  return { dataUrl, rect: initialPhotoRect(width, height, deckWidth, deckLength) }
}
