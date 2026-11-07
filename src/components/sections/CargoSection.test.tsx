import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { toast } from 'sonner'
import { CargoSection } from './CargoSection'
import { clearCalculatorHistory, useCalculator } from '@/store/calculator'
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
const cleanupAndReset = (patch: Parameters<typeof reset>[0]) => {
  cleanup()
  reset(patch)
}
const catalogEntry = (name: RegExp) => within(screen.getByRole('region', { name: 'Каталог грузов' })).getAllByRole('button', { name })[0]

describe('CargoSection', () => {
  beforeEach(() => {
    reset()
    vi.spyOn(toast, 'success').mockImplementation(() => '')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Spec 2026-11-06, 13: a platform takes a vessel's trip as «приход».
  it('offers «С судна» on a platform only, and opens it above the list', () => {
    section()
    expect(screen.queryByRole('button', { name: 'С судна' })).toBeNull()
    cleanupAndReset({ deck: { width: 8, length: 20, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0, objectKind: 'semi-sub' } })
    section()
    expect(screen.getByText('Добавьте груз из каталога, свой или с судна')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'С судна' }))
    expect(screen.getByRole('button', { name: 'С судна' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: 'Груз с судна' })).toBeInTheDocument()
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
      // Between the board offsets (800 − 2 × 20), so it fits the deck.
      expect(stack.width).toBeCloseTo(760, 6)
      expect(stack.nest?.pipeLengthM).toBeCloseTo(12.38, 6)
      expect(stack.height).toBeCloseTo((stack.nest?.heightM ?? 0) * 100, 6)
    })
  })

  // Revision 2026-11-06: built as it came, a stack was as wide as the whole
  // deck and never fitted on it.
  it('builds a stack as wide as the room between the board offsets, and says when a typed one won\'t fit', () => {
    reset({ deck: { width: 8, length: 20, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 } })
    section()
    fireEvent.click(screen.getByRole('button', { name: 'Каталог' }))
    const builder = screen.getByRole('group', { name: 'Конструктор штабеля' })
    expect((within(builder).getByLabelText('Ширина, м') as HTMLInputElement).value).toBe('7.60')
    expect(within(builder).queryByText(/на палубу не встанет/)).toBeNull()
    fireEvent.change(within(builder).getByLabelText('Ширина, м'), { target: { value: '8' } })
    expect(within(builder).getByText('Шире места между отступами от борта (7.60 м) — на палубу не встанет')).toBeTruthy()
  })

  describe('a cargo of one\'s own', () => {
    it('adds the cargo from the short form, the weight in tonnes, and closes it', () => {
      section()
      fireEvent.click(screen.getByRole('button', { name: 'Свой груз' }))
      const form = screen.getByRole('form', { name: 'Свой груз' })
      fireEvent.change(within(form).getByLabelText('Название'), { target: { value: 'Генератор' } })
      fireEvent.change(within(form).getByLabelText('Вдоль'), { target: { value: '6,5' } })
      fireEvent.change(within(form).getByLabelText('Поперёк'), { target: { value: '2.4' } })
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
      fireEvent.change(within(form).getByLabelText('Вдоль'), { target: { value: '' } })
      fireEvent.change(within(form).getByLabelText('Количество'), { target: { value: '0' } })
      fireEvent.click(within(form).getByRole('button', { name: 'Добавить груз' }))
      expect(items()).toHaveLength(0)
      expect(within(form).getByLabelText('Вдоль').getAttribute('aria-invalid')).toBe('true')
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

    // Revision 2026-11-05: one button follows the cargo's state — a
    // «Поставить» that looked ready but placed nothing read as broken.
    describe('its button', () => {
      const byHand = (layers: number) => [
        { id: 'm1', itemId: 'a', name: 'Контейнер 20ft', x: 0, y: 0, width: 6.06, length: 2.44, layers, rotated: false, color: '#000', weight: 2200 },
      ]
      const allPlaced = () => ({ kind: 'all-placed' as const, text: 'Все 4 ед. груза «Контейнер 20ft» уже размещены — увеличьте «всего» в списке' })
      const buttons = () => within(screen.getByTestId('cargo-list-row')).queryAllByRole('button').map((b) => b.textContent)

      it('is «Поставить» while some of the cargo is still off the deck', () => {
        reset({ items: [cargo], mode: 'manual', manualPlacements: byHand(2) })
        section()
        expect(buttons()).toEqual(['Поставить'])
      })

      it('turns into «Убрать» once all of it is on the deck; that takes it off, with an undo in the toast', () => {
        reset({ items: [cargo], mode: 'manual', manualPlacements: byHand(4) })
        const { view } = section({ placeRefusal: allPlaced })
        expect(buttons()).toEqual(['Убрать'])
        fireEvent.click(screen.getByRole('button', { name: 'Убрать «Контейнер 20ft» с палубы' }))
        expect(useCalculator.getState().manualPlacements).toEqual([])
        expect(toast.success).toHaveBeenCalledWith(
          '«Контейнер 20ft» убран с палубы: 4 ед.',
          expect.objectContaining({ action: expect.objectContaining({ label: 'Отменить' }) })
        )
        // Off the deck, it can be placed again.
        view.rerender(<CargoSection onOpenTable={vi.fn()} placedAcrossTrips={[]} hoveredItemId={null} onHover={vi.fn()} onPlaceCustomShape={vi.fn()} />)
        expect(buttons()).toEqual(['Поставить'])
      })

      // Revision 2026-11-06: in auto mode the packer puts it on the deck by
      // itself, so the button follows that, not the user's own stacks alone.
      const stack = (x: number, layers: number): PlacedItem =>
        ({ itemId: 'a', name: 'Контейнер 20ft', x, y: 0.2, width: 6.06, length: 2.44, height: 2.59, layers, stackedCount: layers, rotated: false, color: '#000', weight: 2200, index: 0 }) as PlacedItem

      it('in auto mode, cargo the packer put on the deck offers «Закрепить»: every stack of it stays where it stands, with an undo', () => {
        reset({ items: [cargo], mode: 'auto' })
        const onDeck = [stack(0.2, 2), stack(7, 2)]
        section({ placedAcrossTrips: onDeck, placedByTrip: [onDeck] })
        expect(buttons()).toEqual(['Закрепить'])
        fireEvent.click(screen.getByRole('button', { name: 'Закрепить «Контейнер 20ft»' }))
        const pins = useCalculator.getState().pinnedPlacementsByTrip[0]
        expect(pins.map((p) => [p.x, p.y, p.layers, p.locked])).toEqual([
          [0.2, 0.2, 2, true],
          [7, 0.2, 2, true],
        ])
        expect(toast.success).toHaveBeenCalledWith(
          '«Контейнер 20ft» закреплён на месте: 4 ед.',
          expect.objectContaining({ action: expect.objectContaining({ label: 'Отменить' }) })
        )
      })

      it('in auto mode turns into «Открепить» as soon as any of it is the user\'s, though the packer placed the rest', () => {
        const mine = { ...byHand(1)[0], id: 'p1', x: 0.2, y: 0.2, locked: true }
        reset({ items: [cargo], mode: 'auto', pinnedPlacementsByTrip: { 0: [mine] } })
        const onDeck = [stack(0.2, 1), stack(7, 3)]
        section({ placedAcrossTrips: onDeck, placedByTrip: [onDeck] })
        expect(buttons()).toEqual(['Открепить'])
      })

      it('in auto mode «Закрепить» locks an applied variant\'s stacks as they are, adding none', () => {
        const variants = { ...byHand(4)[0], id: 'v1', x: 0.2, y: 0.2 }
        reset({ items: [cargo], mode: 'auto', pinnedPlacementsByTrip: { 0: [variants] } })
        const onDeck = [stack(0.2, 4)]
        section({ placedAcrossTrips: onDeck, placedByTrip: [onDeck] })
        fireEvent.click(screen.getByRole('button', { name: 'Закрепить «Контейнер 20ft»' }))
        expect(useCalculator.getState().pinnedPlacementsByTrip[0].map((p) => [p.id, p.locked])).toEqual([['v1', true]])
      })

      it('in auto mode is «Поставить» only while none of it is on the deck', () => {
        reset({ items: [cargo], mode: 'auto' })
        section()
        expect(buttons()).toEqual(['Поставить'])
      })

      it('in auto mode «Открепить» lets the user\'s stacks go back to the packer', () => {
        reset({ items: [{ ...cargo, quantity: 1 }], mode: 'auto', pinnedPlacementsByTrip: { 0: [{ ...byHand(1)[0], id: 'p1', locked: true }] } })
        section({ placeRefusal: allPlaced })
        fireEvent.click(screen.getByRole('button', { name: 'Открепить «Контейнер 20ft»' }))
        expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toEqual([])
        expect(toast.success).toHaveBeenCalledWith('«Контейнер 20ft» откреплён: 1 ед. разложит программа', expect.anything())
      })

      it('greys «Поставить» with the reason when nothing of it is the user\'s to take off, and a click says it instead of arming', () => {
        vi.spyOn(toast, 'error').mockImplementation(() => '')
        vi.spyOn(toast, 'warning').mockImplementation(() => '')
        reset({ items: [cargo], mode: 'manual' })
        const { view } = section({ placeRefusal: () => ({ kind: 'limit', text: 'Превышен лимит груза на палубе (10 т)' }) })
        const place = screen.getByRole('button', { name: 'Поставить «Контейнер 20ft»' })
        expect(place.getAttribute('aria-disabled')).toBe('true')
        expect(place.getAttribute('title')).toBe('Превышен лимит груза на палубе (10 т)')
        fireEvent.click(place)
        expect(useCalculator.getState().activeStampId).toBeNull()
        expect(toast.error).toHaveBeenCalledWith('Превышен лимит груза на палубе (10 т)')
        view.unmount()
        // All of it placed already, in manual mode by someone else's hand
        // (none of it the user's to take off): the reason, not a stamp.
        reset({ items: [cargo], mode: 'manual' })
        section({ placeRefusal: allPlaced })
        expect(buttons()).toEqual(['Поставить'])
        fireEvent.click(screen.getByRole('button', { name: 'Поставить «Контейнер 20ft»' }))
        expect(toast.warning).toHaveBeenCalledWith(allPlaced().text)
      })

      it('armed, «Поставить» is outlined in orange and a second click disarms it', () => {
        reset({ items: [cargo], mode: 'manual', activeStampId: 'a' })
        section()
        const place = screen.getByRole('button', { name: 'Поставить «Контейнер 20ft»' })
        expect(place.getAttribute('aria-pressed')).toBe('true')
        expect(place.className).toContain('border-primary')
        fireEvent.click(place)
        expect(useCalculator.getState().activeStampId).toBeNull()
        expect(place.className).not.toContain('border-primary')
      })
    })
  })

  // Revision 2026-11-06: a cargo that fits no trip has no stack to
  // right-click on the deck; its row's menu removes it.
  // Spec 2026-11-06, 6: a platform's cargo has a status; what leaves with
  // the vessel isn't on the plan and has nothing to place.
  describe('a platform\'s cargo', () => {
    const pipe = { id: 'p', name: 'Трубы', width: 12, length: 1, height: 1, quantity: 10, color: '#000', allowRotation: true, weight: 2000 }
    const box = { id: 'b', name: 'Контейнер', width: 6, length: 2.4, height: 2.6, quantity: 2, color: '#000', allowRotation: true, weight: 5000 }

    it('a vessel\'s list has no status; a platform\'s does, arriving by default', () => {
      reset({ items: [pipe] })
      const { view } = section()
      expect(screen.queryByRole('combobox', { name: 'Статус «Трубы»' })).toBeNull()
      view.unmount()
      reset({ items: [pipe], deck: { ...useCalculator.getState().deck, objectKind: 'fixed' } })
      section()
      const status = screen.getByRole('combobox', { name: 'Статус «Трубы»' }) as HTMLSelectElement
      expect(status.value).toBe('incoming')
      fireEvent.change(status, { target: { value: 'onboard' } })
      expect(items()[0].platformStatus).toBe('onboard')
    })

    it('cargo leaving is counted apart and has nothing to place', () => {
      reset({ items: [pipe, { ...box, platformStatus: 'outgoing' as const }], deck: { ...useCalculator.getState().deck, objectKind: 'semi-sub' } })
      section()
      expect(screen.getByTestId('cargo-status-summary').textContent).toBe('Приход: 10 ед., 20 т · Отгрузка: 2 ед., 10 т')
      const rows = screen.getAllByTestId('cargo-list-row')
      expect(within(rows[1]).getByText('Увозят')).toBeTruthy()
      expect(within(rows[1]).getByText('не на плане')).toBeTruthy()
      expect(within(rows[1]).queryByRole('button', { name: /Поставить/ })).toBeNull()
      expect(within(rows[0]).getByRole('button', { name: 'Поставить «Трубы»' })).toBeTruthy()
    })
  })

  describe('a row\'s right-click menu', () => {
    const cargo = { id: 'a', name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, quantity: 4, color: '#000', allowRotation: true, weight: 2200 }

    it('removes the cargo from the list, with an undo in the toast', () => {
      reset({ items: [cargo], activeStampId: 'a' })
      section()
      fireEvent.contextMenu(screen.getByTestId('cargo-list-row'), { clientX: 120, clientY: 200 })
      const menu = screen.getByRole('menu', { name: 'Действия с грузом «Контейнер 20ft»' })
      fireEvent.click(within(menu).getByRole('button', { name: 'Удалить груз' }))
      expect(items()).toEqual([])
      expect(useCalculator.getState().activeStampId).toBeNull()
      expect(screen.queryByRole('menu')).toBeNull()
      expect(toast.success).toHaveBeenCalledWith(
        'Груз «Контейнер 20ft» удалён',
        expect.objectContaining({ action: expect.objectContaining({ label: 'Отменить' }) })
      )
    })

    it('«Отменить» brings back the deleted cargo even when it was added a moment before', () => {
      // History merges edits made within 400 ms into one step; a delete is a
      // step of its own, or «Отменить» would undo the add with it.
      clearCalculatorHistory()
      section()
      fireEvent.click(screen.getByRole('button', { name: 'Каталог' }))
      fireEvent.click(catalogEntry(/^Контейнер 20ft/))
      fireEvent.contextMenu(screen.getByTestId('cargo-list-row'), { clientX: 120, clientY: 200 })
      fireEvent.click(screen.getByRole('button', { name: 'Удалить груз' }))
      expect(items()).toEqual([])
      const options = vi.mocked(toast.success).mock.calls.at(-1)?.[1] as unknown as { action: { onClick: () => void } }
      act(() => options.action.onClick())
      expect(items().map((i) => i.name)).toEqual(['Контейнер 20ft'])
    })

    it('closes on Escape, the focus back where it was, or on a click elsewhere; the quantity field keeps the browser\'s own menu', () => {
      reset({ items: [cargo] })
      section()
      const row = screen.getByTestId('cargo-list-row')
      // From the keyboard: the menu takes the focus, Esc gives it back.
      const button = within(row).getByRole('button', { name: 'Поставить «Контейнер 20ft»' })
      button.focus()
      fireEvent.contextMenu(button)
      expect(document.activeElement?.textContent).toBe('Удалить груз')
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(button)
      fireEvent.contextMenu(row, { clientX: 120, clientY: 200 })
      fireEvent.pointerDown(document.body)
      expect(screen.queryByRole('menu')).toBeNull()
      fireEvent.contextMenu(screen.getByLabelText('Всего, Контейнер 20ft'))
      expect(screen.queryByRole('menu')).toBeNull()
      expect(items()).toHaveLength(1)
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
