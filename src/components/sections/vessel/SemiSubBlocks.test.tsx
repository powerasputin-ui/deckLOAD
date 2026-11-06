import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SemiSubDataBlock, SemiSubTransfersBlock } from './SemiSubBlocks'
import { useCalculator } from '@/store/calculator'

// Spec 2026-11-06, 7.1: a semi-submersible's figures are the user's — a
// row added is empty, and joins the table only once it is filled in.

const initial = useCalculator.getState()
const semi = () => useCalculator.getState().deck.semiSub

function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } })
  fireEvent.blur(field)
}

describe('semi-submersible blocks', () => {
  beforeEach(() => {
    useCalculator.setState({ ...initial, deck: { ...initial.deck, objectKind: 'semi-sub', semiSub: undefined } })
  })

  it('a KG row starts empty and joins the table once both its figures are in', () => {
    render(<SemiSubDataBlock />)
    const operating = screen.getByRole('group', { name: 'Рабочий режим' })
    fireEvent.click(within(operating).getByRole('button', { name: 'Строка KG' }))
    const draft = within(operating).getByLabelText('Осадка, строка 1') as HTMLInputElement
    expect(draft.value).toBe('')
    type(draft, '21')
    expect(semi()?.operating.kgLimit).toBeUndefined()
    type(within(operating).getByLabelText('Допустимый KG, строка 1'), '20,9')
    expect(semi()?.operating.kgLimit).toEqual([{ draftM: 21, kgMaxM: 20.9 }])
  })

  it('a transfer row starts empty: nothing is assumed for it', () => {
    render(<SemiSubTransfersBlock />)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить строку' }))
    expect(semi()?.transfers).toEqual([{ id: expect.any(String), name: '' }])
    expect((screen.getByLabelText('Вес, т, строка 1') as HTMLInputElement).value).toBe('')
  })
})
