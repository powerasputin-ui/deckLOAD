import { describe, it, expect } from 'vitest'
import { estimateTextWidth, layoutStackLabels, stackLabelText, type LabelStack } from './labelLayout'

const stack = (
  key: string,
  numbers: number[],
  rect: LabelStack['rect'],
  deck: LabelStack['deck'],
  extra: Partial<LabelStack> = {}
): LabelStack => ({ key, numbers, layers: 1, rect, deck, ...extra })

describe('stackLabelText', () => {
  it('is the cargo number, with the units of a stack and every cargo of a mixed one', () => {
    expect(stackLabelText([3], 1)).toBe('3')
    expect(stackLabelText([3], 4)).toBe('3 ×4')
    expect(stackLabelText([4, 3, 4], 16)).toBe('3+4 ×16')
  })
})

describe('layoutStackLabels', () => {
  it('writes the number on a stack it fits, as large as the stack allows, and the name when the whole name fits at 12 px', () => {
    const { plans, groups } = layoutStackLabels(
      [
        stack('container', [1], { x: 0, y: 0, w: 248, h: 100 }, { x: 0, y: 0, width: 2.44, length: 6.06 }, { name: 'Контейнер 20ft', layers: 2 }),
        stack('pallet', [2], { x: 300, y: 0, w: 32, h: 22 }, { x: 0, y: 8, width: 0.8, length: 1.2 }, { name: 'Паллета EUR' }),
      ],
      0.1
    )
    // Up to 20 px, and no more than 40% of the shorter side.
    expect(plans.get('container')).toEqual({ kind: 'own', full: '1 ×2', text: '1 ×2', fontSize: 20, name: 'Контейнер 20ft' })
    // The number fits; the name would need cutting, so it isn't written.
    expect(plans.get('pallet')).toEqual({ kind: 'own', full: '2', text: '2', fontSize: 11, name: undefined })
    expect(groups).toEqual([])
  })

  it('takes a smaller size before giving up, never below 11 px', () => {
    // Tall enough for 16 px, but only 12 px fits the width.
    const w = estimateTextWidth('3 ×12', 12) + 4
    const { plans } = layoutStackLabels([stack('a', [3], { x: 0, y: 0, w, h: 40 }, { x: 0, y: 0, width: 1, length: 1 }, { layers: 12 })], 0.1)
    expect(plans.get('a')).toMatchObject({ kind: 'own', fontSize: 12 })
    const tiny = layoutStackLabels([stack('b', [3], { x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, width: 1, length: 1 })], 0.1)
    expect(tiny.plans.get('b')).toEqual({ kind: 'none', full: '3' })
  })

  it('writes the number alone when «×N» doesn\'t fit with it', () => {
    const w = estimateTextWidth('2', 11) + 4
    const { plans } = layoutStackLabels([stack('a', [2], { x: 0, y: 0, w, h: 13 }, { x: 0, y: 0, width: 1.2, length: 0.8 }, { layers: 30 })], 0.1)
    expect(plans.get('a')).toEqual({ kind: 'own', full: '2 ×30', text: '2', fontSize: 11, name: undefined })
  })

  it('writes the number once over neighbouring stacks of the same cargo when it fits none of them', () => {
    // Three pipes side by side, 0.1 apart (the deck's gap), each 6 px wide:
    // too narrow even for the number alone.
    const pipes = [0, 1, 2].map((i) =>
      stack(`p${i}`, [4], { x: i * 10, y: 0, w: 6, h: 40 }, { x: i * 0.35, y: 0, width: 0.25, length: 9.5 }, { layers: 3 })
    )
    const { plans, groups } = layoutStackLabels(pipes, 0.1)
    expect(groups).toEqual([{ keys: ['p0', 'p1', 'p2'], text: '4', fontSize: 11, cx: 13, cy: 20 }])
    expect(plans.get('p1')).toEqual({ kind: 'group', full: '4 ×3' })
  })

  it('keeps other cargo and stacks further apart than the gap out of a group', () => {
    const { groups } = layoutStackLabels(
      [
        stack('a', [4], { x: 0, y: 0, w: 6, h: 40 }, { x: 0, y: 0, width: 0.25, length: 9.5 }),
        stack('b', [5], { x: 10, y: 0, w: 6, h: 40 }, { x: 0.35, y: 0, width: 0.25, length: 9.5 }),
        stack('c', [4], { x: 40, y: 0, w: 6, h: 40 }, { x: 1.5, y: 0, width: 0.25, length: 9.5 }),
      ],
      0.1
    )
    expect(groups).toEqual([])
  })
})
