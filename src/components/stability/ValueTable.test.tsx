import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ValueTable, type CellValue, type ValueColumn } from './ValueTable'

// Stage 2a, group B: the one table the stability workspace edits the limit,
// the tanks, the hydrostatics and the KN curves with (spec 2026-10-24, 6.1).

const columns: ValueColumn[] = [
  { key: 'draft', label: 'Осадка', unit: 'м' },
  { key: 'gm', label: 'GM мин.', unit: 'м' },
  { key: 'note', label: 'Примечание', kind: 'text' },
  { key: 'fsm', label: 'FSM', optional: true },
]

function table(rows: CellValue[][] = [], handlers: Partial<Parameters<typeof ValueTable>[0]> = {}) {
  const props = {
    label: 'Предел',
    columns,
    rows,
    onChange: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onPaste: vi.fn(),
    addLabel: 'Добавить строку',
    ...handlers,
  }
  render(<ValueTable {...props} />)
  return props
}

const type = (label: string, value: string) => {
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('ValueTable', () => {
  it('adds a new row only once every required cell is filled — never a row of zeros', () => {
    const { onAdd } = table()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить строку' }))
    const save = screen.getByRole('button', { name: 'Сохранить новую строку' })
    expect(save).toHaveProperty('disabled', true)
    expect(screen.getByText('Строка добавится, когда будут заполнены: Осадка, GM мин..')).toBeTruthy()

    type('Осадка, новая строка', '5,9')
    expect(save).toHaveProperty('disabled', true)
    type('GM мин., новая строка', '1.3')
    // The text and the optional cells can stay empty.
    expect(save).toHaveProperty('disabled', false)
    fireEvent.click(save)
    expect(onAdd).toHaveBeenCalledWith([5.9, 1.3, undefined, undefined])
    expect(screen.queryByRole('button', { name: 'Сохранить новую строку' })).toBeNull()
  })

  it('drops a new row on «Отменить», and edits and removes the rows there are', () => {
    const { onAdd, onChange, onRemove } = table([[5.9, 1.3, '', undefined]])
    fireEvent.click(screen.getByRole('button', { name: 'Добавить строку' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отменить новую строку' }))
    expect(onAdd).not.toHaveBeenCalled()

    type('GM мин., строка 1', '1.25')
    expect(onChange).toHaveBeenCalledWith(0, 1, 1.25)
    // An optional cell can be emptied again.
    type('FSM, строка 1', '12')
    expect(onChange).toHaveBeenLastCalledWith(0, 3, 12)
    fireEvent.click(screen.getByRole('button', { name: 'Удалить строку 1' }))
    expect(onRemove).toHaveBeenCalledWith(0)
  })

  it('replaces the rows with pasted text, and says what it can\'t read', () => {
    const { onPaste } = table()
    fireEvent.click(screen.getByRole('button', { name: 'Вставить текстом' }))
    const text = screen.getByLabelText('Предел: текст для вставки')
    fireEvent.change(text, { target: { value: '5;1,2;LC51\n6;x;' } })
    fireEvent.click(screen.getByRole('button', { name: 'Вставить' }))
    expect(screen.getByRole('alert').textContent).toBe('Строка 2, столбец 2: «x» — не число')
    expect(onPaste).not.toHaveBeenCalled()

    fireEvent.change(text, { target: { value: '5;1,2;LC51\n6;1,35;;40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Вставить' }))
    expect(onPaste).toHaveBeenCalledWith([
      [5, 1.2, 'LC51', undefined],
      [6, 1.35, '', 40],
    ])
    expect(screen.queryByLabelText('Предел: текст для вставки')).toBeNull()
  })

  it('hands the text to a table that reads it itself, and keeps it open on an error', () => {
    const onPasteText = vi.fn((text: string) => (text.startsWith('0') ? null : 'Первая строка — углы крена'))
    table([], { onPaste: undefined, onPasteText })
    fireEvent.click(screen.getByRole('button', { name: 'Вставить текстом' }))
    const text = screen.getByLabelText('Предел: текст для вставки')
    fireEvent.change(text, { target: { value: '2000;0;1,2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Вставить' }))
    expect(screen.getByRole('alert').textContent).toBe('Первая строка — углы крена')
    fireEvent.change(text, { target: { value: '0;10\n2000;0;1,2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Вставить' }))
    expect(onPasteText).toHaveBeenLastCalledWith('0;10\n2000;0;1,2')
    expect(screen.queryByLabelText('Предел: текст для вставки')).toBeNull()
  })

  it('can\'t add a row while it says why', () => {
    table([], { addDisabled: 'Сначала задайте углы крена' })
    const add = screen.getByRole('button', { name: 'Добавить строку' })
    expect(add).toHaveProperty('disabled', true)
    expect(add.getAttribute('title')).toBe('Сначала задайте углы крена')
  })
})
