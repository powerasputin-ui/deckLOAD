import { describe, it, expect } from 'vitest'
import { cornerMarksFit } from './deckMarks'

// Spec 6.2, 6.3: the marks in a stack's corners never cover its number.
describe('cornerMarksFit', () => {
  it('puts every mark on a stack with room around its number', () => {
    // A 20ft container at «Вписать»: «1» in the middle.
    expect(cornerMarksFit(248, 100, 16, 22)).toEqual({ overload: true, badge: true, secondBadge: true, mixed: true, rotated: true })
  })

  it('leaves the marks off a stack its number fills', () => {
    // A pallet: «2» at 11 px fills it.
    expect(cornerMarksFit(31, 21, 11, 13)).toEqual({ overload: false, badge: false, secondBadge: false, mixed: false, rotated: false })
  })

  it('puts them above and below the number on a long narrow stack', () => {
    expect(cornerMarksFit(40, 120, 11, 13)).toMatchObject({ overload: true, badge: true, rotated: true })
    // Two badges side by side need 34 px across.
    expect(cornerMarksFit(32, 120, 11, 13).secondBadge).toBe(false)
  })

  it('needs only room for the mark on a stack whose number is written elsewhere', () => {
    expect(cornerMarksFit(18, 18, 0, 0).badge).toBe(true)
    expect(cornerMarksFit(17, 18, 0, 0).badge).toBe(false)
  })
})
