import { describe, expect, it } from 'vitest'
import { initialPhotoRect } from './deckPhoto'

describe('initialPhotoRect', () => {
  it('spans the deck\'s width at the photo\'s own aspect, centred along the deck', () => {
    // A 2:1 photo on an 8 × 20 deck: 8 wide, 4 long, from y = 8.
    expect(initialPhotoRect(2000, 1000, 8, 20)).toEqual({ x: 0, y: 8, width: 8, length: 4 })
  })
})
