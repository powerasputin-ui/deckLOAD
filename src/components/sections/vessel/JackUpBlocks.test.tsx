import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { JackUpDataBlock, JackUpReportBlock, JackUpTransfersBlock } from './JackUpBlocks'
import { useCalculator } from '@/store/calculator'

// Spec 2026-11-06, 11.2: the legs are the user's — a leg added has its name
// and no position; the report asks each leg's load on its legs and the
// draught afloat.

const initial = useCalculator.getState()
const jack = () => useCalculator.getState().deck.jackUp

function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } })
  fireEvent.blur(field)
}

describe('jack-up blocks', () => {
  beforeEach(() => {
    useCalculator.setState({ ...initial, deck: { ...initial.deck, objectKind: 'jack-up', jackUp: undefined } })
  })

  it('a leg added has a name and no position; deleting it takes its load out of the report', () => {
    render(<JackUpDataBlock />)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить опору' }))
    expect(jack()?.legs).toEqual([{ id: expect.any(String), name: 'Опора 1' }])
    type(screen.getByLabelText('От кормы, м, Опора 1'), '12')
    type(screen.getByLabelText('От левого борта, м, Опора 1'), '-1,5')
    expect(jack()?.legs[0]).toMatchObject({ fromSternM: 12, fromPortM: -1.5 })
    const id = jack()!.legs[0].id
    useCalculator.setState({ deck: { ...useCalculator.getState().deck, jackUp: { ...jack()!, report: { legLoadsT: { [id]: 4_000 } } } } })
    fireEvent.click(screen.getByRole('button', { name: 'Удалить «Опора 1»' }))
    expect(jack()?.legs).toEqual([])
    expect(jack()?.report.legLoadsT).toEqual({})
  })

  it('the report asks each leg\'s load on its legs, and the draught afloat', () => {
    useCalculator.setState({
      deck: { ...useCalculator.getState().deck, jackUp: { mode: 'elevated', afloat: {}, elevated: {}, legs: [{ id: 'a', name: 'Опора 1' }], report: { legLoadsT: {} }, transfers: [] } },
    })
    render(<JackUpReportBlock />)
    type(within(screen.getByRole('group', { name: 'Нагрузки на опоры' })).getByLabelText('Нагрузка, Опора 1, т'), '4000')
    expect(jack()?.report.legLoadsT).toEqual({ a: 4_000 })
    expect(screen.queryByLabelText('Осадка, м')).toBeNull()
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Положение установки' })).getByRole('radio', { name: 'На плаву' }))
    expect(jack()?.mode).toBe('afloat')
    expect(screen.getByLabelText('Осадка, м')).toBeTruthy()
  })

  // Audit 2026-11-07: what's brought stands somewhere — the legs need where.
  it('each row of what\'s brought says where it stands: by a leg, or at the legs\' centre', () => {
    useCalculator.setState({
      deck: {
        ...useCalculator.getState().deck,
        jackUp: {
          mode: 'elevated',
          afloat: {},
          elevated: {},
          legs: [{ id: 'a', name: 'Носовая' }, { id: 'b', name: '' }],
          report: { legLoadsT: {} },
          transfers: [{ id: 't', name: 'Вода', weightT: 300 }],
        },
      },
    })
    render(<JackUpTransfersBlock />)
    const where = screen.getByLabelText('Где, строка 1')
    expect(within(where).getAllByRole('option').map((o) => o.textContent)).toEqual(['где — не указано', 'в центре опор, поровну', 'у «Носовая»', 'у «Опора 2»'])
    expect(where).toHaveValue('')
    fireEvent.change(where, { target: { value: 'a' } })
    expect(jack()?.transfers[0].at).toBe('a')
    fireEvent.change(where, { target: { value: '' } })
    expect(jack()?.transfers[0].at).toBeUndefined()
  })
})
