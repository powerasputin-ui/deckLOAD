import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { toast } from 'sonner'
import { CargoSection } from './CargoSection'
import { useCalculator } from '@/store/calculator'
import type { PlacedItem } from '@/lib/packing'

// Stage 3, group C: «Грузы» — the compact list, the catalogue and the short
// form for a cargo of one's own (spec 7.1–7.3).

const initial = useCalculator.getState()

function reset(patch: Partial<ReturnType<typeof useCalculator.getState>> = {}) {
  useCalculator.setState({
    ...initial,
    deck: { width: 8, length: 20, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
    items: [],
    mode: 'auto',
    activeStampId: null,
    drawingCustomShape: false,
    pendingCustomShape: null,
    manualPlacements: [],
    pinnedPlacementsByTrip: {},
    ...patch,
  })
}

function section(props: Partial<Parameters<typeof CargoSection>[0]> = {}) {
  const all = {
    onOpenTable: vi.fn(),
    placedAcrossTrips: [] as PlacedItem[],
    hoveredItemId: null,
    onHover: vi.fn(),
    onPlaceCustomShape: vi.fn(),
    ...props,
  }
  const view = render(<CargoSection {...all} />)
  return { ...all, view }
}

const items = () => useCalculator.getState().items
const catalogEntry = (name: RegExp) => within(screen.getByRole('region', { name: 'Каталог грузов' })).getAllByRole('button', { name })[0]

describe('CargoSection', () => {
  beforeEach(() => {
    reset()
    vi.spyOn(toast, 'success').mockImplementation(() => '')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('an empty list says how to start, with the catalogue and the form', () => {
    section()
    expect(screen.getByText('Добавьте груз из каталога или задайте свой')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Список грузов' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Каталог' }))
    expect(screen.getByRole('region', { name: 'Каталог грузов' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Каталог' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('sums up the list in one line: types, units, tonnes', () => {
    reset({
      items: [
        { id: 'a', name: 'A', width: 2, length: 1, height: 1, quantity: 20, color: '#000', allowRotation: true, weight: 500 },
        { id: 'b', name: 'B', width: 2, length: 1, height: 1, quantity: 2, color: '#000', allowRotation: true, weight: 3300 },
        { id: 'c', name: 'C', width: 2, length: 1, height: 1, quantity: 1, color: '#000', allowRotation: true },
      ],
    })
    section()
    expect(screen.getByTestId('cargo-summary').textContent).toBe('3 типа · 23 ед. · 16.6 т (без веса: 1)')
  })

  describe('the catalogue', () => {
    it('adds the cargo with quantity 1, then 1 more of the same; in auto mode nothing is armed', () => {
      section()
      fireEvent.click(screen.getByRole('button', { name: 'Каталог' }))
      fireEvent.click(catalogEntry(/^Контейнер 20ft/))
      expect(items()).toHaveLength(1)
      expect(items()[0]).toMatchObject({ name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, weight: 2200, quantity: 1 })
      fireEvent.click(catalogEntry(/^Контейнер 20ft/))
      expect(items()).toHaveLength(1)
      expect(items()[0].quantity).toBe(2)
      expect(catalogEntry(/^Контейнер 20ft/).textContent).toMatch(/в списке 2$/)
      expect(useCalculator.getState().activeStampId).toBeNull()
    })

    it('arms the chosen cargo for a click on the deck in manual mode', () => {
      reset({ mode: 'manual' })
      section()
      fireEvent.click(screen.getByRole('button', { name: 'Каталог' }))
      fireEvent.click(catalogEntry(/^Паллета IND/))
      expect(useCalculator.getState().activeStampId).toBe(items()[0].id)
      expect(screen.getByRole('status').textContent).toMatch(/Кликните по палубе/)
    })

    it('gives the sizes and adds the cargo in the deck\'s unit', () => {
      reset({ deck: { width: 800, length: 2000, unit: 'cm', gap: 10, boardOffset: 20, clearance: 0 } })
      section()
      fireEvent.click(screen.getByRole('button', { name: 'Каталог' }))
      expect(catalogEntry(/^Контейнер 20ft/).textContent).toContain('606×244×259 см')
      fireEvent.click(catalogEntry(/^Контейнер 20ft/))
      expect(items()[0]).toMatchObject({ width: 606, length: 244, height: 259 })
    })

    it('searches by name and narrows to a category', () => {
      section()
      fireEvent.click(screen.getByRole('button', { name: 'Каталог' }))
      const catalog = screen.getByRole('region', { name: 'Каталог грузов' })
      fireEvent.change(within(catalog).getByLabelText('Поиск по каталогу'), { target: { value: 'обсадная' } })
      expect(within(catalog).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Разное'])
      fireEvent.change(within(catalog).getByLabelText('Поиск по каталогу'), { target: { value: '' } })

      fireEvent.click(within(catalog).getByRole('button', { name: 'Фигуры' }))
      expect(within(catalog).getByRole('button', { name: 'Фигуры' }).getAttribute('aria-pressed')).toBe('true')
      expect(within(catalog).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Фигуры'])
      expect(within(catalog).getByRole('button', { name: 'Нарисовать форму' })).toBeTruthy()
    })

    it('«Нарисовать форму» arms the drawing and disarms a stamp', () => {
      reset({ mode: 'manual', items: [{ id: 'a', name: 'A', width: 2, length: 1, height: 1, quantity: 1, color: '#000', allowRotation: true }], activeStampId: 'a' })
      section()
      fireEvent.click(screen.getByRole('button', { name: 'Каталог' }))
      const draw = screen.getByRole('button', { name: 'Нарисовать форму' })
      fireEvent.click(draw)
      expect(useCalculator.getState().drawingCustomShape).toBe(true)
      expect(useCalculator.getState().activeStampId).toBeNull()
      expect(draw.getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByText(/замкните его кликом у первой точки/)).toBeTruthy()
    })

    // It used to give the stack's sides in metres whatever the deck's unit:
    // a 12.38 m pipe stack on a deck in centimetres came out 12.38 cm long.
    it('builds a pipe stack in the deck\'s unit', () => {
      reset({ deck: { width: 800, length: 2000, unit: 'cm', gap: 10, boardOffset: 20, clearance: 0 } })
      section()
      fireEvent.click(screen.getByRole('button', { name: 'Каталог' }))
      const builder = screen.getByRole('group', { name: 'Конструктор штабеля' })
      fireEvent.change(within(builder).getByLabelText('Труб'), { target: { value: '7' } })
      fireEvent.click(within(builder).getByRole('button', { name: 'Добавить штабель' }))
      const stack = items()[0]
      expect(stack.shape).toBe('pipe-nest')
      expect(stack.length).toBeCloseTo(1238, 6)
      expect(stack.width).toBeCloseTo(800, 6)
      expect(stack.nest?.pipeLengthM).toBeCloseTo(12.38, 6)
      expect(stack.height).toBeCloseTo((stack.nest?.heightM ?? 0) * 100, 6)
    })
  })

  describe('a cargo of one\'s own', () => {
    it('adds the cargo from the short form, the weight in tonnes, and closes it', () => {
      section()
      fireEvent.click(screen.getByRole('button', { name: 'Свой груз' }))
      const form = screen.getByRole('form', { name: 'Свой груз' })
      fireEvent.change(within(form).getByLabelText('Название'), { target: { value: 'Генератор' } })
      fireEvent.change(within(form).getByLabelText('Длина'), { target: { value: '6,5' } })
      fireEvent.change(within(form).getByLabelText('Ширина'), { target: { value: '2.4' } })
      fireEvent.change(within(form).getByLabelText('Вес единицы, т'), { target: { value: '12,5' } })
      fireEvent.change(within(form).getByLabelText('Количество'), { target: { value: '3' } })
      fireEvent.change(within(form).getByLabelText('Категория'), { target: { value: 'Опасный груз' } })
      fireEvent.click(within(form).getByRole('button', { name: 'Добавить груз' }))
      expect(items()[0]).toMatchObject({ name: 'Генератор', length: 6.5, width: 2.4, height: 0, weight: 12500, quantity: 3, category: 'Опасный груз' })
      expect(screen.queryByRole('form', { name: 'Свой груз' })).toBeNull()
      expect(toast.success).toHaveBeenCalledWith('«Генератор» добавлен: 3 ед.')
      expect(useCalculator.getState().activeStampId).toBeNull()
    })

    it('names the cargo «Груз N» when the name is left empty, and arms it in manual mode', () => {
      reset({ mode: 'manual' })
      section()
      fireEvent.click(screen.getByRole('button', { name: 'Свой груз' }))
      fireEvent.click(within(screen.getByRole('form', { name: 'Свой груз' })).getByRole('button', { name: 'Добавить груз' }))
      expect(items()[0]).toMatchObject({ name: 'Груз 1', length: 1.2, width: 2, quantity: 1, weight: undefined })
      expect(useCalculator.getState().activeStampId).toBe(items()[0].id)
    })

    it('says what is wrong in the field and adds nothing', () => {
      section()
      fireEvent.click(screen.getByRole('button', { name: 'Свой груз' }))
      const form = screen.getByRole('form', { name: 'Свой груз' })
      fireEvent.change(within(form).getByLabelText('Длина'), { target: { value: '' } })
      fireEvent.change(within(form).getByLabelText('Количество'), { target: { value: '0' } })
      fireEvent.click(within(form).getByRole('button', { name: 'Добавить груз' }))
      expect(items()).toHaveLength(0)
      expect(within(form).getByLabelText('Длина').getAttribute('aria-invalid')).toBe('true')
      expect(within(form).getByText('Нужна длина больше 0')).toBeTruthy()
      expect(within(form).getByText('Не меньше 1')).toBeTruthy()
    })
  })

  describe('the compact list', () => {
    const cargo = { id: 'a', name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, quantity: 4, color: '#000', allowRotation: true, weight: 2200 }
    const stackOf = (layers: number): PlacedItem => ({
      itemId: 'a', name: 'Контейнер 20ft', x: 0, y: 0, width: 6.06, length: 2.44, height: 2.59, layers, stackedCount: layers, rotated: false, color: '#000', weight: 2200, index: 0,
    })

    it('shows the number, «размещено из всего» and the weight', () => {
      reset({ items: [cargo] })
      section({ placedAcrossTrips: [stackOf(1), stackOf(2)] })
      const row = screen.getByTestId('cargo-list-row')
      expect(within(row).getByTitle('Груз № 1')).toBeTruthy()
      expect(row).toHaveTextContent(/Размещено 3\s*из/)
      expect(row).toHaveTextContent('8.8 т')
      expect((within(row).getByLabelText('Всего, Контейнер 20ft') as HTMLInputElement).value).toBe('4')
    })

    it('changes «всего» in place: type, Enter', () => {
      reset({ items: [cargo] })
      section()
      const total = screen.getByLabelText('Всего, Контейнер 20ft')
      fireEvent.focus(total)
      fireEvent.change(total, { target: { value: '6' } })
      fireEvent.keyDown(total, { key: 'Enter' })
      expect(items()[0].quantity).toBe(6)
    })

    it('marks more on the deck than the list asks for', () => {
      reset({ items: [{ ...cargo, quantity: 1 }] })
      section({ placedAcrossTrips: [stackOf(2)] })
      const placed = within(screen.getByTestId('cargo-list-row')).getByTitle(/больше, чем всего/)
      expect(placed.textContent).toBe('Размещено 2 ⚠')
    })

    it('«Поставить» arms the cargo for a click on the deck and disarms it again', () => {
      reset({ items: [cargo] })
      section()
      const place = screen.getByRole('button', { name: 'Поставить «Контейнер 20ft»' })
      fireEvent.click(place)
      expect(useCalculator.getState().activeStampId).toBe('a')
      expect(place.getAttribute('aria-pressed')).toBe('true')
      fireEvent.click(place)
      expect(useCalculator.getState().activeStampId).toBeNull()
    })

    it('a hovered row lights up its stacks, and lights up from the deck', () => {
      reset({ items: [cargo] })
      const { onHover, view } = section()
      const row = screen.getByTestId('cargo-list-row')
      fireEvent.mouseEnter(row)
      expect(onHover).toHaveBeenLastCalledWith('a')
      fireEvent.mouseLeave(row)
      expect(onHover).toHaveBeenLastCalledWith(null)
      view.rerender(<CargoSection onOpenTable={vi.fn()} placedAcrossTrips={[]} hoveredItemId="a" onHover={onHover} onPlaceCustomShape={vi.fn()} />)
      expect(row.className).toContain('bg-accent')
    })

    it('«Таблица» opens the cargo table', () => {
      reset({ items: [cargo] })
      const { onOpenTable } = section()
      fireEvent.click(screen.getByRole('button', { name: 'Таблица' }))
      expect(onOpenTable).toHaveBeenCalled()
    })
  })

  it('a drawn outline asks for its name and weight, then is placed where it was drawn', () => {
    reset({ pendingCustomShape: { outline: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 3 }], width: 2, length: 3, x: 1, y: 1 } })
    const { onPlaceCustomShape } = section()
    const form = screen.getByRole('form', { name: 'Своя форма' })
    expect(form.textContent).toContain('2×3 м, S 3 м²')
    const place = within(form).getByRole('button', { name: 'Поставить на палубу' }) as HTMLButtonElement
    expect(place.disabled).toBe(true)
    fireEvent.change(within(form).getByLabelText('Название'), { target: { value: 'Кран-балка' } })
    fireEvent.change(within(form).getByLabelText('Вес, т'), { target: { value: '1,5' } })
    fireEvent.click(place)
    expect(onPlaceCustomShape).toHaveBeenCalledWith('Кран-балка', 1500)

    act(() => useCalculator.getState().setPendingCustomShape(null))
    expect(screen.queryByRole('form', { name: 'Своя форма' })).toBeNull()
  })
})
