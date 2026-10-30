import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import Home from './page'
import { clearCalculatorHistory, redoCalculator, undoCalculator, useCalculator } from '@/store/calculator'
import { useProjects } from '@/store/projects'
import { buildPlanPdf, exportPlanPdf } from '@/lib/exportPdf'
import { ThemeProvider } from '@/components/ThemeProvider'
import { CARGO_INK, cargoToneForNumber } from '@/lib/cargoPalette'
import { SELECTION_HALO_WIDTH } from '@/components/calculator/deckMarks'
import { THEME_TOKENS } from '@/lib/theme'
import type { VesselStabilityData } from '@/lib/stability'

// The PDF itself needs a real canvas; tests check what the page hands over.
vi.mock('@/lib/exportPdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/exportPdf')>()),
  exportPlanPdf: vi.fn(async () => {}),
}))

// page.tsx's orchestration logic (handleRemovePinned, handleModeChange,
// handleRotatePinned/Manual, autosave, hover-throttle) has no dedicated
// export — it only exists as closures inside the Home component. These
// tests exercise it by rendering the real component and driving it through
// the DOM/store, the same way the manual browser verification did during
// development, but automated.

// The demo project auto-loaded on mount ships with ~22 pre-placed items;
// tests need a clean slate to seed their own scenario without the demo
// data's items/placements interfering with counts and array indices.
function clearDemoCargo() {
  act(() => {
    useCalculator.setState({
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      selectedPinIds: [],
      selectedManualIds: [],
    })
  })
}

// Text content of every SVG <text> node on the deck — scoped this way
// because plain labels like a category name ("Обычный") also appear
// elsewhere on the page (datalist options, other UI chrome), making a
// page-wide screen.getByText ambiguous.
function svgTextContents(): string[] {
  return Array.from(document.querySelectorAll('svg text')).map((el) => el.textContent ?? '')
}

// The category the inspector shows for a pinned stack. Stage 1 (spec 6.2)
// writes only numbers and names on stacks; the category moved here.
function inspectorCategoryOfPin(pinId: string): string | null {
  act(() => {
    useCalculator.setState({ selectedPinIds: [pinId], selectedAutoKeys: [] })
  })
  const inspector = screen.getByRole('complementary', { name: 'Инспектор' })
  return within(inspector).queryByText('Категория')?.nextElementSibling?.textContent ?? null
}

// The frame's sections (spec 5.3): the left panel shows one at a time.
function openSection(title: 'Судно' | 'Грузы' | 'Размещение' | 'Проверки' | 'Отчёт') {
  const nav = screen.getByRole('navigation', { name: 'Разделы' })
  fireEvent.click(within(nav).getByRole('button', { name: new RegExp(`^${title}`) }))
}

// A check in «Проверки» (spec 8.4), opened: its row, with what it found.
function openCheckRow(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-check="${id}"]`)!
  const button = row.querySelector('button')!
  if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button)
  return document.querySelector<HTMLElement>(`[data-check="${id}"]`)!
}

// A library vessel picked in «Судно» (spec 8.1); with cargo in the
// calculation the dialog asks how, and `how` answers.
function chooseVessel(label: string, how?: 'Новый расчёт с этим судном' | 'Заменить палубу в текущем (груз останется)') {
  fireEvent.click(screen.getByText(label))
  const dialog = screen.queryByRole('alertdialog')
  if (dialog && how) fireEvent.click(within(dialog).getByRole('button', { name: how }))
}

// A button of the mini-panel over the selected stack (spec 6.6).
function stackButton(name: string): HTMLElement {
  return within(screen.getByRole('toolbar', { name: 'Действия со штабелем' })).getByRole('button', { name })
}

// A button of the inspector, over the right of the deck (spec 6.5).
function inspectorButton(name: string | RegExp): HTMLElement {
  return within(screen.getByRole('complementary', { name: 'Инспектор' })).getByRole('button', { name })
}

// An item of the calculation's menu, top left.
function projectMenuItem(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /^Меню расчёта/ }))
  fireEvent.click(screen.getByRole('button', { name }))
}

// «Подобрать варианты» sits in «Размещение».
function clickAutoRedistribute() {
  openSection('Размещение')
  fireEvent.click(screen.getByRole('button', { name: 'Подобрать варианты' }))
}

// The list of variants under it, while it is shown.
function variantsList() {
  return screen.queryByRole('list', { name: 'Варианты раскладки' })
}

// The deck's width field, in «Судно».
function deckWidthInput(): HTMLInputElement {
  openSection('Судно')
  return screen.getByLabelText('Ширина (борт–борт)') as HTMLInputElement
}

function stubLocalStorage() {
  const storage: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v },
    removeItem: (k: string) => { delete storage[k] },
  } as Storage)
  return storage
}

describe('Home (page.tsx)', () => {
  beforeEach(() => {
    stubLocalStorage()
    useProjects.setState({ projects: [], activeId: null, hydrated: false })
    // The deck's tools are the page's state, not the calculation's: loading
    // a project doesn't disarm one a test left armed.
    useCalculator.setState({
      placingLashingPoint: false,
      placingPowerSocket: false,
      placingAnnotation: null,
      activeStampId: null,
      drawingCustomShape: false,
      editingDeckOutline: false,
      drawingRestrictionShape: null,
      drawingRestrictionZoneFreeform: false,
      deckPhotoTool: null,
    })
    vi.spyOn(toast, 'success').mockImplementation(() => '')
    vi.spyOn(toast, 'info').mockImplementation(() => '')
    vi.spyOn(toast, 'warning').mockImplementation(() => '')
    vi.spyOn(toast, 'error').mockImplementation(() => '')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // With site data blocked, touching window.localStorage throws — and the
  // intro/tour "seen" flags are read during render, so the whole app used to
  // be replaced by an error page. Closing the tour writes its flag, too.
  it('renders and lets the tour be closed when the browser blocks storage access', () => {
    const denied = () => { throw new DOMException('Access is denied for this document.', 'SecurityError') }
    vi.stubGlobal('localStorage', { getItem: denied, setItem: denied, removeItem: denied } as unknown as Storage)

    render(<Home />)
    expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить тур' }))
    expect(screen.queryByRole('button', { name: 'Пропустить тур' })).toBeNull()
  })

  // Stage 2: those who knew the interface before (they've seen the old tour,
  // so the new one doesn't start by itself) are told once where things are
  // now. A first visit gets the tour instead.
  it('tells a returning visitor once that the interface changed, and not a first-time one', () => {
    const storage = stubLocalStorage()
    storage['deckload-tour-seen'] = '1'
    const { unmount } = render(<Home />)
    expect(toast.info).toHaveBeenCalledWith('Интерфейс обновлён', expect.objectContaining({ description: 'Где что теперь — в «?» → «Пройти тур».' }))
    expect(storage['deckload-ui-update-hint-seen']).toBe('1')
    unmount()

    vi.mocked(toast.info).mockClear()
    render(<Home />)
    expect(toast.info).not.toHaveBeenCalledWith('Интерфейс обновлён', expect.anything())
  })

  it('does not tell a first-time visitor that the interface changed: the tour shows it', () => {
    const storage = stubLocalStorage()
    render(<Home />)
    expect(screen.getByRole('dialog', { name: 'Судно' })).toBeTruthy()
    expect(toast.info).not.toHaveBeenCalledWith('Интерфейс обновлён', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить тур' }))
    expect(storage['deckload-ui-update-hint-seen']).toBe('1')
  })

  // Phase 0, m1/m2/m5: labels showed the raw unit code («Шир. (m)», «20×8 m»)
  // while the rest of the app says «м»; the clearance field was called
  // «Высота над палубой (зазор)»; the project file buttons said «Скачать JSON»
  // and «Импортировать».
  it('labels use Russian unit symbols and the new names for the stack height limit and project file items', () => {
    render(<Home />)
    // The catalogue gives a cargo's size in the deck's unit, in Russian.
    fireEvent.click(screen.getByRole('button', { name: 'Каталог' }))
    const cargoText = document.body.textContent ?? ''
    expect(cargoText).not.toMatch(/\((m|cm|ft)\)/)
    expect(cargoText).toMatch(/6\.06×2\.44×2\.59 м/)

    fireEvent.click(screen.getByRole('button', { name: /^Меню расчёта/ }))
    expect(screen.getByRole('button', { name: 'Сохранить файл…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Открыть файл…' })).toBeTruthy()
    expect(screen.queryByText('Скачать JSON')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Все расчёты…' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(/8×20 м/)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    openSection('Судно')
    expect(screen.getByText('Предельная высота штабеля')).toBeTruthy()
    expect(document.body.textContent ?? '').not.toMatch(/\((m|cm|ft)\)/)
  })

  // Phase 0, L10: applying a vessel said nothing. Stage 2: the library is a
  // list in «Судно», which marks the vessel applied.
  it('applying a library vessel confirms the new calculation and marks the vessel', () => {
    render(<Home />)
    openSection('Судно')
    chooseVessel('Алексей Кузнецов (IMO 9692648)', 'Новый расчёт с этим судном')
    expect(toast.success).toHaveBeenCalledWith('Создан расчёт для «Алексей Кузнецов (IMO 9692648)»')
    expect(screen.getByText('применено')).toBeTruthy()
  })

  // Stage 4, group C (spec 8.1): a library vessel goes onto the open
  // calculation — straight away without cargo, by choice with it.
  describe('a library vessel on the open calculation', () => {
    it('without cargo it is applied, and a calculation named as created takes its name', () => {
      render(<Home />)
      act(() => {
        useProjects.getState().createProject()
      })
      const id = useProjects.getState().activeId!
      expect(useProjects.getState().projects.find((p) => p.id === id)!.name).toMatch(/^Расчёт \d+$/)
      openSection('Судно')
      fireEvent.click(screen.getByText('Коммандер (IMO 9340609)'))
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(useCalculator.getState().deck).toMatchObject({ vesselTemplateId: 'olympic-commander', width: 16, length: 51 })
      expect(useProjects.getState().activeId).toBe(id)
      expect(useProjects.getState().projects.find((p) => p.id === id)!.name).toBe('Коммандер (IMO 9340609)')
      expect(toast.success).toHaveBeenCalledWith('Судно «Коммандер (IMO 9340609)» применено', expect.anything())
    })

    it('the vessel card: the limits, the cargo limit changed and cleared, where the data comes from', () => {
      render(<Home />)
      openSection('Судно')
      const value = (term: string) => screen.getByText(term).nextElementSibling!.textContent
      expect(screen.getByTestId('vessel-name').textContent).toBe('Своя палуба')
      expect(value('Данные остойчивости')).toBe('не заданы')
      chooseVessel('Алексей Кузнецов (IMO 9692648)', 'Заменить палубу в текущем (груз останется)')
      expect(screen.getByTestId('vessel-name').textContent).toBe('Алексей Кузнецов (IMO 9692648)')
      expect(value('Вместимость 10-футовых контейнеров')).toBe('14')
      expect(value('Предельная высота штабеля по данным судна')).toBe('3 м')
      expect(value('Направление носа')).toBe('из данных судна')
      const limit = screen.getByLabelText('Наибольший вес груза на палубе') as HTMLInputElement
      expect(limit.value).toBe('2550')
      fireEvent.change(limit, { target: { value: '2000' } })
      fireEvent.keyDown(limit, { key: 'Enter' })
      expect(useCalculator.getState().deck.maxDeckCargoT).toBe(2000)
      fireEvent.change(limit, { target: { value: '' } })
      fireEvent.keyDown(limit, { key: 'Enter' })
      expect(useCalculator.getState().deck.maxDeckCargoT).toBeUndefined()
      expect(screen.getByTestId('vessel-note').textContent).toMatch(/^ОЦЕНКА: длина палубы/)
    })

    it('with cargo it replaces the deck, keeps the cargo, drops what was tied to the old deck — and one undo brings it all back', () => {
      render(<Home />)
      const before = useCalculator.getState()
      act(() => {
        useCalculator.getState().pinFromPlaced(0, { ...before.items[0], itemId: before.items[0].id, x: 0, y: 0, layers: 1, rotated: false, locked: true })
        useCalculator.getState().addLashingPoint({ x: 1, y: 1 })
        clearCalculatorHistory()
      })
      const deckBefore = useCalculator.getState().deck
      openSection('Судно')
      fireEvent.click(screen.getByText('Алексей Кузнецов (IMO 9692648)'))
      const dialog = screen.getByRole('alertdialog')
      expect([...within(dialog).getByRole('list', { name: 'Будет удалено' }).querySelectorAll('li')].map((li) => li.textContent)).toEqual([
        '1 точка крепления',
        '1 закрепление',
      ])
      fireEvent.click(within(dialog).getByRole('button', { name: 'Заменить палубу в текущем (груз останется)' }))
      const after = useCalculator.getState()
      expect(after.items).toBe(before.items)
      expect(after.deck).toMatchObject({ vesselTemplateId: 'aleksey-kuznetsov', width: 16.9, length: 49.1, clearance: 3, maxDeckCargoT: 2550 })
      expect(after.deck.lashingPoints).toBeUndefined()
      expect(after.pinnedPlacementsByTrip).toEqual({})
      act(() => undoCalculator())
      expect(useCalculator.getState().deck).toEqual(deckBefore)
      expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)
    })
  })

  // Stage 1 (m6): there was no dark theme.
  it('the theme picked in «Вид» applies to the page and is remembered in this browser', () => {
    render(
      <ThemeProvider>
        <Home />
      </ThemeProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Вид' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Тёмная' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('deckload-theme')).toBe('dark')
    fireEvent.click(screen.getByRole('radio', { name: 'Светлая' }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('deckload-theme')).toBe('light')
    fireEvent.click(screen.getByRole('radio', { name: 'Как в системе' }))
    expect(localStorage.getItem('deckload-theme')).toBeNull()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  // Stage 2 (spec 6.3, 6.10): every mark the deck draws is explained in
  // «Вид» → «Условные обозначения».
  it('«Вид» explains the marks of the deck and goes back to its settings', () => {
    render(<Home />)
    fireEvent.click(screen.getByRole('button', { name: 'Вид' }))
    fireEvent.click(screen.getByRole('button', { name: 'Условные обозначения' }))
    const stacks = screen.getByRole('region', { name: 'Штабели' })
    const deck = screen.getByRole('region', { name: 'Палуба' })
    expect(within(stacks).getByText('Закреплён: авторасстановка его не двигает')).toBeTruthy()
    expect(within(stacks).getByText('Перегружена зона нагрузки под штабелем')).toBeTruthy()
    expect(within(deck).getByText('Свободное место внутри отступа от борта')).toBeTruthy()
    expect(within(deck).getByText('Розетка')).toBeTruthy()
    // The samples are the deck's own marks: the lock badge, the ×N badge.
    const sample = (key: string) => document.querySelector(`[data-legend-entry="${key}"] svg`)!
    expect(sample('locked').querySelector('[data-mark="lock"]')).toBeTruthy()
    expect(sample('lashing-short-stack').querySelector('[data-mark="lashing-short"]')).toBeTruthy()
    expect(sample('unknown-makeup').querySelector('[data-mark="unknown-makeup"]')).toBeTruthy()
    expect(sample('layers').textContent).toContain('×3')
    expect(screen.queryByRole('switch', { name: 'Сетка' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Назад к настройкам вида' }))
    expect(screen.getByRole('switch', { name: 'Сетка' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Штабели' })).toBeNull()
  })

  it('the canvas tools come in the order of the spec, each with a name', () => {
    render(<Home />)
    const tools = screen.getByRole('button', { name: 'Вписать' }).parentElement!
    expect(within(tools).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Уменьшить',
      'Увеличить',
      'Вписать',
      'Линейка',
    ])
  })

  // Stage 1 (spec 6.2): a stack is labelled with its cargo number — «×N» for
  // its units — and the name only where it fits whole; «Названия грузов»
  // turns the names off, never the numbers.
  it('labels stacks with their cargo numbers, and the names toggle leaves the numbers', () => {
    render(<Home />)
    const deckSvg = () => document.querySelector('svg[data-deck-plan]')!
    const stacks = () => Array.from(deckSvg().querySelectorAll('g[data-cargo-placement]'))
    expect(stacks().length).toBeGreaterThan(0)
    const numbersOf = (g: Element) => g.getAttribute('data-stack-text')!.split(' ')[0]
    const { items } = useCalculator.getState()
    for (const g of stacks()) {
      const name = g.getAttribute('data-cargo-name')!
      expect(numbersOf(g)).toBe(String(items.findIndex((it) => it.name === name) + 1))
      expect(g.querySelector('[data-stack-label="own"]')?.textContent).toMatch(/^\d+( ×\d+)?$/)
    }
    const named = () => Array.from(deckSvg().querySelectorAll('g[data-cargo-placement] text')).filter((t) => items.some((it) => it.name === t.textContent))
    expect(named().length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Вид' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Названия грузов' }))
    expect(named()).toHaveLength(0)
    expect(stacks().every((g) => g.querySelector('[data-stack-label="own"]'))).toBe(true)
  })

  it('shows the number of a stack too small for it when the stack is selected', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 40, length: 100 } })
      useCalculator.getState().addItem({ name: 'Болт', width: 0.1, length: 0.1, height: 0.1, quantity: 3 })
    })
    const bolt = useCalculator.getState().items.find((it) => it.name === 'Болт')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'b', itemId: bolt.id, name: 'Болт', x: 20, y: 50, width: 0.1, length: 0.1, layers: 3, rotated: false, color: bolt.color,
      })
    })
    const label = () => document.querySelector('svg[data-deck-plan] [data-stack-label="over"]')
    expect(document.querySelector('svg[data-deck-plan] [data-stack-label="own"]')).toBeNull()
    expect(label()).toBeNull()
    act(() => {
      useCalculator.setState({ selectedManualIds: ['b'] })
    })
    expect(label()?.textContent).toBe('1 ×3')
  })

  // Stage 2 (spec 6.3): the selected stack is outlined twice — its own dark
  // line and an accent band outside it. The PDF draws the plan from the
  // calculation (spec 11), so nothing selected on screen reaches it.
  it('outlines the selected stack with a dark line and an accent band, and leaves the selection out of the PDF', async () => {
    vi.mocked(exportPlanPdf).mockClear()
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 1 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'a', itemId: itemA.id, name: 'A', x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: itemA.color,
      })
      useCalculator.setState({ selectedManualIds: ['a'] })
    })
    const screenSvg = document.querySelector('svg[data-deck-plan]')!
    const halo = screenSvg.querySelector('[data-selection-halo] rect')!
    expect(halo.getAttribute('stroke')).toBe(THEME_TOKENS.light.accent)
    expect(halo.getAttribute('stroke-width')).toBe(String(SELECTION_HALO_WIDTH))
    const ownLine = screenSvg.querySelector('[data-selection-halo]')!.nextElementSibling!
    expect(ownLine.getAttribute('stroke')).toBe(CARGO_INK)
    expect(ownLine.getAttribute('stroke-width')).toBe('2')

    fireEvent.click(screen.getByRole('button', { name: /Скачать PDF/ }))
    await waitFor(() => expect(exportPlanPdf).toHaveBeenCalled())
    const sheet = buildPlanPdf(vi.mocked(exportPlanPdf).mock.calls[0][0]).trips[0]
    expect(sheet.cargo.map((r) => r.cells[1])).toEqual(['A'])
    const colours = sheet.drawing.shapes.flatMap((s) => ('stroke' in s && s.stroke ? [s.stroke.color] : []))
    expect(colours).not.toContain(THEME_TOKENS.light.accent)
    expect(screenSvg.querySelector('[data-selection-halo]')).toBeTruthy()
  })

  // Spec 6.3: stacks closer than a separation rule allows are joined by a
  // dashed line saying how far apart they are of how far they must be.
  it('joins stacks that break a separation rule with a dashed line and the distance', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10 } })
      useCalculator.getState().addItem({ name: 'Газ', width: 1, length: 1, height: 1, quantity: 1, category: 'Опасный груз' })
      useCalculator.getState().addItem({ name: 'Еда', width: 1, length: 1, height: 1, quantity: 1, category: 'Провизия' })
      useCalculator.getState().addSeparationRule({ categoryA: 'Опасный груз', categoryB: 'Провизия', minDistance: 3 })
    })
    const gas = useCalculator.getState().items.find((it) => it.name === 'Газ')!
    const food = useCalculator.getState().items.find((it) => it.name === 'Еда')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'gas', itemId: gas.id, name: 'Газ', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: gas.color,
      })
      useCalculator.getState().addManualPlacement({
        id: 'food', itemId: food.id, name: 'Еда', x: 3.5, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: food.color,
      })
    })
    const separation = document.querySelector('svg[data-deck-plan] [data-separation]')!
    expect(separation.textContent).toBe('1.5 м из 3 м')
    expect(separation.querySelector('line')!.getAttribute('stroke-dasharray')).toBeTruthy()

    act(() => {
      useCalculator.getState().updateManualPlacement('food', { x: 6 })
    })
    expect(document.querySelector('svg[data-deck-plan] [data-separation]')).toBeNull()
  })

  // Stage 1 (spec 6.3): a stack whose lashing falls short wears an amber
  // chain; one an old file merged without keeping its make-up, «?».
  it('marks a stack whose lashing falls short with a chain, and one of unknown make-up with «?»', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10 } })
      useCalculator.getState().addItem({ name: 'Блок', width: 2, length: 2, height: 1, quantity: 2, weight: 20000 })
    })
    const block = useCalculator.getState().items.find((it) => it.name === 'Блок')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'a', itemId: block.id, name: 'Блок', x: 1, y: 1, width: 2, length: 2, layers: 1, rotated: false, color: block.color,
      })
      useCalculator.getState().addManualPlacement({
        id: 'b', itemId: block.id, name: 'Блок', x: 6, y: 6, width: 2, length: 2, layers: 1, rotated: false, color: block.color,
        legacyUnknownComposition: true,
      })
    })
    const stack = (id: string) => document.querySelector(`svg[data-deck-plan] g[data-stack-key="m-${id}"]`)!
    expect(stack('a').querySelector('[data-mark="lashing-short"]')).toBeNull()
    expect(stack('b').querySelector('[data-mark="unknown-makeup"]')).toBeTruthy()
    expect(stack('a').querySelector('[data-mark="unknown-makeup"]')).toBeNull()

    // One 100 kg lashing can't hold 20 t.
    act(() => {
      useCalculator.getState().addLashingPoint({ x: 0.5, y: 0.5, placementId: 'a', cornerX: 1, cornerY: 1, mslKg: 100, verticalAngleDeg: 45 })
    })
    expect(stack('a').querySelector('[data-mark="lashing-short"]')).toBeTruthy()
    expect(stack('b').querySelector('[data-mark="lashing-short"]')).toBeNull()
  })

  // Spec 6.3: a load zone carrying more than its limit is hatched red and
  // says how much it carries; the stacks on it get «!» and a red outline.
  it('hatches a load zone over its limit, writes its load, and marks the stacks on it', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10 } })
      useCalculator.getState().addItem({ name: 'Блок', width: 2, length: 2, height: 1, quantity: 1, weight: 8000 })
      useCalculator.getState().addLoadZone({ x: 0, y: 0, width: 4, length: 4, maxLoadPerArea: 1 })
    })
    const block = useCalculator.getState().items.find((it) => it.name === 'Блок')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'a', itemId: block.id, name: 'Блок', x: 1, y: 1, width: 2, length: 2, layers: 1, rotated: false, color: block.color, weight: 8000,
      })
    })
    const zone = () => document.querySelector('svg[data-deck-plan] [data-load-zone]')!
    const zoneLabel = () => document.querySelector('svg[data-deck-plan] [data-load-zone-label]')!
    const stack = () => document.querySelector('svg[data-deck-plan] g[data-stack-key="m-a"]')!
    // 8 t over 16 m² is 0.5 t/m², under 1.
    expect(zone().getAttribute('data-load-zone')).toBe('ok')
    expect(zoneLabel().textContent).toBe('1 т/м²')
    expect(stack().querySelector('[data-mark="overload"]')).toBeNull()

    act(() => {
      useCalculator.getState().updateLoadZone(useCalculator.getState().deck.loadZones![0].id, { maxLoadPerArea: 0.25 })
    })
    expect(zone().getAttribute('data-load-zone')).toBe('overloaded')
    expect(zoneLabel().textContent).toBe('0.5 из 0.25 т/м²')
    // Over the stacks, so a stack in the zone's corner doesn't cut it.
    expect(zoneLabel().compareDocumentPosition(stack()) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(zone().querySelector('rect')!.getAttribute('fill')).toBe('url(#overload-hatch)')
    expect(stack().querySelector('[data-mark="overload"]')).toBeTruthy()
  })

  // Spec 6.3: a merged stack holding a cargo that mustn't turn says so in
  // the inspector, on a disabled «Повернуть» with a crossed-out arrow.
  it('says in the inspector why a merged stack can\'t turn', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, allowRotation: true })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 5, allowRotation: true })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: 'A', x: 1, y: 1, width: 2, length: 1, layers: 2, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, { rotationLocked: true })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })
    const panel = within(screen.getByRole('complementary', { name: 'Инспектор' }))
    expect(inspectorButton('Повернуть')).toHaveProperty('disabled', true)
    expect(inspectorButton('Повернуть').getAttribute('aria-describedby')).toBe('inspector-rotate-reason')
    expect(panel.getByText('Штабель объединён с грузом, который не разрешает поворот')).toBeTruthy()

    act(() => {
      const pin = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()[0]
      useCalculator.getState().updatePinned(0, pin.id, { rotationLocked: false })
    })
    expect(inspectorButton('Повернуть')).toHaveProperty('disabled', false)
    expect(panel.queryByText(/не разрешает поворот/)).toBeNull()
  })

  // Stage 3, group B (spec 7.5): what isn't cargo moved from «Пресеты» to
  // «Судно» — obstacles, sockets and marks.
  it('keeps the obstacles, sockets and marks in «Судно», each tool on until pressed again', () => {
    render(<Home />)
    act(() => {
      useCalculator.setState({
        deck: {
          ...useCalculator.getState().deck,
          restrictionZones: [{ id: 'z', name: 'Кран', shapeType: 'rect', x: 1, y: 1, width: 2, length: 3 }],
          powerSockets: [{ id: 's', x: 0, y: 5 }],
          annotations: [{ id: 'a', x: 4, y: 4, text: 'Трап', leaderX: 2, leaderY: 2 }],
        },
      })
    })
    openSection('Судно')
    const obstacles = within(screen.getByRole('list', { name: 'Препятствия на палубе' }))
    fireEvent.change(obstacles.getByLabelText('Ширина «Кран», м'), { target: { value: '2,5' } })
    fireEvent.keyDown(obstacles.getByLabelText('Ширина «Кран», м'), { key: 'Enter' })
    expect(useCalculator.getState().deck.restrictionZones![0].width).toBe(2.5)
    const rect = within(screen.getByRole('group', { name: 'Нарисовать препятствие' })).getByRole('button', { name: 'Прямоугольник' })
    fireEvent.click(rect)
    expect(useCalculator.getState().drawingRestrictionShape).toBe('rect')
    expect(rect.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(rect)
    expect(useCalculator.getState().drawingRestrictionShape).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Поставить розетку' }))
    expect(useCalculator.getState().placingPowerSocket).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Удалить розетку 1' }))
    expect(useCalculator.getState().deck.powerSockets).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Со сноской' }))
    expect(useCalculator.getState().placingAnnotation).toEqual({ kind: 'note', withLeader: true })
    const text = screen.getByLabelText('Текст метки 1')
    fireEvent.change(text, { target: { value: 'Трап к шлюпке' } })
    fireEvent.keyDown(text, { key: 'Enter' })
    expect(useCalculator.getState().deck.annotations![0].text).toBe('Трап к шлюпке')
    fireEvent.click(screen.getByRole('button', { name: 'Без сноски' }))
    expect(useCalculator.getState().deck.annotations![0].leaderX).toBeUndefined()
    fireEvent.click(obstacles.getByRole('button', { name: 'Удалить препятствие «Кран»' }))
    expect(useCalculator.getState().deck.restrictionZones).toEqual([])
  })

  // Stage 3, group A (spec 7.4, 5.4): the cargo table across the bottom,
  // edited like a spreadsheet.
  describe('the cargo table', () => {
    const openTable = () => {
      openSection('Грузы')
      fireEvent.click(screen.getByRole('button', { name: 'Таблица' }))
      return within(screen.getByRole('region', { name: 'Таблица грузов' }))
    }
    const type = (input: HTMLElement, value: string, key = 'Enter') => {
      fireEvent.change(input, { target: { value } })
      fireEvent.keyDown(input, { key })
    }
    const seed = () =>
      act(() => {
        useCalculator.getState().addItem({ name: 'Ящик', width: 2, length: 3, height: 1, quantity: 4, weight: 1000 })
        useCalculator.getState().addItem({ name: 'Бочка', width: 1, length: 1, height: 1, quantity: 2, weight: 500 })
      })

    it('opens from «Грузы» and from the status line, and Esc in it closes it', () => {
      render(<Home />)
      const table = openTable()
      expect(table.getByRole('table', { name: 'Таблица грузов' })).toBeTruthy()
      fireEvent.keyDown(table.getByRole('button', { name: 'Свернуть таблицу грузов' }), { key: 'Escape' })
      expect(screen.queryByRole('region', { name: 'Таблица грузов' })).toBeNull()
      const handle = within(screen.getByRole('status', { name: 'Итог расчёта' })).getByRole('button', { name: /Таблица грузов/ })
      fireEvent.click(handle)
      expect(screen.getByRole('region', { name: 'Таблица грузов' })).toBeTruthy()
      expect(handle.getAttribute('aria-expanded')).toBe('true')
    })

    it('edits a cell with Enter, which moves to the same cell of the next row', async () => {
      render(<Home />)
      clearDemoCargo()
      seed()
      const table = openTable()
      expect(table.getAllByTestId('cargo-placed')[0].textContent).toMatch(/^4 из 4\d+ штабел/)
      const first = table.getByLabelText('Количество, Ящик')
      first.focus()
      type(first, '6')
      expect(useCalculator.getState().items[0].quantity).toBe(6)
      expect(table.getAllByTestId('cargo-placed')[0].textContent).toMatch(/^6 из 6/)
      await waitFor(() => expect(document.activeElement).toBe(table.getByLabelText('Количество, Бочка')))
    })

    it('lets height and weight be emptied — «not given» — and says why a value was pulled back', () => {
      render(<Home />)
      clearDemoCargo()
      seed()
      const table = openTable()
      type(table.getByLabelText('Вес единицы, т, Ящик'), '')
      expect(useCalculator.getState().items[0].weight).toBeUndefined()
      type(table.getByLabelText('Высота, Ящик'), '')
      expect(useCalculator.getState().items[0].height).toBe(0)
      type(table.getByLabelText('Вес единицы, т, Бочка'), '1,5')
      expect(useCalculator.getState().items[1].weight).toBe(1500)
      type(table.getByLabelText('Количество, Бочка'), '0')
      expect(useCalculator.getState().items[1].quantity).toBe(1)
      expect(table.getByRole('alert').textContent).toBe('Не меньше 1')
    })

    it('selects a range with Shift, gives it one category, and deletes it with «Отменить» in the notice', async () => {
      render(<Home />)
      clearDemoCargo()
      seed()
      act(() => {
        useCalculator.getState().addItem({ name: 'Паллета', width: 1.2, length: 0.8, height: 1, quantity: 1, weight: 400 })
      })
      // Edits within 400 ms are one step of the history: let the seeding
      // settle into a step of its own.
      await act(() => new Promise((r) => setTimeout(r, 450)))
      const table = openTable()
      fireEvent.click(table.getByLabelText('Выбрать «Ящик»'))
      fireEvent.click(table.getByLabelText('Выбрать «Паллета»'), { shiftKey: true })
      const selection = within(table.getByRole('group', { name: 'Выбранные грузы' }))
      expect(selection.getByText('Выбрано: 3')).toBeTruthy()
      fireEvent.change(selection.getByLabelText('Новая категория выбранных грузов'), { target: { value: 'Опасный груз' } })
      fireEvent.click(selection.getByRole('button', { name: 'Сменить категорию' }))
      expect(useCalculator.getState().items.map((it) => it.category)).toEqual(['Опасный груз', 'Опасный груз', 'Опасный груз'])
      await act(() => new Promise((r) => setTimeout(r, 450)))

      fireEvent.click(selection.getByRole('button', { name: 'Удалить' }))
      expect(useCalculator.getState().items).toEqual([])
      expect(toast.info).toHaveBeenCalledWith('Удалено грузов: 3', expect.objectContaining({ action: expect.objectContaining({ label: 'Отменить' }) }))
      const undo = vi.mocked(toast.info).mock.calls.at(-1)![1] as unknown as { action: { onClick: () => void } }
      act(() => undo.action.onClick())
      expect(useCalculator.getState().items.map((it) => it.name)).toEqual(['Ящик', 'Бочка', 'Паллета'])
    })

    it('opens «Дополнительно» with the centre-of-gravity corrections, the stack height and, for pipes, the water', () => {
      render(<Home />)
      clearDemoCargo()
      act(() => {
        useCalculator.getState().addItem({ name: 'Труба', width: 12, length: 0.5, height: 0.5, quantity: 3, weight: 2000, shape: 'cylinder' })
      })
      const table = openTable()
      fireEvent.click(table.getByRole('button', { name: 'Дополнительно: Труба' }))
      type(table.getByLabelText('VCG над палубой, м'), '1,2')
      expect(useCalculator.getState().items[0].stabilityOverride).toEqual({ vcgAboveDeckM: 1.2 })
      type(table.getByLabelText('Предельная высота штабеля, м'), '2')
      expect(useCalculator.getState().items[0].maxStackHeightM).toBe(2)
      expect(table.getByText('Без внутреннего диаметра вода в трубах не считается')).toBeTruthy()
      type(table.getByLabelText('Вода в трубах, т (на 1 шт.)'), '0,4')
      expect(table.getByText('Вода: 0.40 × 3 = 1.20 т — вместо расчёта')).toBeTruthy()
      fireEvent.click(table.getByRole('button', { name: 'Сбросить поправки' }))
      expect(useCalculator.getState().items[0].stabilityOverride).toBeUndefined()
    })

    it('sums the units, the weight and the area, and says what has no weight', () => {
      render(<Home />)
      clearDemoCargo()
      seed()
      act(() => {
        useCalculator.getState().addItem({ name: 'Без веса', width: 1, length: 1, height: 1, quantity: 1 })
      })
      const table = openTable()
      expect(table.getByTestId('cargo-totals').textContent).toBe('Итого: 7 единиц · 5 т (без веса: 1) · 27 м²')
    })
  })

  // Stage 2a (spec 2026-10-24, 6.1, 6.2, 8): the stability workspace opens
  // in the deck's place from «Судно», edits the vessel's data and shows the
  // open trip judged against the booklet at departure and at arrival.
  describe('the stability workspace', () => {
    // 1000 t lightship at KG 5 and 500 t of ballast at 1 m, pressed full:
    // 1500 t, KG 3.667, KM 8 — GM 4.33 m, a draught of 3 m, no trim.
    const vessel = (): VesselStabilityData => ({
      particulars: {
        name: 'Проба',
        lengthBpp: 60,
        breadth: 14,
        lightshipWeightKg: 1_000_000,
        lightshipKG: 5,
        lightshipLCG: 30,
        lightshipTCG: 0,
        longitudinalOrigin: 'aft-perpendicular',
        maxDraftM: 5,
        loadLineLengthM: 60,
        windageAreaM2: 1500,
        windageLeverM: 8,
        otherExposedDeckAreaM2: 0,
      },
      hydrostatics: {
        points: [
          { displacementKg: 1_000_000, draftM: 2, KM: 8, LCB: 30, LCF: 30, MTC: 50 },
          { displacementKg: 3_000_000, draftM: 6, KM: 8, LCB: 30, LCF: 30, MTC: 50 },
        ],
      },
      variableWeights: [{ id: 'b', name: 'Балласт', weightKg: 500_000, vcgM: 1, tcgM: 0, lcgM: 30, freeSurfaceMomentTm: 0 }],
    })
    const seedVessel = () =>
      act(() => {
        useCalculator.setState({
          deck: {
            ...useCalculator.getState().deck,
            vessel: vessel(),
            vesselTemplateId: undefined,
            icing: false,
            shipFrame: { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 30, heightAboveBaselineM: 6 },
            deckForwardIsPositiveY: true,
          },
        })
      })
    const openWorkspace = () => {
      openSection('Судно')
      fireEvent.click(screen.getByRole('button', { name: 'Открыть остойчивость' }))
      return screen.getByTestId('stability-workspace')
    }
    const shownState = () => screen.getByTestId('stability-state')
    const gm = () => Number(screen.getByTestId('stability-gm').textContent!.replace(' м', ''))
    const group = (title: string) => within(screen.getByText(title, { selector: 'summary span' }).closest('details')!)
    const showState = (state: 'Отход' | 'Приход') =>
      fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Результат для состояния' })).getByRole('radio', { name: new RegExp(`^${state}`) }))

    it('opens from «Судно» in the deck\'s place and goes back with Esc or «К палубе»', () => {
      render(<Home />)
      openSection('Судно')
      expect(screen.getByTestId('vessel-stability-summary').textContent).toBe('Нет данных судна')
      const workspace = openWorkspace()
      expect(document.querySelector('svg[data-deck-plan]')).toBeNull()
      expect(within(workspace).getByRole('heading', { name: 'Остойчивость' })).toBeTruthy()
      // The disclaimer is always there.
      expect(screen.getByText('Оценка по введённым данным. Не заменяет одобренную Информацию об остойчивости и прибор загрузки судна.')).toBeTruthy()

      // Esc in a field is the field's own; on the page it goes back.
      const lbp = screen.getByLabelText('Длина LBP, м')
      lbp.focus()
      fireEvent.keyDown(lbp, { key: 'Escape' })
      expect(screen.getByTestId('stability-workspace')).toBeTruthy()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(screen.queryByTestId('stability-workspace')).toBeNull()
      expect(document.querySelector('svg[data-deck-plan]')).toBeTruthy()

      openWorkspace()
      fireEvent.click(screen.getByRole('button', { name: 'К палубе' }))
      expect(screen.queryByTestId('stability-workspace')).toBeNull()
    })

    it('passes once the booklet\'s limit is pasted, and fails when heavy cargo goes on high', () => {
      render(<Home />)
      clearDemoCargo()
      seedVessel()
      openWorkspace()
      expect(gm()).toBeCloseTo(4.33, 2)
      expect(shownState().dataset.verdict).toBe('warn')
      expect(within(shownState()).getByText('Предел по формуляру не задан')).toBeTruthy()

      const limit = group('Предел по формуляру')
      fireEvent.click(limit.getByRole('button', { name: 'Вставить текстом' }))
      fireEvent.change(limit.getByLabelText('Предел по формуляру: текст для вставки'), { target: { value: '2;1\n6;1' } })
      fireEvent.click(limit.getByRole('button', { name: 'Вставить' }))
      expect(useCalculator.getState().deck.vessel!.limit).toEqual({ kind: 'min-gm-by-draft', rows: [{ arg: 2, value: 1 }, { arg: 6, value: 1 }], source: undefined })
      expect(shownState().dataset.verdict).toBe('ok')
      expect(within(shownState()).getByText('Предел по формуляру 1.00 м при осадке 3.00 м')).toBeTruthy()
      openSection('Судно')
      expect(screen.getByTestId('vessel-stability-summary').textContent).toContain('Выполнено по формуляру')

      // 500 t with its centre 30 m above the keel: KG (5500 + 15000)/2000
      // = 10.25 — GM under nought.
      act(() => {
        useCalculator.getState().addItem({ name: 'Тяжёлый', width: 2, length: 2, height: 2, quantity: 1, weight: 500_000, stabilityOverride: { vcgAboveDeckM: 24 } })
      })
      expect(shownState().dataset.verdict).toBe('error')
      expect(gm()).toBeCloseTo(-2.25, 2)
    })

    it('adds the ice to the arrival when icing is on: KG up, GM down', () => {
      render(<Home />)
      clearDemoCargo()
      seedVessel()
      openWorkspace()
      showState('Приход')
      const before = gm()
      expect(screen.getByText('Приход совпадает с отходом: своих танков у прихода нет, обледенение не учитывается.')).toBeTruthy()

      fireEvent.click(screen.getByRole('switch', { name: 'Учитывать обледенение' }))
      expect(useCalculator.getState().deck.icing).toBe(true)
      expect(gm()).toBeLessThan(before - 0.05)
      expect(within(shownState()).getByText('Лёд')).toBeTruthy()
      // The departure carries no ice.
      showState('Отход')
      expect(gm()).toBeCloseTo(before, 6)
      expect(within(shownState()).queryByText('Лёд')).toBeNull()
    })

    it('warns about pipes without an inside diameter, and counts their water once it is given', () => {
      render(<Home />)
      clearDemoCargo()
      seedVessel()
      act(() => {
        useCalculator.getState().addItem({ name: 'Труба 530', width: 12, length: 0.53, height: 0.53, quantity: 2, weight: 3000, shape: 'cylinder' })
      })
      openWorkspace()
      expect(within(shownState()).getByText('Вода в трубах «Труба 530» не учтена: нет внутреннего диаметра')).toBeTruthy()
      expect(within(shownState()).queryByText('Вода в трубах')).toBeNull()

      // The inside diameter is in the cargo table's «Дополнительно».
      openSection('Грузы')
      fireEvent.click(screen.getByRole('button', { name: 'Таблица' }))
      fireEvent.click(screen.getByRole('button', { name: 'Дополнительно: Труба 530' }))
      const inside = screen.getByLabelText('Внутренний диаметр, мм')
      fireEvent.change(inside, { target: { value: '500' } })
      fireEvent.keyDown(inside, { key: 'Enter' })
      expect(useCalculator.getState().items[0].pipeInnerDiameterMm).toBe(500)
      expect(within(shownState()).queryByText(/не учтена: нет внутреннего диаметра/)).toBeNull()
      expect(within(shownState()).getByText('Вода в трубах')).toBeTruthy()
    })

    it('opens from the GM in the status line and from «Проверки», which lists the reasons', () => {
      render(<Home />)
      clearDemoCargo()
      seedVessel()
      const gmItem = within(screen.getByRole('status', { name: 'Итог расчёта' })).getByText(/^GM 4\.33 м \(отход\) ⚠$/)
      fireEvent.click(gmItem)
      expect(screen.getByTestId('stability-workspace')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'К палубе' }))

      openSection('Проверки')
      openCheckRow('stability')
      const reasons = screen.getByRole('list', { name: 'Остойчивость: подробности' })
      expect(within(reasons).getByText('Предел по формуляру не задан')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Остойчивость: открыть панель остойчивости' }))
      expect(screen.getByTestId('stability-workspace')).toBeTruthy()
    })

    it('puts each trip\'s stability in the PDF, exported from the workspace without leaving it', async () => {
      vi.mocked(exportPlanPdf).mockClear()
      render(<Home />)
      clearDemoCargo()
      seedVessel()
      openWorkspace()
      fireEvent.click(screen.getByRole('button', { name: /Скачать PDF/ }))
      await waitFor(() => expect(exportPlanPdf).toHaveBeenCalled())
      const block = buildPlanPdf(vi.mocked(exportPlanPdf).mock.calls[0][0]).trips[0].stability
      expect(block.title).toBe('Остойчивость')
      expect(block.rows.map((r) => [r[0], r[5], r.at(-1)])).toEqual([
        ['Отход', '4.33', 'нужна проверка'],
        ['Приход', '4.33', 'нужна проверка'],
      ])
      expect(screen.getByTestId('stability-workspace')).toBeTruthy()
    })

    it('keeps arrival\'s tanks apart from departure\'s once arrival is edited', () => {
      render(<Home />)
      clearDemoCargo()
      seedVessel()
      openWorkspace()
      const tanks = group('Танки и запасы')
      fireEvent.click(within(tanks.getByRole('radiogroup', { name: 'Танки для состояния' })).getByRole('radio', { name: 'Приход' }))
      // Burn half the ballast by arrival.
      const weight = tanks.getByLabelText('Вес, строка 1')
      fireEvent.change(weight, { target: { value: '250' } })
      fireEvent.keyDown(weight, { key: 'Enter' })
      const v = useCalculator.getState().deck.vessel!
      expect(v.variableWeights[0].weightKg).toBe(500_000)
      expect(v.arrivalWeights![0].weightKg).toBe(250_000)
      expect(screen.queryByText(/^Приход совпадает с отходом/)).toBeNull()
    })
  })

  // Stage 1 (spec 6.1, 9.5): the deck reads as a drawing — the sides of the
  // hull named around it, its overall dimensions and a scale bar — in the
  // theme's colours on screen and in light ones in the PDF.
  describe('the deck as a drawing', () => {
    const sideEdges = () =>
      Object.fromEntries(
        Array.from(document.querySelectorAll('svg [data-hull-side]')).map((el) => [
          el.getAttribute('data-hull-side'),
          el.getAttribute('data-edge'),
        ])
      )
    const bowLabel = () => document.querySelector('svg [data-hull-side="bow"]')!.textContent

    it('names the sides of the hull and moves them when the bow is switched', () => {
      render(<Home />)
      // The default deck: 8 m from side to side, 20 m from bow to stern, the
      // bow at +y — drawn lengthwise, bow at the right.
      expect(sideEdges()).toEqual({ port: 'top', starboard: 'bottom', bow: 'right', stern: 'left' })
      expect(bowLabel()).toBe('↓ НОС')
      // The switch is with the deck, in «Судно» (spec 8.1).
      openSection('Судно')
      const bowLine = () => screen.getByText(/^Нос на схеме:/).textContent
      expect(bowLine()).toBe('Нос на схеме: справа')
      fireEvent.click(screen.getByRole('button', { name: 'Сменить' }))
      expect(bowLine()).toBe('Нос на схеме: слева')
      expect(sideEdges()).toEqual({ port: 'top', starboard: 'bottom', bow: 'left', stern: 'right' })
      expect(bowLabel()).toBe('↑ НОС')
    })

    it('asks to check the bow on a library vessel whose data does not give it', () => {
      render(<Home />)
      openSection('Судно')
      const card = (label: string) => screen.getByText(label).closest('button')!
      expect(within(card('Коммандер (IMO 9340609)')).getByText('Направление носа по умолчанию — проверьте')).toBeTruthy()
      expect(within(card('Алексей Кузнецов (IMO 9692648)')).queryByText(/Направление носа/)).toBeNull()
    })

    it('turns the labels with a deck drawn lengthwise', () => {
      render(<Home />)
      act(() => {
        useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 16.9, length: 49.1 } })
      })
      expect(sideEdges()).toEqual({ port: 'top', starboard: 'bottom', bow: 'right', stern: 'left' })
      expect(bowLabel()).toBe('↓ НОС')
    })

    it('gives the overall dimensions and a scale bar that names the grid step', () => {
      render(<Home />)
      const dimension = (axis: 'horizontal' | 'vertical') =>
        document.querySelector(`svg [data-dimension="${axis}"] text`)!.textContent
      const scaleBar = () => document.querySelector('svg [data-scale-bar] text')!.textContent
      expect(dimension('horizontal')).toBe('20 м')
      expect(dimension('vertical')).toBe('8 м')
      expect(scaleBar()).toBe('2 м · сетка 1 м')
      fireEvent.click(screen.getByRole('button', { name: 'Вид' }))
      fireEvent.click(screen.getByRole('switch', { name: 'Сетка' }))
      expect(scaleBar()).toBe('2 м')
    })

    it('draws the deck in the dark theme on screen and in paper\'s colours for the PDF', async () => {
      vi.mocked(exportPlanPdf).mockClear()
      render(
        <ThemeProvider>
          <Home />
        </ThemeProvider>
      )
      const deckFill = (svg: Element) => svg.querySelector('rect[data-deck-background]')!.getAttribute('fill')
      const bowFill = (svg: Element) => svg.querySelector('[data-hull-side="bow"]')!.getAttribute('fill')
      fireEvent.click(screen.getByRole('button', { name: 'Вид' }))
      fireEvent.click(screen.getByRole('radio', { name: 'Тёмная' }))
      const screenSvg = document.querySelector('svg[data-deck-plan]')!
      expect(deckFill(screenSvg)).toBe(THEME_TOKENS.dark.deck)
      expect(bowFill(screenSvg)).toBe(THEME_TOKENS.dark.ink)

      fireEvent.click(screen.getByRole('button', { name: /Скачать PDF/ }))
      await waitFor(() => expect(exportPlanPdf).toHaveBeenCalled())
      const shapes = buildPlanPdf(vi.mocked(exportPlanPdf).mock.calls[0][0]).trips[0].drawing.shapes
      // The deck light and the bow's name in the light theme's ink, whatever the screen.
      expect(shapes[0]).toMatchObject({ kind: 'rect', fill: '#F1F4F7' })
      expect(shapes.find((s) => s.kind === 'text' && s.text === 'НОС')).toMatchObject({ color: THEME_TOKENS.light.ink })
      // The screen stays dark.
      expect(deckFill(document.querySelector('svg[data-deck-plan]')!)).toBe(THEME_TOKENS.dark.deck)
    })
  })

  // Stage 1 (spec 6.2, 9.2): a cargo's number is its place in the list. Its
  // stacks, its card and its row in «Учёт по грузам» carry it, and the tone
  // follows the number rather than the colour saved with the cargo.
  it('cargo numbers follow the list and pick the tone on the deck, the card and the table', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Труба', width: 2, length: 1, quantity: 1, height: 1, color: '#ff0000' })
      useCalculator.getState().addItem({ name: 'Ящик', width: 1, length: 1, quantity: 1, height: 1, color: '#00ff00' })
    })
    const stack = (name: string) => document.querySelector(`svg g[data-cargo-name="${name}"]`)!
    expect(stack('Ящик').getAttribute('data-cargo-number')).toBe('2')
    expect(stack('Ящик').querySelector(`rect[fill="${cargoToneForNumber(2)}"]`)).toBeTruthy()
    expect(document.querySelector('svg rect[fill="#00ff00"]')).toBeNull()
    expect(screen.getAllByTitle('Груз № 2').length).toBeGreaterThan(0)

    openSection('Грузы')
    const rows = screen.getAllByTestId('cargo-list-row')
    expect(rows.map((r) => [r.querySelector('[title^="Груз №"]')?.textContent, r.querySelector('p[title]')?.textContent])).toEqual([
      ['1', 'Труба'],
      ['2', 'Ящик'],
    ])

    // Removing cargo 1 renumbers the rest, and the tone moves with it.
    act(() => {
      useCalculator.getState().removeItem(useCalculator.getState().items[0].id)
    })
    expect(stack('Ящик').getAttribute('data-cargo-number')).toBe('1')
    expect(stack('Ящик').querySelector(`rect[fill="${cargoToneForNumber(1)}"]`)).toBeTruthy()
  })

  // Phase 0, L11: a vessel whose sources disagree on deck strength offered
  // its two limits only in a toast that vanished after 20 seconds, leaving no
  // limit at all and nothing to say so.
  it('a library vessel keeps asking for its deck-strength limit until one is picked', () => {
    const custom = vi.spyOn(toast, 'custom').mockImplementation(() => '')
    render(<Home />)
    openSection('Судно')
    chooseVessel('Алексей Кузнецов (IMO 9692648)', 'Новый расчёт с этим судном')
    expect(custom).not.toHaveBeenCalled()
    expect(useCalculator.getState().deck.vesselTemplateId).toBe('aleksey-kuznetsov')
    // The vessel's card asks for it (spec 8.1).
    expect(screen.getByText('лимит не выбран')).toBeTruthy()
    openSection('Проверки')
    expect(openCheckRow('zones').getAttribute('data-check-status')).toBe('warn')
    expect(openCheckRow('zones').textContent).toMatch(/Не выбран лимит прочности палубы/)
    openSection('Судно')
    fireEvent.click(screen.getByRole('button', { name: '5 т/м²' }))
    const deck = useCalculator.getState().deck
    expect(deck.deckStrengthChoiceTPerM2).toBe(5)
    expect(deck.loadZones).toEqual([{ id: expect.any(String), x: 0, y: 0, width: deck.width, length: deck.length, maxLoadPerArea: 5 }])
    expect(screen.getByText('Прочность палубы').nextElementSibling!.textContent).toBe('5 т/м²')
    expect(screen.getByRole('button', { name: '5 т/м²' }).getAttribute('aria-pressed')).toBe('true')
    openSection('Проверки')
    expect(openCheckRow('zones').textContent).not.toMatch(/Не выбран лимит/)
  })

  it('a library vessel with no disputed deck strength asks for nothing', () => {
    render(<Home />)
    openSection('Судно')
    chooseVessel('Коммандер (IMO 9340609)', 'Новый расчёт с этим судном')
    expect(useCalculator.getState().deck.vesselTemplateId).toBe('olympic-commander')
    expect(screen.queryByText('лимит не выбран')).toBeNull()
  })

  // Phase 0, L13: variants are a snapshot of one project's cargo; they used
  // to stay listed after the cargo changed, and clicking one wrote a stale
  // layout over the current one.
  it('drops the variants list once the cargo changes', () => {
    render(<Home />)
    clickAutoRedistribute()
    expect(variantsList()).toBeTruthy()
    act(() => {
      const first = useCalculator.getState().items[0]
      useCalculator.getState().updateItem(first.id, { quantity: first.quantity + 1 })
    })
    expect(variantsList()).toBeNull()
  })

  it('drops the variants list when another calculation becomes active', () => {
    render(<Home />)
    clickAutoRedistribute()
    expect(variantsList()).toBeTruthy()
    act(() => {
      useProjects.getState().createProject()
    })
    expect(variantsList()).toBeNull()
  })

  // Stage 4, group D (spec 6.5): the selected stack's lashing is in its
  // inspector — the points tied to it, what the norms ask, adding and
  // taking them off.
  it('the inspector\'s «Крепление»: the stack\'s points with their device, MSL and angle, the count against the norm', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Труба', width: 2, length: 1, height: 1, quantity: 1, category: 'Металлопродукция', weight: 100_000 })
      const it = useCalculator.getState().items[0]
      useCalculator.setState({
        mode: 'manual',
        manualPlacements: [{ id: 'm1', itemId: it.id, name: it.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: it.color, weight: 100_000 }],
        deck: {
          ...useCalculator.getState().deck,
          lashingPoints: [
            { id: 'p1', x: 0.5, y: 0.5, label: 'Точка 1', placementId: 'm1', itemId: it.id, cornerX: 1, cornerY: 1, mslKg: 5000, verticalAngleDeg: 45, deviceType: 'chain_g80_10' },
            { id: 'p2', x: 5, y: 5, label: 'Рым' },
          ],
        },
        selectedManualIds: ['m1'],
      })
    })
    const lashing = within(screen.getByTestId('inspector-lashing'))
    // 100 t of metal asks for 2 lashings; one is set — and 5 t of MSL can't
    // hold it.
    expect(lashing.getByTestId('lashing-count').textContent).toBe('Нужно 2, задано 1')
    expect(lashing.getByTestId('lashing-balance').textContent).toMatch(/^Не держит по расчёту сил/)
    expect(lashing.getByLabelText(/^Обоснование/)).toBeTruthy()
    const points = lashing.getByRole('list', { name: 'Точки крепления штабеля' })
    expect(within(points).getAllByRole('listitem')).toHaveLength(1)
    const msl = within(points).getByLabelText('MSL (кг)') as HTMLInputElement
    fireEvent.change(msl, { target: { value: '8000' } })
    fireEvent.keyDown(msl, { key: 'Enter' })
    expect(useCalculator.getState().deck.lashingPoints!.find((p) => p.id === 'p1')!.mslKg).toBe(8000)
    fireEvent.click(lashing.getByRole('button', { name: 'Добавить точку крепления' }))
    expect(useCalculator.getState().placingLashingPoint).toBe(true)
    fireEvent.click(lashing.getByRole('button', { name: /^Снять все точки этого штабеля/ }))
    // The point tied to no stack stays: it is «Судно»'s.
    expect(useCalculator.getState().deck.lashingPoints!.map((p) => p.id)).toEqual(['p2'])
  })

  // Stage 4, group C2 (spec 8.1): the rest of «Судно» — the deck's shape back
  // to a rectangle, its photo, obstacles placed by X/Y, numbered zones and
  // the lashing points tied to no stack.
  describe('«Судно»: shape, photo, obstacles, zones, points', () => {
    it('«Сбросить к прямоугольнику» undoes a drawn outline, and «Отменить» brings it back', () => {
      render(<Home />)
      const outline = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 16 }, { x: 0, y: 20 }]
      act(() => {
        useCalculator.setState({ deck: { ...useCalculator.getState().deck, outline } })
        clearCalculatorHistory()
      })
      openSection('Судно')
      fireEvent.click(screen.getByRole('button', { name: 'Сбросить к прямоугольнику' }))
      expect(useCalculator.getState().deck.outline).toBeUndefined()
      expect(screen.queryByRole('button', { name: 'Сбросить к прямоугольнику' })).toBeNull()
      const call = vi.mocked(toast.info).mock.calls.find(([text]) => text === 'Палуба снова прямоугольная')!
      act(() => (call[1] as unknown as { action: { onClick: () => void } }).action.onClick())
      expect(useCalculator.getState().deck.outline).toEqual(outline)
    })

    it('an obstacle is renamed and moved by X/Y; a drawn one carries its outline along', () => {
      render(<Home />)
      act(() => {
        useCalculator.setState({
          deck: {
            ...useCalculator.getState().deck,
            restrictionZones: [
              { id: 'r', name: 'Кран', shapeType: 'rect', x: 1, y: 1, width: 2, length: 2 },
              { id: 'c', name: 'Люк', shapeType: 'custom', x: 4, y: 4, width: 2, length: 2, outline: [{ x: 4, y: 4 }, { x: 6, y: 4 }, { x: 5, y: 6 }] },
            ],
          },
        })
      })
      openSection('Судно')
      const name = screen.getByLabelText('Название препятствия «Кран»') as HTMLInputElement
      fireEvent.change(name, { target: { value: 'Кран-балка' } })
      fireEvent.keyDown(name, { key: 'Enter' })
      const x = screen.getByLabelText('X «Люк», м') as HTMLInputElement
      fireEvent.change(x, { target: { value: '5' } })
      fireEvent.keyDown(x, { key: 'Enter' })
      const [crane, hatch] = useCalculator.getState().deck.restrictionZones!
      expect(crane.name).toBe('Кран-балка')
      expect(hatch).toMatchObject({ x: 5, y: 4, outline: [{ x: 5, y: 4 }, { x: 7, y: 4 }, { x: 6, y: 6 }] })
    })

    it('numbers the load zones as «Проверки» names them', () => {
      render(<Home />)
      act(() => {
        const deck = useCalculator.getState().deck
        useCalculator.setState({
          deck: {
            ...deck,
            loadZones: [
              { id: 'a', x: 0, y: 0, width: deck.width, length: deck.length, maxLoadPerArea: 5 },
              { id: 'b', x: 1, y: 1, width: 2, length: 2, maxLoadPerArea: 1 },
            ],
          },
        })
      })
      openSection('Судно')
      expect(screen.getByText('Зона 1 (вся палуба)')).toBeTruthy()
      expect(screen.getByText('Зона 2')).toBeTruthy()
    })

    it('lists the lashing points tied to no stack, and deletes them', () => {
      render(<Home />)
      act(() => {
        useCalculator.setState({
          deck: {
            ...useCalculator.getState().deck,
            lashingPoints: [
              { id: 'free', x: 1, y: 2, label: 'Рым 1' },
              { id: 'tied', x: 3, y: 3, label: 'Точка 2', placementId: 'p' },
            ],
          },
        })
      })
      openSection('Судно')
      const list = screen.getByRole('list', { name: 'Точки крепления без штабеля' })
      expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Рым 11; 2 м'])
      fireEvent.click(within(list).getByRole('button', { name: 'Удалить «Рым 1»' }))
      expect(useCalculator.getState().deck.lashingPoints!.map((p) => p.id)).toEqual(['tied'])
      // «Поставить точку» arms the deck for it.
      fireEvent.click(screen.getByRole('button', { name: 'Поставить точку' }))
      expect(useCalculator.getState().placingLashingPoint).toBe(true)
    })

    it('the deck photo: its transparency, moving and calibrating armed from here, removed with «Отменить»', () => {
      render(<Home />)
      act(() => {
        useCalculator.getState().setDeckBackgroundImage('data:image/png;base64,AAAA', { x: 0, y: 0, width: 8, length: 4 })
        clearCalculatorHistory()
      })
      openSection('Судно')
      fireEvent.change(screen.getByLabelText('Прозрачность'), { target: { value: '0.8' } })
      expect(useCalculator.getState().deck.backgroundImageOpacity).toBe(0.8)
      fireEvent.click(screen.getByRole('button', { name: 'Переместить' }))
      expect(useCalculator.getState().deckPhotoTool).toBe('move')
      expect(screen.getByRole('button', { name: 'Калибровать по известному расстоянию' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Калибровать' }))
      expect(useCalculator.getState().deckPhotoTool).toBe('calibrate')
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(useCalculator.getState().deckPhotoTool).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Удалить фото' }))
      expect(useCalculator.getState().deck.backgroundImage).toBeUndefined()
      const call = vi.mocked(toast.info).mock.calls.find(([text]) => text === 'Фото палубы удалено')!
      act(() => (call[1] as unknown as { action: { onClick: () => void } }).action.onClick())
      expect(useCalculator.getState().deck.backgroundImage).toBe('data:image/png;base64,AAAA')
    })
  })

  // Stage 4, group B (spec 8.4): a click on a check says what it found and
  // lights up the stacks at fault — the rest of the deck steps back.
  describe('«Проверки»', () => {
    const dimmed = (name: string) => document.querySelector(`svg g[data-cargo-name="${name}"]`)!.getAttribute('data-dimmed')

    it('an open check dims every stack but those at fault, until it is closed or the section left', () => {
      render(<Home />)
      clearDemoCargo()
      act(() => {
        const s = useCalculator.getState()
        s.addItem({ name: 'Кислота', width: 1, length: 1, height: 1, quantity: 1, category: 'Химикаты' })
        s.addItem({ name: 'Мука', width: 1, length: 1, height: 1, quantity: 1, category: 'Продукты' })
        s.addItem({ name: 'Ящик', width: 1, length: 1, height: 1, quantity: 1 })
        s.addSeparationRule({ categoryA: 'Продукты', categoryB: 'Химикаты', minDistance: 5 })
        const [acid, flour, box] = useCalculator.getState().items
        const at = (it: typeof acid, id: string, x: number, y: number) => ({
          id, itemId: it.id, name: it.name, x, y, width: 1, length: 1, layers: 1, rotated: false, color: it.color,
        })
        useCalculator.setState({ mode: 'manual', manualPlacements: [at(acid, 'm1', 1, 1), at(flour, 'm2', 3, 1), at(box, 'm3', 12, 5)] })
      })
      openSection('Проверки')
      const row = openCheckRow('separation')
      expect(within(row).getByRole('list', { name: 'Сепарация: подробности' }).textContent).toBe('ошибка: «Кислота» и «Мука»: 1 из 5 м')
      expect([dimmed('Кислота'), dimmed('Мука'), dimmed('Ящик')]).toEqual([null, null, 'true'])

      fireEvent.click(row.querySelector('button')!)
      expect(dimmed('Ящик')).toBeNull()

      openCheckRow('separation')
      openSection('Грузы')
      expect(dimmed('Ящик')).toBeNull()
    })

    it('a separation rule is changed in its check, and the new one added there', () => {
      render(<Home />)
      act(() => useCalculator.getState().addSeparationRule({ categoryA: 'Опасный груз', categoryB: 'Обычный', minDistance: 3 }))
      openSection('Проверки')
      const row = openCheckRow('separation')
      const distance = within(row).getByLabelText('Правило 1: расстояние, м') as HTMLInputElement
      fireEvent.change(distance, { target: { value: '5' } })
      fireEvent.keyDown(distance, { key: 'Enter' })
      expect(useCalculator.getState().separationRules).toEqual([{ id: expect.any(String), categoryA: 'Опасный груз', categoryB: 'Обычный', minDistance: 5 }])
      fireEvent.click(within(row).getByRole('button', { name: 'Удалить правило 1' }))
      expect(useCalculator.getState().separationRules).toEqual([])
      expect(within(openCheckRow('separation')).getByRole('group', { name: 'Новое правило' })).toBeTruthy()
    })

    it('the lashing check says coastal waters are assumed until other conditions are chosen', () => {
      render(<Home />)
      openSection('Проверки')
      const row = openCheckRow('lashing')
      const motion = within(row).getByLabelText('Условия плавания')
      expect(document.getElementById(motion.getAttribute('aria-describedby')!)!.textContent).toBe(
        'По умолчанию — прибрежное плавание. Ускорения: поперёк 0.35 g, вдоль 0.20 g; трение 0.30'
      )
      act(() => useCalculator.getState().setVesselMotion({ ax: 0.3, ay: 0.5, az: 0.3, friction: 0.3, preset: 'open-sea' }))
      expect(document.getElementById(motion.getAttribute('aria-describedby')!)!.textContent).toBe('Ускорения: поперёк 0.50 g, вдоль 0.30 g; трение 0.30')
    })

    it('«Требуют внимания»: a stack of unknown makeup is kept as it is, or deleted with «Отменить»', () => {
      render(<Home />)
      clearDemoCargo()
      act(() => {
        useCalculator.getState().addItem({ name: 'Ящик', width: 1, length: 1, height: 1, quantity: 2 })
        const it = useCalculator.getState().items[0]
        const at = (id: string, x: number) => ({ id, itemId: it.id, name: it.name, x, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: it.color, legacyUnknownComposition: true as const })
        useCalculator.setState({ mode: 'manual', manualPlacements: [at('m1', 1), at('m2', 4)] })
        clearCalculatorHistory()
      })
      openSection('Проверки')
      const keep = within(openCheckRow('attention')).getAllByRole('button', { name: /^Оставить как есть/ })
      expect(keep).toHaveLength(2)
      fireEvent.click(keep[0])
      expect(useCalculator.getState().manualPlacements.map((m) => !!m.legacyUnknownComposition)).toEqual([false, true])
      fireEvent.click(within(openCheckRow('attention')).getByRole('button', { name: /^Удалить/ }))
      expect(useCalculator.getState().manualPlacements.map((m) => m.id)).toEqual(['m1'])
      expect(document.querySelector('[data-check="attention"]')).toBeNull()
      const call = vi.mocked(toast.info).mock.calls.find(([text]) => text === 'Штабель удалён')!
      act(() => (call[1] as unknown as { action: { onClick: () => void } }).action.onClick())
      expect(useCalculator.getState().manualPlacements).toHaveLength(2)
    })

    it('a line about another trip opens it', () => {
      render(<Home />)
      clearDemoCargo()
      act(() => {
        useCalculator.setState({
          deck: { ...useCalculator.getState().deck, unit: 'm', width: 10, length: 10, gap: 0, boardOffset: 0, clearance: 0, outline: undefined, restrictionZones: [], loadZones: [], maxDeckCargoT: 3 },
        })
        useCalculator.getState().addItem({ name: 'Блок', width: 5, length: 5, height: 1, quantity: 6, weight: 1000 })
      })
      openSection('Проверки')
      const details = within(openCheckRow('deck-weight')).getByRole('list', { name: 'Вес палубы: подробности' })
      expect([...details.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['сведения: Рейс 1: 3 из 3 т', 'сведения: Рейс 2: 3 из 3 т'])
      fireEvent.click(within(details).getByRole('button', { name: 'Рейс 2' }))
      expect(screen.getByRole('tab', { name: /^Рейс 2/ }).getAttribute('aria-selected')).toBe('true')
    })
  })

  // Stage 4, group A (spec 8.2): «Размещение» — the open trip's summary,
  // the trips, the layout and the rules of placement.
  describe('«Размещение»', () => {
    // A 10 × 10 m deck with nothing on it but what a test adds.
    function bareDeck(patch: Record<string, unknown> = {}) {
      act(() => {
        useCalculator.setState({
          deck: {
            ...useCalculator.getState().deck,
            unit: 'm',
            width: 10,
            length: 10,
            gap: 0,
            boardOffset: 0,
            clearance: 0,
            outline: undefined,
            restrictionZones: [],
            loadZones: [],
            maxDeckCargoT: undefined,
            ...patch,
          },
        })
      })
    }
    const summaryValue = (term: string) => within(screen.getByTestId('trip-summary')).getByText(term).nextElementSibling?.textContent

    it('sums up the open trip: load, used and free area, weight, the highest stack against the deck\'s limit', () => {
      render(<Home />)
      clearDemoCargo()
      bareDeck({ clearance: 3, maxDeckCargoT: 10 })
      act(() => {
        useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, height: 1.3, quantity: 4, weight: 1000, maxLayers: 2 })
      })
      openSection('Размещение')
      expect(summaryValue('Загрузка площади')).toBe('4%')
      expect(summaryValue('Занято')).toBe('4 м²')
      expect(summaryValue('Свободно')).toBe('96 из 100 м²')
      expect(summaryValue('Вес груза')).toBe('4 из 10 т')
      expect(summaryValue('Наибольшая высота штабеля')).toBe('2.60 из 3 м')
    })

    it('lists the trips; a trip opens on click, and the units going on are said calmly', () => {
      render(<Home />)
      clearDemoCargo()
      bareDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'Block', width: 5, length: 5, height: 1, quantity: 6 })
      })
      openSection('Размещение')
      const trips = screen.getByRole('list', { name: 'Рейсы' })
      const rows = within(trips).getAllByRole('button')
      expect(rows.map((r) => r.textContent)).toEqual(['Рейс 1 · 4 ед. · 100%', 'Рейс 2 · 2 ед. · 50%'])
      expect(rows[0].getAttribute('aria-current')).toBe('true')
      expect(screen.getByTestId('placement-carry')).toHaveTextContent('2 ед. уходят в рейс 2')
      fireEvent.click(rows[1])
      expect(within(screen.getByRole('list', { name: 'Рейсы' })).getAllByRole('button')[1].getAttribute('aria-current')).toBe('true')
      expect(screen.getByText('Итог рейса 2')).toBeTruthy()
      expect(screen.queryByTestId('placement-carry')).toBeNull()
    })

    it('«Подобрать варианты» puts the best on the deck and marks it; another is a click away', () => {
      render(<Home />)
      clickAutoRedistribute()
      const pressed = () => within(variantsList()!).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))
      const buttons = within(variantsList()!).getAllByRole('button')
      expect(buttons[0].textContent).toMatch(/^Вариант 1 — .+ · \d+% · \d+ ед\.на палубе$/)
      expect(pressed()[0]).toBe('true')
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringMatching(/^Применён: Вариант 1 — /),
        expect.objectContaining({ action: expect.objectContaining({ label: 'Отменить' }) })
      )
      if (buttons.length > 1) {
        fireEvent.click(buttons[1])
        expect(pressed()).toEqual(['false', 'true', ...pressed().slice(2)])
      }
    })

    // L13, L20: a list kept past what it was built on could put a stale
    // layout over the current one — moving a stack locked since.
    it('the list goes with an undo and comes back with a redo', () => {
      render(<Home />)
      clickAutoRedistribute()
      act(() => undoCalculator())
      expect(variantsList()).toBeNull()
      act(() => redoCalculator())
      expect(within(variantsList()!).getAllByRole('button')[0].getAttribute('aria-pressed')).toBe('true')
    })

    it('a stack locked after the variants were built drops the list', () => {
      render(<Home />)
      clickAutoRedistribute()
      act(() => {
        const pin = useCalculator.getState().pinnedPlacementsByTrip[0][0]
        useCalculator.getState().updatePinned(0, pin.id, { locked: true })
      })
      expect(variantsList()).toBeNull()
    })

    it('a new rule lays an applied variant out afresh; «Отменить» brings back the layout and the rule', () => {
      render(<Home />)
      clickAutoRedistribute()
      act(() => clearCalculatorHistory())
      const variantPins = useCalculator.getState().pinnedPlacementsByTrip[0]
      expect(variantPins.length).toBeGreaterThan(0)
      fireEvent.click(screen.getByRole('switch', { name: 'Разрешить поворот на 90°' }))
      expect(useCalculator.getState().globalRotation).toBe(false)
      expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toEqual([])
      // Built with rotation allowed, the variants no longer apply.
      expect(variantsList()).toBeNull()
      const call = vi.mocked(toast.info).mock.calls.find(([text]) => text === 'Груз расставлен заново по новому правилу')!
      act(() => (call[1] as unknown as { action: { onClick: () => void } }).action.onClick())
      expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toBe(variantPins)
      expect(useCalculator.getState().globalRotation).toBe(true)
    })

    it('a new rule with nothing but the user\'s own stacks just applies', () => {
      render(<Home />)
      openSection('Размещение')
      fireEvent.click(screen.getByRole('switch', { name: 'Разрешить поворот на 90°' }))
      expect(useCalculator.getState().globalRotation).toBe(false)
      expect(toast.info).not.toHaveBeenCalledWith('Груз расставлен заново по новому правилу', expect.anything())
    })

    it('«Подобрать варианты» waits for cargo', () => {
      render(<Home />)
      clearDemoCargo()
      openSection('Размещение')
      expect((screen.getByRole('button', { name: 'Подобрать варианты' }) as HTMLButtonElement).disabled).toBe(true)
    })

    it('«Снять все закрепления» says so with «Отменить», which brings the pins back', () => {
      render(<Home />)
      clearDemoCargo()
      bareDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, height: 1, quantity: 2 })
      })
      const item = useCalculator.getState().items[0]
      act(() => {
        useCalculator.getState().pinFromPlaced(0, { itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, locked: true })
        // The setup isn't the user's edit: the undo goes back to it.
        clearCalculatorHistory()
      })
      openSection('Размещение')
      fireEvent.click(screen.getByRole('button', { name: 'Снять все закрепления' }))
      expect(useCalculator.getState().pinnedPlacementsByTrip[0] ?? []).toHaveLength(0)
      const call = vi.mocked(toast.info).mock.calls.find(([text]) => text === 'Все закрепления сняты')!
      const { action } = call[1] as unknown as { action: { label: string; onClick: () => void } }
      expect(action.label).toBe('Отменить')
      act(() => action.onClick())
      expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)
    })

    it('«Очистить расстановку» in manual mode, with «Отменить»', () => {
      render(<Home />)
      clearDemoCargo()
      bareDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, height: 1, quantity: 2 })
      })
      const item = useCalculator.getState().items[0]
      const base = { itemId: item.id, name: item.name, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color }
      act(() => {
        useCalculator.setState({ mode: 'manual', manualPlacements: [{ ...base, id: 'm1', x: 1 }, { ...base, id: 'm2', x: 4 }] })
        clearCalculatorHistory()
      })
      openSection('Размещение')
      expect(screen.getByText('Ручной: каждый груз ставите вы')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Очистить расстановку' }))
      expect(useCalculator.getState().manualPlacements).toHaveLength(0)
      const call = vi.mocked(toast.info).mock.calls.find(([text]) => text === 'Расстановка очищена')!
      act(() => (call[1] as unknown as { action: { onClick: () => void } }).action.onClick())
      expect(useCalculator.getState().manualPlacements).toHaveLength(2)
    })

    it('holds the rules of placement: strategy with its line, the gap, rotation — and «Судно» no longer does', () => {
      render(<Home />)
      openSection('Размещение')
      const strategy = screen.getByLabelText('Стратегия упаковки')
      expect(document.getElementById(strategy.getAttribute('aria-describedby')!)!.textContent).toMatch(/^Мелкие грузы заполняют промежутки/)
      act(() => useCalculator.getState().setSortStrategy('none'))
      expect(document.getElementById(strategy.getAttribute('aria-describedby')!)!.textContent).toBe('Грузы ставятся в том порядке, в каком идут в списке')

      const gap = screen.getByLabelText('Отступ между грузами') as HTMLInputElement
      fireEvent.change(gap, { target: { value: '0.3' } })
      fireEvent.keyDown(gap, { key: 'Enter' })
      expect(useCalculator.getState().deck.gap).toBe(0.3)

      const rotation = screen.getByRole('switch', { name: 'Разрешить поворот на 90°' })
      expect(rotation.getAttribute('aria-describedby')).toBeTruthy()
      fireEvent.click(rotation)
      expect(useCalculator.getState().globalRotation).toBe(false)

      openSection('Судно')
      expect(screen.queryByLabelText('Отступ между грузами')).toBeNull()
      expect(screen.queryByText('Стратегия упаковки')).toBeNull()
    })
  })

  // Stage 2 (spec 5): the frame — five sections in the top bar, the open one
  // in the left panel, the deck in the rest, the status line under it.
  describe('the frame', () => {
    const sectionButton = (title: string) =>
      within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole('button', { name: new RegExp(`^${title}`) })

    it('opens one section at a time in the left panel', () => {
      render(<Home />)
      expect(screen.getByRole('heading', { name: 'Грузы' })).toBeTruthy()
      expect(sectionButton('Грузы').getAttribute('aria-current')).toBe('page')
      openSection('Судно')
      expect(screen.getByRole('heading', { name: 'Судно' })).toBeTruthy()
      expect(screen.getByText('Судно из библиотеки')).toBeTruthy()
      expect(screen.queryByRole('list', { name: 'Список грузов' })).toBeNull()
      expect(localStorage.getItem('deckload-panel-section')).toBe('vessel')
    })

    it('collapses the panel to a strip of icons, remembers it, and unfolds when a section is picked', () => {
      render(<Home />)
      fireEvent.click(screen.getByRole('button', { name: 'Свернуть панель' }))
      expect(screen.queryByRole('heading', { name: 'Грузы' })).toBeNull()
      expect(localStorage.getItem('deckload-panel-collapsed')).toBe('1')
      const strip = screen.getByRole('complementary', { name: 'Панель разделов' })
      fireEvent.click(within(strip).getByRole('button', { name: 'Проверки' }))
      expect(screen.getByRole('heading', { name: 'Проверки' })).toBeTruthy()
      expect(localStorage.getItem('deckload-panel-collapsed')).toBe('0')
    })

    it('ticks the steps that are done and never locks the others', () => {
      render(<Home />)
      clearDemoCargo()
      expect(sectionButton('Грузы').textContent).not.toMatch(/готово/)
      act(() => {
        useCalculator.getState().addItem({ name: 'Ящик', width: 1, length: 1, quantity: 2, height: 1 })
      })
      expect(sectionButton('Грузы').textContent).toMatch(/готово/)
      expect(sectionButton('Размещение').textContent).toMatch(/готово/)
      // Cargo on the deck counts as the vessel step being done.
      expect(sectionButton('Судно').textContent).toMatch(/готово/)
      openSection('Отчёт')
      expect(screen.getByRole('heading', { name: 'Отчёт' })).toBeTruthy()
    })

    it('ticks «Отчёт» after a PDF is downloaded, until the calculation changes', async () => {
      render(<Home />)
      expect(sectionButton('Отчёт').textContent).not.toMatch(/готово/)
      fireEvent.click(screen.getByRole('button', { name: /Скачать PDF/ }))
      await waitFor(() => expect(sectionButton('Отчёт').textContent).toMatch(/готово/))
      act(() => {
        const first = useCalculator.getState().items[0]
        useCalculator.getState().updateItem(first.id, { quantity: first.quantity + 1 })
      })
      expect(sectionButton('Отчёт').textContent).not.toMatch(/готово/)
    })

    // Spec 8.8: what the PDF will be — a trip's sheet as it prints, the
    // sheets, what goes in, and a word when there are errors.
    it('«Отчёт» previews a trip\'s sheet, lists the sheets and says what goes in', () => {
      render(<Home />)
      openSection('Отчёт')
      expect(screen.getByRole('img', { name: 'Превью листа: Рейс 1 из 1' })).toBeTruthy()
      const sheets = screen.getByRole('list', { name: 'Листы PDF' })
      expect(within(sheets).getByRole('button', { name: /^Рейс 1 из 1/ }).getAttribute('aria-pressed')).toBe('true')
      expect(within(sheets).getByText('Итого по операции')).toBeTruthy()
      expect(screen.getByText(/^По листу на рейс: схема палубы, груз, сводка/)).toBeTruthy()
      expect(screen.queryByText('В расчёте есть ошибки: они будут видны в PDF')).toBeNull()
      const download = screen.getAllByRole('button', { name: /Скачать PDF/ }).at(-1)!
      expect(download.hasAttribute('disabled')).toBe(false)
    })

    it('«Отчёт» shows the sheet of the trip picked in the list', () => {
      render(<Home />)
      clearDemoCargo()
      act(() => {
        useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 4, length: 4, clearance: 0 } })
        useCalculator.getState().addItem({ name: 'Ящик', width: 1, length: 1, height: 1, quantity: 30 })
      })
      openSection('Отчёт')
      const sheets = screen.getByRole('list', { name: 'Листы PDF' })
      const second = within(sheets).getByRole('button', { name: /^Рейс 2 из \d/ })
      fireEvent.click(second)
      expect(second.getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByRole('img', { name: /^Превью листа: Рейс 2 из \d/ })).toBeTruthy()
    })

    it('«Отчёт» warns that errors print too, and without cargo asks for it first', () => {
      render(<Home />)
      clearDemoCargo()
      act(() => {
        // Wider than the deck: it fits no trip.
        useCalculator.getState().addItem({ name: 'Ферма', width: 30, length: 30, height: 1, quantity: 1 })
      })
      openSection('Отчёт')
      expect(screen.getByText('В расчёте есть ошибки: они будут видны в PDF')).toBeTruthy()
      clearDemoCargo()
      expect(screen.getByText('Сначала добавьте груз.')).toBeTruthy()
      expect(screen.queryByRole('img', { name: /^Превью листа/ })).toBeNull()
      expect(screen.getAllByRole('button', { name: /Скачать PDF/ }).at(-1)!.hasAttribute('disabled')).toBe(true)
    })

    it('the status line sums the trip up and each number opens its section', () => {
      render(<Home />)
      clearDemoCargo()
      act(() => {
        useCalculator.getState().addItem({ name: 'Ящик', width: 1, length: 1, quantity: 3, height: 1, weight: 1500 })
      })
      const status = screen.getByRole('status', { name: 'Итог расчёта' })
      expect(status.textContent).toMatch(/3\/3 ед\./)
      expect(status.textContent).toMatch(/4\.5 т/)
      openSection('Судно')
      fireEvent.click(within(status).getByRole('button', { name: '3/3 ед.' }))
      expect(screen.getByRole('heading', { name: 'Грузы' })).toBeTruthy()
    })

    // Stage 2, group B (spec 8.3, 8.4): the whole plan's checks — their ✕
    // and ⚠ in the status line and on the «Проверки» tab, the list on top
    // of that section.
    it('counts failed checks in the status line and on «Проверки», and lists them there', () => {
      render(<Home />)
      clearDemoCargo()
      act(() => {
        // Larger than the 20×8 m deck: fits in no trip.
        useCalculator.getState().addItem({ name: 'Плита', width: 30, length: 30, quantity: 1, height: 1, weight: 1000 })
        // Its securing is an IMDG matter the app doesn't calculate.
        useCalculator.getState().addItem({ name: 'Реагент', width: 1, length: 1, quantity: 1, height: 1, weight: 100, category: 'Опасный груз' })
      })
      const status = screen.getByRole('status', { name: 'Итог расчёта' })
      expect(within(status).getByRole('button', { name: 'Проверки — 1 ошибка: Вместимость и рейсы' }).textContent).toBe('✕ 1')
      expect(within(status).getByRole('button', { name: 'Проверки — 1 предупреждение: Крепление' }).textContent).toBe('⚠ 1')
      expect(sectionButton('Проверки').textContent).toMatch(/1 ошибка/)

      fireEvent.click(within(status).getByRole('button', { name: /^Проверки — 1 ошибка/ }))
      expect(screen.getByRole('heading', { name: 'Проверки' })).toBeTruthy()
      const summary = screen.getByRole('list', { name: 'Список проверок' })
      const row = (id: string) => summary.querySelector(`[data-check="${id}"]`)!
      expect(row('capacity').getAttribute('data-check-status')).toBe('error')
      expect(row('capacity').textContent).toMatch(/1 ед\. не помещаются ни в один рейс/)
      expect(row('lashing').getAttribute('data-check-status')).toBe('warn')
      expect(row('separation').textContent).toMatch(/не проверяется.*Правил нет/)

      // Opened, the check names the cargo and why.
      expect(within(openCheckRow('capacity')).getByRole('list', { name: 'Вместимость и рейсы: подробности' }).textContent).toMatch(/^ошибка: «Плита»: /)
      fireEvent.click(within(summary).getByRole('button', { name: 'Вместимость и рейсы: открыть раздел «Размещение»' }))
      expect(screen.getByRole('heading', { name: 'Размещение' })).toBeTruthy()

      // Fixed: the tab is ticked only by warnings now.
      act(() => {
        const plate = useCalculator.getState().items.find((it) => it.name === 'Плита')!
        useCalculator.getState().removeItem(plate.id)
      })
      expect(within(status).queryByRole('button', { name: /ошибк/ })).toBeNull()
      expect(sectionButton('Проверки').textContent).toMatch(/1 предупреждение/)
    })

    it('the calculation menu creates, renames, duplicates and deletes calculations', () => {
      render(<Home />)
      const count = () => useProjects.getState().projects.length
      const before = count()
      projectMenuItem('Новый расчёт')
      expect(count()).toBe(before + 1)

      projectMenuItem('Переименовать…')
      const field = screen.getByRole('textbox', { name: 'Название расчёта' })
      fireEvent.change(field, { target: { value: 'Рейс 12' } })
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
      expect(screen.getByRole('button', { name: 'Меню расчёта «Рейс 12»' })).toBeTruthy()

      projectMenuItem('Дублировать')
      expect(count()).toBe(before + 2)
      expect(screen.getByRole('button', { name: 'Меню расчёта «Рейс 12 (копия)»' })).toBeTruthy()

      projectMenuItem('Удалить расчёт…')
      expect(screen.getByRole('alertdialog')).toHaveTextContent('Удалить «Рейс 12 (копия)»?')
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Удалить' }))
      expect(count()).toBe(before + 1)
    })

    it('«Все расчёты…» finds a calculation and opens it', () => {
      render(<Home />)
      act(() => {
        useProjects.getState().createProject('Баржа 7')
      })
      projectMenuItem('Все расчёты…')
      const dialog = screen.getByRole('dialog')
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Найти расчёт' }), { target: { value: 'демо' } })
      expect(within(dialog).queryByText('Баржа 7')).toBeNull()
      fireEvent.click(within(dialog).getByText('Демо-расчёт'))
      expect(useProjects.getState().projects.find((p) => p.id === useProjects.getState().activeId)!.name).toBe('Демо-расчёт')
    })

    it('the tour has five steps that point at the frame, and goes back', () => {
      render(<Home />)
      expect(screen.getByText('Шаг 1 из 5')).toBeTruthy()
      expect(document.querySelector('[data-tour="section-vessel"]')).toBeTruthy()
      for (const target of ['section-cargo', 'deck-view', 'status-line', 'export-pdf']) {
        expect(document.querySelector(`[data-tour="${target}"]`)).toBeTruthy()
      }
      fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
      expect(screen.getByText('Шаг 2 из 5')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
      expect(screen.getByText('Шаг 1 из 5')).toBeTruthy()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByText(/Шаг \d из 5/)).toBeNull()
    })
  })

  // Phase 0, L1: units carried on to trip 2 sat in trip 1's red «Не
  // поместилось» strip and its «Не влезло»/«N/M разм.» counters, as if they
  // had failed.
  // Stage 3 (spec 7.1): «Поставить» arms a cargo; a line over the deck says
  // what a click does, R and ↻ turn the cargo, ✕ and Esc cancel.
  it('arming a cargo shows the line over the deck; R and ↻ turn it, ✕ cancels', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2 })
    })
    openSection('Грузы')
    fireEvent.click(screen.getByRole('button', { name: 'Поставить «Box»' }))
    const hint = screen.getByTestId('stamp-hint')
    expect(hint).toHaveTextContent('Кликните по палубе, чтобы поставить «Box» · R — повернуть · Esc — отмена')

    const rotated = () => useCalculator.getState().stampRotated
    const before = rotated()
    fireEvent.keyDown(window, { key: 'r', code: 'KeyR' })
    expect(rotated()).toBe(!before)
    // The same key in the Russian layout; in a field it's just a letter.
    fireEvent.keyDown(window, { key: 'к', code: 'KeyR' })
    expect(rotated()).toBe(before)
    fireEvent.keyDown(screen.getByLabelText('Всего, Box'), { key: 'к', code: 'KeyR' })
    expect(rotated()).toBe(before)
    fireEvent.click(within(hint).getByRole('button', { name: 'Повернуть груз' }))
    expect(rotated()).toBe(!before)

    fireEvent.click(within(hint).getByRole('button', { name: 'Отменить постановку' }))
    expect(useCalculator.getState().activeStampId).toBeNull()
    expect(screen.queryByTestId('stamp-hint')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Поставить «Box»' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('stamp-hint')).toBeNull()
  })

  // Spec 7.2: the drawn outline stays on the deck while its name is asked
  // for, in «Грузы», whichever section was open.
  it('a drawn cargo outline stays on the deck while its name is asked for', () => {
    render(<Home />)
    openSection('Судно')
    act(() => {
      useCalculator.getState().setPendingCustomShape({ outline: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }], width: 2, length: 2, x: 1, y: 1 })
    })
    expect(document.querySelector('[data-testid="pending-custom-shape"]')?.textContent).toBe('S 2 м²')
    openSection('Грузы')
    expect(screen.getByRole('form', { name: 'Своя форма' })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('form', { name: 'Своя форма' })).getByRole('button', { name: 'Отмена' }))
    expect(document.querySelector('[data-testid="pending-custom-shape"]')).toBeNull()
  })

  it('cargo carried to the next trip is a calm note, not a red «Не поместилось»', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().setDeck({ width: 3, length: 1, gap: 0, boardOffset: 0 })
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2 })
    })
    expect(screen.getByRole('tab', { name: /Рейс 1 · 1 ед\./ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Рейс 2 · 1 ед\./ })).toBeTruthy()
    expect(screen.queryByText(/Не поместилось/)).toBeNull()
    expect(screen.getByTestId('trip-carry-over').textContent).toMatch(/^1 ед\. уходит в рейс 2/)
    // Both units count as placed: one on each trip.
    expect(screen.getByTestId('cargo-list-row')).toHaveTextContent(/Размещено 2\s*из/)
  })

  it('cargo that fits in no trip stays red and gets no empty trip tab of its own', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().setDeck({ width: 3, length: 1, gap: 0, boardOffset: 0 })
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
      useCalculator.getState().addItem({ name: 'Huge', width: 5, length: 5, quantity: 1 })
    })
    expect(screen.queryByRole('button', { name: /Рейс 2/ })).toBeNull()
    expect(screen.getByText(/Huge — ни в один рейс/)).toBeTruthy()
  })

  it('manual mode lists units not placed yet as a to-do, not as a failure', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2 })
    })
    expect(screen.queryByText(/Не поместилось/)).toBeNull()
    expect(screen.getByText('Ещё не размещено вручную:')).toBeTruthy()
  })

  // Phase 0, L5: Manual → Auto turned every hand-placed stack into a pin
  // without asking, after which auto mode no longer packed that cargo.
  it('Manual → Auto asks whether to keep the hand-placed positions or re-pack', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    })
    fireEvent.click(screen.getByText('Ручной'))
    expect(useCalculator.getState().manualPlacements).toHaveLength(1)
    fireEvent.click(screen.getByRole('radio', { name: 'Авто' }))
    expect(useCalculator.getState().mode).toBe('manual')
    fireEvent.click(screen.getByRole('button', { name: 'Переразместить' }))
    expect(useCalculator.getState().mode).toBe('auto')
    expect(useCalculator.getState().manualPlacements).toHaveLength(0)
    expect(Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()).toHaveLength(0)
  })

  // Phase 0, L21: manual mode has one trip, so switching from a multi-trip
  // plan left the other trips' cargo unplaced without a word.
  it('Auto → Manual with several trips warns that the other trips become unplaced', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().setDeck({ width: 3, length: 1, gap: 0, boardOffset: 0 })
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2 })
    })
    fireEvent.click(screen.getByText('Ручной'))
    expect(useCalculator.getState().mode).toBe('auto')
    expect(screen.getByText(/В ручном режиме один рейс/).textContent).toMatch(/1 ед\. из других рейсов/)
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(useCalculator.getState().mode).toBe('auto')
  })

  it('handleRemovePinned deletes the cargo (decrements quantity), not just unpins it', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    const xCircle = inspectorButton(/^Удалить/)
    expect(xCircle).toBeTruthy()
    fireEvent.click(xCircle!)

    expect(useCalculator.getState().items[0].quantity).toBe(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0] ?? []).toHaveLength(0)
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('удалён'))
  })

  // Round 16 — composition-aware handleRemovePinned. Before this fix, the
  // whole pin's layer count (5) was decremented from the NOMINAL itemId's
  // (A) own quantity, leaving B's quantity completely untouched even though
  // 3 real units of B are physically inside this pin — this test pins the
  // exact classic bug the review named: [A2,B3] -> old code did A-=5, B-=0;
  // correct is A-=2, B-=3.
  it('handleRemovePinned (composition-aware): a composed pin decreases EACH constituent\'s own quantity, not just the nominal itemId\'s', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 5 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      // Hand-built composition, same technique used throughout the
      // migration's test suite since Round 13 — no real merge UI creates
      // this yet.
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    const xCircle = inspectorButton(/^Удалить/)
    expect(xCircle).toBeTruthy()
    fireEvent.click(xCircle!)

    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(3) // 5 - 2
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(2) // 5 - 3
    expect(useCalculator.getState().pinnedPlacementsByTrip[0] ?? []).toHaveLength(0)
  })

  // Round 16 acceptance scenario D — full placement removal with a
  // non-adjacent same-itemId composition: [A2,B3,A1]. Deleting this ONE
  // placement must decrement A by 3 (2+1, BOTH A segments summed, not just
  // the first one encountered) and B by 3 — proves the aggregation-by-
  // itemId step in handleRemovePinned (needed because a composition can
  // list the same itemId more than once) actually runs correctly end-to-end
  // through the real ✕-button click handler, not just in isolation.
  it('handleRemovePinned (composition-aware): [A2,B3,A1] — non-adjacent A segments are summed before decrementing, not just the first one', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 5 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 6, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }, { itemId: itemA.id, layers: 1 }],
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    const xCircle = inspectorButton(/^Удалить/)
    expect(xCircle).toBeTruthy()
    fireEvent.click(xCircle!)

    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(2) // 5 - (2+1)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(2) // 5 - 3
    expect(useCalculator.getState().pinnedPlacementsByTrip[0] ?? []).toHaveLength(0)
  })

it('handleLayerChangePinned("-") pins the freed unit as its own placement (regression: freed units re-stacked onto each other)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 4, height: 1 })
    })
    const item = useCalculator.getState().items[0]
    let pinAId = ''
    let pinBId = ''
    act(() => {
      pinAId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 2, rotated: false, color: item.color,
      })
      pinBId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 4, y: 1, width: 2, length: 1, layers: 2, rotated: false, color: item.color,
      })
    })

    // Reduce pin A by one layer, then pin B by one layer - same sequence as
    // the reported bug (two "-" clicks on two separate stacks of the same
    // item).
    act(() => {
      useCalculator.setState({ selectedPinIds: [pinAId] })
    })
    fireEvent.click(stackButton('Убрать ярус')!)
    act(() => {
      useCalculator.setState({ selectedPinIds: [pinBId] })
    })
    fireEvent.click(stackButton('Убрать ярус')!)

    // The old bug: both freed units landed in the auto-packer's shared
    // "remaining quantity" pool, which stacks same-item leftovers up to their
    // physical limit by default - so the second freed unit silently restacked
    // onto the first instead of standing on its own. Expect 4 independent
    // single-layer pins (2 originals + 2 freed), none of them stacked.
    const pins = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    expect(pins).toHaveLength(4)
    expect(pins.every((p) => p.layers === 1)).toBe(true)
    expect(useCalculator.getState().items[0].quantity).toBe(4)
  })

  it('handleLayerChangePinned("+") pulls an existing placement off the deck instead of only unplaced quantity', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2, height: 1 })
    })
    const item = useCalculator.getState().items[0]
    let pinAId = ''
    let pinBId = ''
    act(() => {
      pinAId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      pinBId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 4, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.setState({ selectedPinIds: [pinAId] })
    })

    // Both units of this item's quantity are already placed (as two separate
    // pins) - the old behavior only pulled from *unplaced* quantity, so "+"
    // would be blocked here with "all N units already placed" even though a
    // second container of the same item is sitting right there on the deck.
    const plusCircle = stackButton('Добавить ярус')
    expect(plusCircle).toBeTruthy()
    fireEvent.click(plusCircle!)

    const pins = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    expect(pins).toHaveLength(1)
    expect(pins[0].id).toBe(pinAId)
    expect(pins[0].layers).toBe(2)
    expect(pins.some((p) => p.id === pinBId)).toBe(false)
    expect(useCalculator.getState().items[0].quantity).toBe(2)
  })

  it('handleLayerChangeManual("-") stands the freed unit up as its own placement, same as the pinned version', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 3, height: 1 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 2, rotated: false, color: item.color,
      })
      useCalculator.setState({ selectedManualIds: ['m1'] })
    })

    const minusCircle = stackButton('Убрать ярус')
    expect(minusCircle).toBeTruthy()
    fireEvent.click(minusCircle!)

    // Same expectation as the pinned regression test: the freed unit should
    // land as its own separate single-layer placement, not vanish.
    const placements = useCalculator.getState().manualPlacements
    expect(placements).toHaveLength(2)
    expect(placements.every((p) => p.layers === 1)).toBe(true)
    expect(useCalculator.getState().items[0].quantity).toBe(3)
  })

  it('handleLayerChangeManual("+") pulls an existing placement off the deck instead of only unplaced quantity', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2, height: 1 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'mA', itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.getState().addManualPlacement({
        id: 'mB', itemId: item.id, name: item.name, x: 4, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.setState({ selectedManualIds: ['mA'] })
    })

    const plusCircle = stackButton('Добавить ярус')
    expect(plusCircle).toBeTruthy()
    fireEvent.click(plusCircle!)

    const placements = useCalculator.getState().manualPlacements
    expect(placements).toHaveLength(1)
    expect(placements[0].id).toBe('mA')
    expect(placements[0].layers).toBe(2)
    expect(useCalculator.getState().items[0].quantity).toBe(2)
  })

  // Round 17 (capacity verification) — investigate-first scenarios 1-4 from
  // the review: wouldExceedMaxDeckCargo (page.tsx) actually gates the "+"
  // button's fresh-unit path (no merge source available) in BOTH modes,
  // exactly at the limit (allowed) and just over it (blocked). This is the
  // real end-to-end wiring, not just the underlying wouldExceedDeckCapacity
  // arithmetic (already exhaustively unit-tested in cargoValidation.test.ts).
  it('wouldExceedMaxDeckCargo (MANUAL): "+" is allowed exactly at the limit, blocked just over it', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5, maxDeckCargoT: 1 } }) // 1000kg cap
      // Quantity 3, so the third unit the second "+" asks for exists and it's
      // the weight cap — not the quantity — that stops it.
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 3, height: 1, weight: 500 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      // ONE placement only — no other stack to take a unit from, so "+"
      // pulls a fresh unplaced unit and goes through the capacity guard.
      useCalculator.getState().addManualPlacement({
        id: 'mA', itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, weight: 500,
      })
      useCalculator.setState({ selectedManualIds: ['mA'] })
    })

    // 500 (placed) + 500 (new) = 1000 kg = exactly the 1t cap -> allowed.
    const plusCircle = stackButton('Добавить ярус')
    fireEvent.click(plusCircle!)
    expect(useCalculator.getState().manualPlacements.find((m) => m.id === 'mA')?.layers).toBe(2)
    expect(toast.error).not.toHaveBeenCalled()

    // A third unit would push to 1500kg > 1000kg -> blocked, layers unchanged.
    fireEvent.click(stackButton('Добавить ярус')!)
    expect(useCalculator.getState().manualPlacements.find((m) => m.id === 'mA')?.layers).toBe(2)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('лимит груза'))
  })

  it('wouldExceedMaxDeckCargo (AUTO/pinned): "+" is allowed exactly at the limit, blocked just over it, scoped to the CURRENT trip only', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // Deck sized to fit exactly ONE 2x1 footprint (no room for AUTO to
      // auto-place a second, unpinned unit of the item's remaining
      // quantity) — otherwise "+" would find that free auto-placed
      // instance and MERGE it (a different, uncapped code path) instead of
      // exercising the capacity-guarded fresh-unit path this test targets.
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 2.2, length: 1.2, boardOffset: 0, gap: 0.1, clearance: 5, maxDeckCargoT: 1 } })
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2, height: 1, weight: 500 })
    })
    const item = useCalculator.getState().items[0]
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 0.1, y: 0.1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, weight: 500,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    // 500 + 500 = 1000kg exactly at the cap -> allowed.
    fireEvent.click(stackButton('Добавить ярус')!)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)?.layers).toBe(2)
    expect(toast.error).not.toHaveBeenCalled()

    // A third unit (1500kg) on the SAME trip -> blocked. Bump quantity so
    // checkLayerChange's own budget doesn't reject it for an unrelated
    // reason before the capacity guard even runs.
    act(() => {
      useCalculator.getState().updateItem(item.id, { quantity: 3 })
    })
    fireEvent.click(stackButton('Добавить ярус')!)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)?.layers).toBe(2)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('лимит груза'))
  })

  // Round 17 acceptance scenario 5: maxDeckCargoT is the vessel's own
  // PER-TRIP capacity — a trip already sitting exactly at the cap must
  // never block a "+" on a DIFFERENT trip that still has headroom.
  it('wouldExceedMaxDeckCargo (AUTO/pinned): a trip already AT its cap does not block "+" on a DIFFERENT trip', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 2.2, length: 1.2, boardOffset: 0, gap: 0.1, clearance: 5, maxDeckCargoT: 1 } })
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 4, height: 1, weight: 500 })
    })
    const item = useCalculator.getState().items[0]
    let trip1PinId = ''
    act(() => {
      // Trip 0: already exactly AT the 1000kg cap.
      useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 0.1, y: 0.1, width: 2, length: 1, layers: 2, rotated: false, color: item.color, weight: 500,
      })
      // Trip 1: only 500kg so far — plenty of headroom on ITS OWN budget.
      trip1PinId = useCalculator.getState().pinFromPlaced(1, {
        itemId: item.id, name: item.name, x: 0.1, y: 0.1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, weight: 500,
      })
    })

    fireEvent.click(screen.getByText(/Рейс 2/))
    act(() => {
      useCalculator.setState({ selectedPinIds: [trip1PinId] })
    })

    // Trip 1: 500 + 500 = 1000kg exactly at ITS OWN cap -> allowed, despite
    // trip 0 already sitting at its own (separate) 1000kg cap.
    fireEvent.click(stackButton('Добавить ярус')!)
    expect(useCalculator.getState().pinnedPlacementsByTrip[1].find((p) => p.id === trip1PinId)?.layers).toBe(2)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].layers).toBe(2) // trip 0 completely untouched
    expect(toast.error).not.toHaveBeenCalled()
  })

  // Note: composed-placement capacity (scenario 6 from the review) is
  // deliberately NOT exercised through the "+" button here — "+" invokes
  // handleLayerChangePinned, whose fresh-unit weight is `pin.weight ?? 0`
  // (undefined/0 for a composed placement, since composition is its source
  // of truth) — a composition-aware "+" is explicitly Round 21 scope
  // (push/pop segments), out of bounds for Round 17. The composed-weight
  // fix itself is verified directly and thoroughly in
  // cargoValidation.test.ts's "composition-aware weight (Round 17)" suite,
  // which is what wouldExceedMaxDeckCargo actually calls into.

  // Round 21 — composed "+"/"-" wiring (C2). handleLayerChangePinned/Manual
  // branch on `composition` and call placementPush/placementPop directly
  // instead of the merge-lookup path above. Hand-built composition, same
  // technique used throughout the migration's test suite since Round 13 —
  // no real merge UI creates this yet (dormant in production until Round 24).
  it('handleLayerChangePinned("+"/"-") on a composed pin: pushes the NOMINAL itemId (K#7c), pops the PHYSICAL top segment, and reverses cleanly (K#7)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // 6, not 5: the column [A2, B3] is 5 m of 1 m units, and since Round 34
      // its TOTAL height has to fit the clearance — the pushed unit makes 6.
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 6 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 10, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    // "+" pushes ONE MORE unit of the placement's own NOMINAL itemId (A) —
    // the top segment is B, so it does NOT coalesce; a new trailing A
    // segment is appended instead.
    fireEvent.click(stackButton('Добавить ярус')!)
    let pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)!
    expect(pin.composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
      { itemId: itemA.id, layers: 1 },
    ])
    expect(pin.layers).toBe(6)
    expect(pin.weight).toBeCloseTo((2 * 100 + 3 * 200 + 1 * 100) / 6) // per-unit average, not total
    expect(toast.error).not.toHaveBeenCalled()

    // "-" pops the PHYSICALLY topmost segment (the A,1 just pushed), not
    // the placement's nominal itemId in the abstract — reverses the "+"
    // exactly, back to the original two-segment composition.
    fireEvent.click(stackButton('Убрать ярус')!)
    pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)!
    expect(pin.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }])
    expect(pin.layers).toBe(5)
    expect(pin.weight).toBeCloseTo((2 * 100 + 3 * 200) / 5)
    // The freed A unit stands up as its own independent single-layer pin,
    // same standup behavior as the uncomposed "-" path.
    const others = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat().filter((p) => p.id !== pinId)
    expect(others).toHaveLength(1)
    expect(others[0].itemId).toBe(itemA.id)
    expect(others[0].layers).toBe(1)
    // Round 21 corrective pass: Round 16's quantity-direction invariant —
    // composed "+"/"-" must not introduce any NEW items[].quantity
    // mutation (freeing a unit just redistributes it across placements,
    // it never touches the catalog's own count). Both items' quantity
    // must read exactly as seeded, unchanged by the whole "+" then "-"
    // sequence above.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
  })

  // K#8: popping the physically topmost segment can free a DIFFERENT item
  // than the placement's own nominal itemId, and popping down to exactly
  // one remaining constituent must un-compose the placement back to an
  // ordinary single-item one (identity transferring to the survivor).
  it('handleLayerChangeManual("-") on a composed placement pops the top segment even when it is NOT the nominal itemId, and un-composes at one constituent left (K#8)', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 10, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'mComp', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 3, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 1 }],
      })
      useCalculator.setState({ selectedManualIds: ['mComp'] })
    })

    // Top segment is B (layers: 1) — popping removes it ENTIRELY, freeing a
    // B unit, not an A unit, even though the placement's nominal itemId is A.
    fireEvent.click(stackButton('Убрать ярус')!)

    const placements = useCalculator.getState().manualPlacements
    const composed = placements.find((p) => p.id === 'mComp')!
    // Only A (layers: 2) survives -> un-composed back to an ordinary
    // placement, composition gone, itemId/layers/weight independently set.
    expect(composed.composition).toBeUndefined()
    expect(composed.itemId).toBe(itemA.id)
    expect(composed.layers).toBe(2)
    expect(composed.weight).toBe(100)

    const freed = placements.find((p) => p.id !== 'mComp')
    expect(freed).toBeTruthy()
    expect(freed?.itemId).toBe(itemB.id) // freed unit is B, not A
    expect(freed?.layers).toBe(1)
    // Round 21 corrective pass: same quantity-direction invariant as the
    // pinned test above — no new updateItem(...quantity...) introduced.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
  })

  // Round 21 corrective pass — real FAIL found by acceptance review:
  // findMergeSourcePinned/Manual filtered candidates by `p.itemId ===
  // itemId` alone, with no check for `.composition`. A composed
  // placement's NOMINAL itemId can coincidentally match a separate,
  // ordinary placement's itemId — before this fix, clicking "+" on that
  // ordinary placement would find the COMPOSED one as a merge source and
  // feed it straight into handleMergePinned/Manual, which is still the old
  // composition-BLIND writer: it blends `weight`/`layers` as flat fields
  // and deletes the dragged placement outright, permanently discarding
  // every non-nominal constituent's provenance and quantity attribution
  // (here, all 3 units of B would silently vanish from tracking).
  it('handleLayerChangePinned("+") on an ORDINARY placement never absorbs a composed placement sharing its nominal itemId (findMergeSourcePinned FAIL fix)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // Deck sized to fit EXACTLY the two 2x1 footprints below and no
      // third one anywhere — this keeps findMergeSourcePinned's SECOND
      // branch (an auto-placed "free instance" of remaining unplaced A
      // quantity) deterministically empty, so the only thing this test
      // exercises is the FIRST branch (scanning existing pins), which is
      // exactly what the guard fixes. Quantity is deliberately generous
      // (10, far above what's placed) so that WITHOUT the guard, the old
      // code's merge into the composed pin would actually succeed (not
      // get coincidentally blocked by an unrelated quantity/height cap) —
      // a weaker version of this test with quantity=3 passed even against
      // the pre-fix code, for the wrong reason (merge blocked by the
      // shared-quantity cap either way); this version's headroom makes the
      // guard itself the only thing standing between pass and fail.
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 4.3, length: 1.2, boardOffset: 0, gap: 0.1, clearance: 20 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 10, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let composedPinId = ''
    let plainPinId = ''
    act(() => {
      // The composed placement's NOMINAL itemId is A — the exact scenario
      // the review flagged: a plain A pin exists separately.
      composedPinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 0.1, y: 0.1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, composedPinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
      plainPinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 2.2, y: 0.1, width: 2, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
      })
      useCalculator.setState({ selectedPinIds: [plainPinId] })
    })

    // "+" on the PLAIN pin — before this Round 21 fix, findMergeSourcePinned(A, ...)
    // returned the composed pin (its own itemId is also A) as the merge
    // source, and handleMergePinned — composition-blind at the time (this
    // predates Round 24's composition-aware rewrite) — absorbed it: blended
    // `layers`/`weight` as flat fields and DELETED the composed placement
    // outright, discarding B's provenance/quantity permanently. With
    // generous quantity and no competing auto-placed instance, that merge
    // would have gone through cleanly under the old code, making this
    // assertion fail without the guard.
    fireEvent.click(stackButton('Добавить ярус')!)

    const pins = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    // The composed placement must still exist, completely untouched — not
    // absorbed, not blended, composition intact.
    const composed = pins.find((p) => p.id === composedPinId)
    expect(composed).toBeTruthy()
    expect(composed?.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }])
    expect(composed?.layers).toBe(5)
    // No valid uncomposed merge source and no free instance (deck full) —
    // "+" falls through to the ordinary fresh-unit pull, exactly +1 layer.
    const plain = pins.find((p) => p.id === plainPinId)
    expect(plain?.layers).toBe(2)
    expect(pins).toHaveLength(2) // composed + plain — nothing deleted, nothing new created
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  // K#7d-strong: the SAME scenario as K#7d below but with quantity set so
  // the two possible implementations give DIFFERENT answers — proving
  // checkLayerChange is actually called with the nominal itemId's OWN
  // count within this placement (placementLayersOfItem, 2), not the
  // placement's flat total `layers` (5). With quantity=4: own-count-based
  // reasoning (2+1=3) correctly ALLOWS the push; a total-layers-based
  // reasoning (5+1=6) would have wrongly BLOCKED it. K#7d below (a
  // genuinely exhausted quantity=2) blocks under BOTH reasonings, so it
  // alone can't prove which one is actually used — this test can.
  it('handleLayerChangePinned("+") on a composed pin: quantity-check uses the nominal itemId\'s OWN layer count in this placement, not the flat total (K#7d-strong)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // 6, not 5: the column [A2, B3] is 5 m of 1 m units, and since Round 34
      // its TOTAL height has to fit the clearance — the pushed unit makes 6.
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 6 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 4, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    fireEvent.click(stackButton('Добавить ярус')!)

    const pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)!
    expect(pin.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }, { itemId: itemA.id, layers: 1 }])
    expect(pin.layers).toBe(6)
    expect(toast.warning).not.toHaveBeenCalled()
  })

  // Round 34: "+" on a composed pin checked only the nominal item's own
  // share (2 + 1 = 3 of its cap 5), so the 5 m column [A2, B3] could grow to
  // 6 m under a 5 m clearance — a single-item stack of the same height was
  // already refused.
  it('handleLayerChangePinned("+") on a composed pin is refused when the column would stand above the clearance', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 10, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    fireEvent.click(stackButton('Добавить ярус')!)

    const pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)!
    expect(pin.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }])
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('Выше предельной высоты'))
  })

  // Same guard, manual-mode path (findMergeSourceManual).
  it('handleLayerChangeManual("+") on an ORDINARY placement never absorbs a composed placement sharing its nominal itemId (findMergeSourceManual FAIL fix)', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 10, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'mComposed', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
      useCalculator.getState().addManualPlacement({
        id: 'mPlain', itemId: itemA.id, name: itemA.name, x: 4, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
      })
      useCalculator.setState({ selectedManualIds: ['mPlain'] })
    })

    fireEvent.click(stackButton('Добавить ярус')!)

    const placements = useCalculator.getState().manualPlacements
    const composed = placements.find((p) => p.id === 'mComposed')
    expect(composed?.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }])
    expect(composed?.layers).toBe(5)
    const plain = placements.find((p) => p.id === 'mPlain')
    expect(plain?.layers).toBe(2)
    expect(placements).toHaveLength(2)
  })

  // K#7a: bare pop directly on a fresh composed placement (no prior "+"),
  // decrementing a top segment that has more than one layer — distinct
  // from the push-then-pop reversibility test above, which only ever pops
  // a freshly-pushed single-layer segment (the removal sub-branch, not the
  // decrement sub-branch).
  it('handleLayerChangePinned("-") on [A2,B3] directly: decrements the top segment B, freeing a standalone B1 (K#7a)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 10, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    fireEvent.click(stackButton('Убрать ярус')!)

    const pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)!
    expect(pin.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 2 }])
    expect(pin.layers).toBe(4)
    expect(pin.weight).toBeCloseTo((2 * 100 + 2 * 200) / 4)
    const freed = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat().find((p) => p.id !== pinId)
    expect(freed?.itemId).toBe(itemB.id)
    expect(freed?.layers).toBe(1)
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
  })

  // K#7b: two sequential "-" clicks (no "+" in between) on a three-
  // constituent composed placement, verifying the PHYSICAL top segment is
  // popped correctly at EACH step: first the top segment is removed
  // entirely (layers===1), then the new top is decremented (layers>1).
  it('handleLayerChangeManual("-") twice in a row on [A1,B2,C1]: pops C entirely, then decrements B — each step frees the correct physical top (K#7b)', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 10, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 10, weight: 200 })
      useCalculator.getState().addItem({ name: 'C', width: 2, length: 1, quantity: 10, weight: 300 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    const itemC = useCalculator.getState().items.find((it) => it.name === 'C')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'mComp', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 4, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 1 }, { itemId: itemB.id, layers: 2 }, { itemId: itemC.id, layers: 1 }],
      })
      useCalculator.setState({ selectedManualIds: ['mComp'] })
    })

    // Step 1: top is C (layers: 1) -> removed entirely, freeing C1.
    fireEvent.click(stackButton('Убрать ярус')!)
    let comp = useCalculator.getState().manualPlacements.find((p) => p.id === 'mComp')!
    expect(comp.composition).toEqual([{ itemId: itemA.id, layers: 1 }, { itemId: itemB.id, layers: 2 }])
    let freedIds = useCalculator.getState().manualPlacements.filter((p) => p.id !== 'mComp').map((p) => p.itemId)
    expect(freedIds).toEqual([itemC.id])

    // Step 2: new top is B (layers: 2) -> decremented to 1, freeing B1 —
    // NOT C again, and NOT A (the nominal itemId).
    fireEvent.click(stackButton('Убрать ярус')!)
    comp = useCalculator.getState().manualPlacements.find((p) => p.id === 'mComp')!
    expect(comp.composition).toEqual([{ itemId: itemA.id, layers: 1 }, { itemId: itemB.id, layers: 1 }])
    freedIds = useCalculator.getState().manualPlacements.filter((p) => p.id !== 'mComp').map((p) => p.itemId).sort()
    expect(freedIds).toEqual([itemB.id, itemC.id].sort())

    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemC.id)?.quantity).toBe(10)
  })

  // K#7d: "+" on a composed placement when the nominal item's OWN quantity
  // is already fully placed — must block, leaving composition/state
  // completely untouched (mirrors the existing uncomposed quantity-cap
  // behavior, just routed through the composed branch's own checkLayerChange
  // call using placementLayersOfItem instead of the flat `pin.layers`).
  it('handleLayerChangePinned("+") on a composed pin is blocked when the nominal item\'s quantity is exhausted, and changes nothing (K#7d)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // Height allows more tiers, so «+» is offered and only the quantity
      // stops it (the button is inactive when the height does).
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 25 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 2, weight: 100 }) // exactly matches composition's own A count
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    fireEvent.click(stackButton('Добавить ярус')!)

    const pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)!
    expect(pin.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }])
    expect(pin.layers).toBe(5)
    expect(Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()).toHaveLength(1) // no new pin created
    expect(toast.warning).toHaveBeenCalled()
  })

  // R29 corrective pass: a Tier-2 malformed placement (no valid composition
  // to trust) is excluded from packing/capacity, but checkLayerChange's own
  // quantity scan reads the raw store arrays directly — before this fix it
  // still phantom-counted the malformed placement's raw, untrustworthy
  // `layers` toward A's "already placed" sum (its own itemId is genuinely
  // 'A'), wrongly blocking a real, legitimate "+" click on a separate,
  // ordinary placement of the same item. Manual mode (not pinned/AUTO) so
  // there's no auto-fill of A's own remaining quantity to confound the
  // merge-source lookup — this isolates checkLayerChange's own fix.
  it('handleLayerChangeManual("+") is not blocked by a co-existing Tier-2 malformed placement of the same item', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 8 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      // Target: 2 real layers. Malformed sibling: raw layers=6, itemId
      // genuinely 'A', excluded from packing/merge-source lookup (see the
      // R29 findMergeSourceManual guard fix) but NOT from this old bug's
      // phantom quantity count. 2 (real) + 6 (phantom, if wrongly counted)
      // + 1 (new) = 9 > 8 (blocked, bug). 2 (real) + 1 (new) = 3 <= 8 (fixed).
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 2, rotated: false, color: itemA.color,
      })
      useCalculator.getState().addManualPlacement({
        id: 'ghost', itemId: itemA.id, name: 'Ghost', x: 5, y: 5, width: 2, length: 1, layers: 6, rotated: false, color: itemA.color,
        malformed: { invalidComposition: true, rawComposition: [{ itemId: itemA.id, layers: 6 }, { itemId: 'garbage', layers: 1 }] },
      })
      useCalculator.setState({ selectedManualIds: ['target'] })
    })

    fireEvent.click(stackButton('Добавить ярус')!)

    const target = useCalculator.getState().manualPlacements.find((m) => m.id === 'target')!
    expect(target.layers).toBe(3) // succeeded
    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining('уже размещены'))
  })

  // K#7e: "+" on a composed placement must gate capacity on the weight of
  // ONE unit of the NOMINAL constituent being added — not `pin.weight`
  // (deliberately seeded with a wrong/stale value below), not the
  // composition's average per-unit weight, and not the full placement
  // weight. B is deliberately much heavier than A so the three candidate
  // weights (nominal A=50, average≈366.7, full=1100) are all clearly
  // distinct — only the nominal-weight-based check produces the expected
  // block here.
  it('handleLayerChangePinned("+") on a composed pin gates maxDeckCargoT on ONE unit of the nominal constituent\'s catalog weight (K#7e)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5, maxDeckCargoT: 1.14 } }) // 1140kg cap
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 10, weight: 50 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 1000 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      // Composition total weight = 2*50 + 1*1000 = 1100kg (already sitting
      // near the 1140kg cap). Deliberately seed `weight` with a WRONG
      // stale value (5) — if the implementation used `pin.weight` instead
      // of a fresh catalog lookup, 1100+5=1105 <= 1140 would WRONGLY pass.
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 3, rotated: false, color: itemA.color, weight: 5,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 1 }],
        layers: 3,
        weight: 5,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    // Nominal A's own catalog weight is 50 -> 1100+50=1150 > 1140 -> must
    // block. (An average-weight calc, ~366.7, or the stale `pin.weight`
    // of 5, would each give a DIFFERENT allow/block answer than this.)
    fireEvent.click(stackButton('Добавить ярус')!)

    const pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)!
    expect(pin.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 1 }])
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('лимит груза'))
  })

  // Multi-trip isolation: "-" on a composed pin in trip 2 must not touch
  // trip 1's placements at all (same per-trip guarantee every other pin
  // mutation already has — Round 21 introduces no new cross-trip code
  // path, this locks that in for the composed branch specifically).
  it('handleLayerChangePinned("-") on a composed pin in trip 2 does not affect trip 1 (multi-trip isolation)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // Same weight/quantity recipe as the existing "a trip already AT its
      // cap does not block '+' on a DIFFERENT trip" test above (proven to
      // force trips.length > 1 so the "Рейс 2" tab actually renders): a
      // 1t/trip cap with 4 units at 500kg each needs two trips. Widened to
      // 4.3 (vs that test's 2.2) so there's room for a SECOND 2x1
      // footprint next to the composed pin — otherwise findFreeSpotForItem
      // has nowhere to stand the freed B unit up and the pop's "stand up a
      // new placement" step silently no-ops, which a too-cramped deck was
      // masking in an earlier version of this test.
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 4.3, length: 1.2, boardOffset: 0, gap: 0.1, clearance: 5, maxDeckCargoT: 1 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 4, weight: 500 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let trip1PinId = ''
    let trip2PinId = ''
    act(() => {
      trip1PinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 0.1, y: 0.1, width: 2, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 500,
      })
      trip2PinId = useCalculator.getState().pinFromPlaced(1, {
        itemId: itemA.id, name: itemA.name, x: 0.1, y: 0.1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(1, trip2PinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })
    const trip1Before = JSON.stringify(useCalculator.getState().pinnedPlacementsByTrip[0])

    // Switches the ACTIVE trip to trip 2 (index 1) — the "Рейс 2" tab
    // click drives page.tsx's own `activeTripIndex` React state, which
    // `clampedTripIndex` (and therefore every `updatePinned`/`pinFromPlaced`
    // call the production handler below makes) is derived from.
    fireEvent.click(screen.getByText(/Рейс 2/))
    act(() => {
      useCalculator.setState({ selectedPinIds: [trip2PinId] })
    })
    // The real "-" click -> handleLayerChangePinned's composed branch,
    // exactly the production path (not a direct store call).
    fireEvent.click(stackButton('Убрать ярус')!)

    // Trip 2's composed pin popped correctly.
    const trip2 = useCalculator.getState().pinnedPlacementsByTrip[1]
    const composedTrip2 = trip2.find((p) => p.id === trip2PinId)!
    expect(composedTrip2.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 2 }])
    // The freed standalone B unit lands in TRIP 2 specifically (the active
    // trip the handler ran against), not trip 1 or some other trip.
    const freedInTrip2 = trip2.find((p) => p.id !== trip2PinId)
    expect(freedInTrip2?.itemId).toBe(itemB.id)
    expect(freedInTrip2?.layers).toBe(1)
    expect(trip2).toHaveLength(2) // composed + freed, both in trip 2
    // Trip 1's own pin is completely untouched — same array contents,
    // same length (no freed unit leaked in here) — and no B-item pin of
    // any kind exists in trip 1.
    expect(JSON.stringify(useCalculator.getState().pinnedPlacementsByTrip[0])).toBe(trip1Before)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === trip1PinId)?.layers).toBe(2)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0].some((p) => p.itemId === itemB.id)).toBe(false)
  })

  // Round 22 — DeckVisualization mixed-load / multi-category rendering.
  // Before this round, a composed placement rendered indistinguishably
  // from an ordinary placement of its nominal item: one solid nominal
  // color, and a corner category label resolved only via
  // `categoryByItemId.get(p.itemId)` (nominal itemId), silently hiding
  // any non-nominal constituent's own category. `#475569` is the mixed-
  // load marker's own unique fill (DeckVisualization.tsx) — not used
  // anywhere else in the file, so it's a safe, specific selector. Since
  // stage 1 (spec 6.2) the stack's category is shown by its inspector
  // (placementCategoryLabel), with the same rules.
  it('DeckVisualization: uncomposed placement never renders the mixed-load marker (regression)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000', category: 'Обычный' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 3, rotated: false, color: itemA.color,
      })
    })

    expect(document.querySelector('svg circle[fill="#475569"]')).toBeNull()
    // The base fill is still the cargo's own tone (by its number, spec
    // 9.2), and the single real category is the stack's category.
    expect(document.querySelector(`svg rect[fill="${cargoToneForNumber(1)}"]`)).toBeTruthy()
    expect(inspectorCategoryOfPin(pinId)).toBe('Обычный')
  })

  it('DeckVisualization: composed [A2,B3] with the SAME category shows the mixed-load marker but keeps the single category label (K#R22-same-category)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000', category: 'Обычный' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 5, color: '#0000ff', category: 'Обычный' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    // Both constituents share "Обычный" -> not "Смешанный груз": the single
    // real category still shows (not replaced just because the placement
    // happens to be composed).
    expect(inspectorCategoryOfPin(pinId)).toBe('Обычный')
    // Base nominal rendering (color) is untouched.
    expect(document.querySelector(`svg rect[fill="${cargoToneForNumber(1)}"]`)).toBeTruthy()
  })

  // R29 corrective pass: category for a composed placement must be
  // determined ONLY from `constituentCategories` (composition-derived),
  // never falling back to `categoryByItemId?.get(p.itemId)` — a Tier-1
  // placement's nominal itemId isn't guaranteed to resolve, and the old
  // fallback would silently show NO category label even though the real
  // constituents share one.
  it('Tier-1: category still shows the single shared constituent category even with a broken nominal itemId', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // quantity EXACTLY matches what the composition below consumes (2, 3)
      // so nothing is left for the AUTO packer to auto-fill elsewhere —
      // an auto-filled leftover of the same category would render its OWN
      // correct label and mask a broken fix in THIS placement's own
      // category computation.
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 2, color: '#ff0000', category: 'Опасный груз' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, color: '#0000ff', category: 'Опасный груз' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: 'P', x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        itemId: 'deleted-item', // broken nominal — old code's fallback would find nothing here
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    // NOT blank/missing despite the broken nominal id.
    expect(inspectorCategoryOfPin(pinId)).toBe('Опасный груз')
  })

  it('DeckVisualization: composed [A2,B3] with DIFFERENT categories shows "Смешанный груз" instead of the nominal-only category (K#R22-mixed-category)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // Quantities set to EXACTLY what the composition uses (2 and 3) —
      // otherwise AUTO auto-places the leftover unplaced units of A
      // elsewhere on the deck as their own genuine (uncomposed) A
      // placement, which would legitimately show "Обычный" too and make
      // the "no longer appears" assertion below a false failure.
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 2, color: '#ff0000', category: 'Обычный' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, color: '#0000ff', category: 'Опасный груз' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    // Not the nominal-only category, which would silently hide B's.
    expect(inspectorCategoryOfPin(pinId)).toBe('Смешанный груз')
  })

  // Corrective pass (post-review): A has a real category, B has NONE set.
  // Per the existing project-wide contract for an absent category
  // (violatesSeparation/lashingMethodologyFor in packing.ts both treat "no
  // category" as "doesn't participate", never as its own distinct
  // category that can conflict with a real one), this must NOT show
  // "Смешанный груз" — it shows A's real category alone, same as it
  // always would for a single-category composition. This is a deliberate,
  // contract-derived decision, not an oversight — see the `.filter(Boolean)`
  // comment in DeckVisualization.tsx for the full reasoning.
  it('DeckVisualization: composed [A2,B3] where B has NO category set does not show "Смешанный груз" — undefined is not a distinct category (K#R22-undefined-category)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 2, color: '#ff0000', category: 'Металл' })
      // No `category` passed for B — matches CargoItem.category's optional
      // contract (free text, absent = not set).
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, color: '#0000ff' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    expect(itemB.category).toBeUndefined()
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    // Still composed -> mixed-load marker present (that part is unrelated
    // to category logic — driven purely by segment count).
    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    expect(inspectorCategoryOfPin(pinId)).toBe('Металл')
  })

  // Corrective pass: [A2,A3] — two NON-ADJACENT segments of the SAME
  // itemId (a real, reachable shape once merge/push start producing
  // composition — see the migration plan's merge examples, e.g.
  // composed(A2+B3) + single(A1) never coalescing across a B boundary).
  // The mixed-load marker is driven purely by segment COUNT
  // (segmentsOf(p).length > 1), not by distinct item identity — so it
  // still shows here even though physically only ONE CargoItem is
  // involved. This is the user-specified expected behavior: the marker
  // signals "this placement's composition is segmented", not strictly
  // "contains more than one distinct item type". Category and the ×N
  // total-count badge are unaffected either way, since both are already
  // itemId/count-based, not segment-count-based.
  it('DeckVisualization: composed [A2,A3] (same itemId, non-adjacent segments) still shows the mixed-load marker, but category and ×N stay normal (K#R22-same-item-composed)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000', category: 'Металл' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemA.id, layers: 3 }],
        layers: 5,
      })
    })

    // Marker present (segment count > 1) despite only one real item type.
    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    // ×N still reads the true total unit count (5), unaffected by how many
    // composition segments make it up — and one cargo number, not «1+1».
    expect(document.querySelector('svg g[data-cargo-placement]')?.getAttribute('data-stack-text')).toBe('1 ×5')
    expect(inspectorCategoryOfPin(pinId)).toBe('Металл')
  })

  it('DeckVisualization: composed placement with different constituent COLORS still renders the nominal base fill unchanged, marker present (K#R22-colors)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 5, color: '#00ff00' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    // Base fill stays the nominal cargo's tone (cargo 1 here, by its number
    // in the list) — the composition only ADDS the marker.
    expect(document.querySelector(`svg rect[fill="${cargoToneForNumber(1)}"]`)).toBeTruthy()
  })

  // Geometry corrective pass — the un-clamped marker position
  // (x + w - 30) placed the marker ENTIRELY outside the placement's own
  // footprint at the mixed-load gate's own minimum width (w=16, marker
  // span [x-20, x-8]). This forces a placement rendered right at/near
  // that minimum width and checks the marker's actual DOM geometry stays
  // attached to the box, rather than asserting presence alone (which the
  // pre-fix code already satisfied — the marker was there, just floating
  // off to the side).
  //
  // Deck sized to 500x300 (deck units) puts scale at
  // min(836/500, 496/300) ≈ 1.653 px/unit; a 10x10 unit item then renders
  // at ≈16.53 screen px — just above the w>=16 && h>=16 gate, the
  // smallest production-reachable size at which the marker (or the
  // existing ×N badge) renders at all.
  it('DeckVisualization: mixed-load marker geometry stays attached to the placement at the gate\'s minimum width (K#R22-geometry-boundary)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 500, length: 300 } })
      useCalculator.getState().addItem({ name: 'A', width: 10, length: 10, height: 1, quantity: 5, color: '#ff0000' })
      useCalculator.getState().addItem({ name: 'B', width: 10, length: 10, height: 1, quantity: 5, color: '#0000ff' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 10, y: 10, width: 10, length: 10, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    const box = document.querySelector(`svg rect[fill="${cargoToneForNumber(1)}"]`)
    const marker = document.querySelector('svg circle[fill="#475569"]')
    expect(box).toBeTruthy()
    expect(marker).toBeTruthy()
    const boxX = Number(box!.getAttribute('x'))
    const boxW = Number(box!.getAttribute('width'))
    // Sanity check this test actually landed at the intended boundary size
    // — if this fails, the deck/item dimensions above no longer produce a
    // ~16-17px box and the test isn't exercising the gate's minimum.
    expect(boxW).toBeGreaterThanOrEqual(16)
    expect(boxW).toBeLessThan(20)
    const mcx = Number(marker!.getAttribute('cx'))
    const mr = Number(marker!.getAttribute('r'))
    // The core assertion: the marker's circle must overlap the placement's
    // own horizontal extent [boxX, boxX + boxW] — NOT be entirely to the
    // left of it (which the pre-fix formula produced: mcx+mr = -8 at
    // boxX=0, strictly less than boxX).
    expect(mcx + mr).toBeGreaterThanOrEqual(boxX)
    expect(mcx - mr).toBeLessThanOrEqual(boxX + boxW)
  })

  // Same scenario at a normal (non-boundary) width — proves the clamp is a
  // no-op there and the marker renders at EXACTLY the original formula's
  // position, i.e. adaptive positioning does not regress the existing
  // appearance for the vast majority of real placements.
  it('DeckVisualization: mixed-load marker keeps its original (unclamped) position at normal placement width (K#R22-geometry-normal-width)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 5, color: '#0000ff' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    const box = document.querySelector(`svg rect[fill="${cargoToneForNumber(1)}"]`)
    const marker = document.querySelector('svg circle[fill="#475569"]')
    expect(box).toBeTruthy()
    expect(marker).toBeTruthy()
    const boxX = Number(box!.getAttribute('x'))
    const boxW = Number(box!.getAttribute('width'))
    // Confirms this is genuinely a "normal" (non-boundary) width, well
    // clear of the gate's own minimum.
    expect(boxW).toBeGreaterThan(40)
    const mcx = Number(marker!.getAttribute('cx'))
    // Exact original formula: x + w - 30 — the clamp must be a no-op here.
    expect(mcx).toBeCloseTo(boxX + boxW - 30, 5)
  })

  it('DeckVisualization: mixed-load marker coexists with the locked badge without replacing it (interaction regression)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 5, color: '#0000ff' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
        locked: true,
      })
    })

    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    expect(document.querySelector('svg [data-mark="lock"]')).toBeTruthy()
  })

  it('DeckVisualization: mixed-load marker coexists with selection highlight without changing the selection stroke (interaction regression)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 5, color: '#0000ff' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    // Selection still draws its outline (spec 6.3: an inner dark line and an
    // outer accent band) — untouched by the marker, a separate <g>.
    expect(document.querySelector(`svg [data-selection-halo] [stroke="${THEME_TOKENS.light.accent}"]`)).toBeTruthy()
  })

  // Round 23 — composition-aware quantity attribution in the cargo list
  // and onPlace's quantity gate. Before this round, both independently
  // grouped `result.placed`/store placements by nominal `itemId` alone, so
  // a composed [A2,B3] (nominal itemId=A) showed "A: 5 placed, B: 0 placed"
  // instead of "A: 2, B: 3".
  const cargoRow = (name: string) => {
    const row = screen.getAllByTestId('cargo-list-row').find((r) => within(r).queryByTitle(name))
    if (!row) throw new Error(`no cargo list row for «${name}»`)
    return row
  }

  it('cargo list: composed [A2,B3] shows 2 of 2 placed for A and 3 of 3 for B, not 5 and 0 (K#R23-itemlist)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 2, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    expect(cargoRow('A')).toHaveTextContent(/Размещено 2\s*из/)
    expect(cargoRow('B')).toHaveTextContent(/Размещено 3\s*из/)
    expect((within(cargoRow('B')).getByLabelText('Всего, B') as HTMLInputElement).value).toBe('3')
  })

  it('cargo list in manual mode: composed [A2,B3] credits each constituent with its own units (K#R23-placementpanel)', () => {
    render(<Home />)
    clearDemoCargo()
    // Manual mode — AUTO would auto-place A's 2 genuinely-remaining units
    // somewhere else on the deck on its own, so nothing would stay off it.
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      // A: 2 used by the composition, 2 more genuinely available.
      // B: 3 used by the composition, fully consumed.
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 4, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
    })

    // Pre-fix, A would wrongly show 5 placed (over its 4) and B would show
    // 0 (never credited with its 3 units at all).
    expect(cargoRow('A')).toHaveTextContent(/Размещено 2\s*из/)
    expect(cargoRow('B')).toHaveTextContent(/Размещено 3\s*из/)
  })

  // onPlace's quantity gate (page.tsx) — functional, not just display: it
  // decides whether a stamp click is allowed to actually place a unit.
  //
  // The deck click path (DeckVisualization's handleDeckClick) converts
  // clientX/clientY to deck coordinates via `svg.createSVGPoint()` /
  // `svg.getScreenCTM()` — real SVG geometry APIs jsdom doesn't implement
  // (no layout engine), so an un-mocked click would silently no-op before
  // ever reaching onPlace, making the test pass for the wrong reason (it
  // did nothing). These two tests install a local identity-transform
  // polyfill for exactly this pair of methods so clientX/clientY behave
  // as literal deck-space screen coordinates once translated through the
  // deck's own offX/offY/scale — restored after each test so no other
  // test's environment is affected.
  const withIdentitySvgTransform = (fn: () => void) => {
    const proto = SVGSVGElement.prototype as unknown as {
      createSVGPoint?: () => { x: number; y: number; matrixTransform: (m: unknown) => { x: number; y: number } }
      getScreenCTM?: () => { inverse: () => unknown } | null
    }
    const origCreateSVGPoint = proto.createSVGPoint
    const origGetScreenCTM = proto.getScreenCTM
    proto.createSVGPoint = function (this: { __x?: number; __y?: number }) {
      const pt = {
        x: 0,
        y: 0,
        matrixTransform: () => ({ x: pt.x, y: pt.y }),
      }
      return pt
    }
    proto.getScreenCTM = () => ({ inverse: () => ({}) })
    try {
      fn()
    } finally {
      proto.createSVGPoint = origCreateSVGPoint
      proto.getScreenCTM = origGetScreenCTM
    }
  }
  // Deck is fixed at 10x10 (deck units) with the default clearance for
  // both tests below, so the same offX/offY/scale (and thus the same
  // clientX/clientY -> deck-space mapping) applies to both. scale =
  // min((900-64)/10, (560-64)/10) = min(83.6, 49.6) = 49.6; deck not
  // "rotated" (length == width); offX = (900 - 10*49.6)/2 = 202,
  // offY = (560 - 10*49.6)/2 = 32. clientX=450/clientY=280 maps to
  // deck-space (5,5) — clear of the existing pin at [1,3]x[1,2].
  const DECK_CLICK_CLIENT_X = 450
  const DECK_CLICK_CLIENT_Y = 280

  it('onPlace quantity gate: composed [A2,B3] blocks placing more B once its own 3 units are accounted for (K#R23-onplace-block-B)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 4, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    // Arm B's stamp and click empty deck space — B's own 3 units are
    // already fully accounted for (composition-aware), so this must be
    // BLOCKED. Pre-fix, B's flat `pin.itemId === B` filter found nothing
    // (the composed pin's own itemId is A) and would have wrongly ALLOWED
    // this, silently over-placing B past its declared quantity.
    act(() => {
      useCalculator.getState().setActiveStamp(itemB.id)
    })
    const before = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat().length
    withIdentitySvgTransform(() => {
      fireEvent.click(document.querySelector('svg[data-deck-plan]')!, { clientX: DECK_CLICK_CLIENT_X, clientY: DECK_CLICK_CLIENT_Y })
    })
    expect(Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat().length).toBe(before)
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('уже размещены'))
  })

  // The presets keep a long item's long side in «ширина», across the ship:
  // on the 8 m wide deck a 9.5 m pipe fits only turned fore and aft.
  it('a stamp that fits the deck only turned is placed turned', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 8, length: 20 } })
      useCalculator.getState().addItem({ name: 'Труба', width: 9.5, length: 0.25, height: 0.25, quantity: 1, weight: 700 })
    })
    const pipe = useCalculator.getState().items.find((it) => it.name === 'Труба')!
    act(() => {
      useCalculator.getState().setActiveStamp(pipe.id)
    })
    withIdentitySvgTransform(() => {
      fireEvent.click(document.querySelector('svg[data-deck-plan]')!, { clientX: DECK_CLICK_CLIENT_X, clientY: DECK_CLICK_CLIENT_Y })
    })
    const placed = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    expect(placed).toHaveLength(1)
    expect(placed[0]).toMatchObject({ width: 0.25, length: 9.5, rotated: true })
  })

  it('onPlace quantity gate: composed [A2,B3] still allows placing more A when A\'s true remaining quantity is positive (K#R23-onplace-allow-A)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10, clearance: 5 } })
      // A: quantity 4, only 2 used by the composition -> 2 genuinely remain.
      // Pre-fix, the flat filter would have summed this ONE placement's
      // full `pin.layers` (5, the total) as "A placed", wrongly reporting
      // 5 >= 4 and blocking this click outright.
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 4, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    act(() => {
      useCalculator.getState().setActiveStamp(itemA.id)
    })
    const before = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat().length
    withIdentitySvgTransform(() => {
      fireEvent.click(document.querySelector('svg[data-deck-plan]')!, { clientX: DECK_CLICK_CLIENT_X, clientY: DECK_CLICK_CLIENT_Y })
    })
    expect(Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat().length).toBe(before + 1)
    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining('уже размещены'))
  })

  // R29 corrective pass: onPlace's own quantity gate (the third of three
  // identical `layersOfIdIn` scanners) must not phantom-count a Tier-2
  // malformed placement's raw layers either — same fix, same reason as
  // checkLayerChange/updateItem above.
  it('onPlace quantity gate (MANUAL) is not blocked by a co-existing Tier-2 malformed placement of the same item', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 6, weight: 100 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      // Malformed sibling: raw layers=6, itemId genuinely 'A', excluded
      // from packing/capacity. Nothing genuinely placed. If wrongly
      // phantom-counted, 6 (phantom) + 1 (new) = 7 > 6 (quantity) -> blocked.
      // Correctly excluded: 0 (real) + 1 (new) = 1 <= 6 -> allowed.
      useCalculator.getState().addManualPlacement({
        id: 'ghost', itemId: itemA.id, name: 'Ghost', x: 5, y: 5, width: 2, length: 1, layers: 6, rotated: false, color: itemA.color,
        malformed: { invalidComposition: true, rawComposition: [{ itemId: itemA.id, layers: 6 }, { itemId: 'garbage', layers: 1 }] },
      })
      useCalculator.getState().setActiveStamp(itemA.id)
    })
    const before = useCalculator.getState().manualPlacements.length
    withIdentitySvgTransform(() => {
      fireEvent.click(document.querySelector('svg[data-deck-plan]')!, { clientX: DECK_CLICK_CLIENT_X, clientY: DECK_CLICK_CLIENT_Y })
    })
    expect(useCalculator.getState().manualPlacements.length).toBe(before + 1)
    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining('уже размещены'))
  })

  it('selecting different auto-redistribute variants actually applies each one (regression: applyVariant ignored the chosen variant in auto mode)', () => {
    render(<Home />)
    // Keep the demo cargo (~22 units across 3 item types) so packDeckVariants
    // has enough to produce multiple genuinely distinct layouts.
    clickAutoRedistribute()

    const variantButtons = screen.getAllByText(/^Вариант \d/)
    expect(variantButtons.length).toBeGreaterThanOrEqual(2)

    fireEvent.click(variantButtons[0])
    const afterFirst = JSON.stringify(useCalculator.getState().pinnedPlacementsByTrip)

    fireEvent.click(variantButtons[1])
    const afterSecond = JSON.stringify(useCalculator.getState().pinnedPlacementsByTrip)

    // The old bug: applyVariant's auto-mode branch just cleared pins and let
    // the live recompute (using whatever sortStrategy the store already had)
    // redraw, ignoring the variant's own strategy/seed entirely - so picking
    // "Вариант 1" vs "Вариант 2" produced the identical layout every time.
    expect(afterFirst).not.toBe(afterSecond)
    // Both should actually be pinned (locked to that variant), not empty.
    expect(Object.values(JSON.parse(afterFirst)).flat().length).toBeGreaterThan(0)
    expect(Object.values(JSON.parse(afterSecond)).flat().length).toBeGreaterThan(0)
  })

  it('handleRotatePinned respects allowRotation (regression: canvas rotate used to bypass the lock)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1, allowRotation: false })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    // «Повернуть» is off, with the reason (spec 6.3); Space says it.
    expect(stackButton('Повернуть')).toHaveProperty('disabled', true)
    expect(inspectorButton('Повернуть')).toHaveProperty('disabled', true)
    expect(within(screen.getByRole('complementary', { name: 'Инспектор' })).getByText('Груз «Box» не разрешает поворот')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })

    expect(toast.warning).toHaveBeenCalledWith('Груз «Box» не разрешает поворот')
    const pin = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()[0]
    expect(pin.rotated).toBe(false)
    expect(pin.width).toBe(2)
    expect(pin.length).toBe(1)
  })

  // Regression (Round 12): a cross-item merge folding in an item whose
  // CargoItem.allowRotation is false used to leave the merged (surviving)
  // placement's rotation permission resolved purely from ITS OWN itemId's
  // catalog allowRotation — silently forgetting the dragged item's
  // restriction the moment that item's own placement was removed by the
  // merge. rotationLocked is the persistent flag a merge sets to close
  // that gap; this proves it's actually honored by the rotate path even
  // when the placement's own itemId currently allows rotation.
  it('handleRotatePinned respects rotationLocked even when the placement\'s own item allows rotation', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1, allowRotation: true })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.getState().updatePinned(0, pinId, { rotationLocked: true })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    expect(stackButton('Повернуть')).toHaveProperty('disabled', true)
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })

    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('не разрешает поворот'))
    const pin = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()[0]
    expect(pin.rotated).toBe(false)
  })

  // R29 corrective pass: `rotationLocked` alone is NOT proven authoritative
  // for every composed placement (only for ones created through the live
  // merge/+/- pipeline) — a hydrated/imported composed placement can carry
  // a stale/absent `rotationLocked` even though a real constituent
  // disallows rotation. Rotation permission for a composed placement must
  // be checked LIVE from composition + the current catalog.
  it('Tier-1: rotation is blocked for a composed placement via LIVE composition + catalog, even with a broken nominal itemId and rotationLocked unset', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5, allowRotation: true })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 5, allowRotation: false })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: 'P', x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      // Simulates a hydrated/imported composed placement: valid
      // composition (B disallows rotation), broken nominal itemId,
      // rotationLocked deliberately left unset — the exact gap normalizeProject's
      // hydration doesn't currently re-derive.
      useCalculator.getState().updatePinned(0, pinId, {
        itemId: 'deleted-item',
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        rotationLocked: undefined,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    // The reason names the cargo in the stack that can't turn.
    expect(stackButton('Повернуть')).toHaveProperty('disabled', true)
    expect(within(screen.getByRole('complementary', { name: 'Инспектор' })).getByText('Груз «B» в штабеле не разрешает поворот')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })

    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('не разрешает поворот'))
    const pin = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()[0]
    expect(pin.rotated).toBe(false)
  })

  // Opposite direction: a Tier-1 placement whose EVERY constituent allows
  // rotation must NOT be permanently blocked just because its nominal
  // itemId is broken — proving the fix doesn't over-restrict.
  it('Tier-1: rotation is ALLOWED for a composed placement whose every real constituent allows it, despite a broken nominal itemId', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 20, length: 20, boardOffset: 0, gap: 0 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5, allowRotation: true })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 5, allowRotation: true })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: 'P', x: 5, y: 5, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        itemId: 'deleted-item',
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        rotationLocked: undefined,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    const rotateCircle = stackButton('Повернуть')
    fireEvent.click(rotateCircle!)

    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining('не разрешает поворот'))
    const pin = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()[0]
    expect(pin.rotated).toBe(true)
  })

  // R29 corrective pass: «Снять все закрепления» must not appear when the
  // ONLY locked pin is a Tier-2 quarantined one — nothing is visibly on the
  // deck to clear (keptByVariants leaves quarantined records out).
  it('«Снять все закрепления» does not appear when the only locked pin is Tier-2 quarantined', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: 'Ghost', x: 1, y: 1, width: 2, length: 1, layers: 6, rotated: false, color: itemA.color, locked: true,
      })
    })
    openSection('Размещение')
    expect(screen.getByTestId('variants-kept')).toHaveTextContent('Закреплённые штабели (1) остаются на местах')
    expect(screen.getByRole('button', { name: 'Снять все закрепления' })).toBeTruthy()
    act(() => {
      const pinId = useCalculator.getState().pinnedPlacementsByTrip[0][0].id
      useCalculator.getState().updatePinned(0, pinId, {
        malformed: { invalidComposition: true, rawComposition: [{ itemId: itemA.id, layers: 6 }, { itemId: 'garbage', layers: 1 }] },
      })
    })
    expect(screen.queryByRole('button', { name: 'Снять все закрепления' })).toBeNull()
  })

  it('warns (once) when a placement newly exceeds a load zone\'s density limit', async () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1, weight: 5000 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, weight: 5000,
      })
    })
    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining('Перегрузка'))

    // A zone covering the placement with a limit low enough that 5000kg/2m²
    // (2.5 t/m²) exceeds it.
    act(() => {
      useCalculator.getState().addLoadZone({ x: 0, y: 0, width: 5, length: 5, maxLoadPerArea: 0.1 })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('Перегрузка'))

    // Re-render for an unrelated reason (toggling a display setting) should
    // NOT re-fire the warning - the overloaded count hasn't changed.
    const warningCallsAfterFirst = (toast.warning as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    act(() => {
      useCalculator.getState().toggleGrid()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect((toast.warning as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(warningCallsAfterFirst)
  })

  it('handleModeChange (auto -> manual) converts pinned placements to manual and clears pins', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
    })
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)

    fireEvent.click(screen.getByText('Ручной'))

    expect(useCalculator.getState().mode).toBe('manual')
    // The single trip being converted is cleared (its data now lives in
    // manualPlacements) — but the map itself isn't wiped to {} anymore, see
    // the multi-trip regression test below for why that distinction matters.
    expect(useCalculator.getState().pinnedPlacementsByTrip).toEqual({ 0: [] })
    expect(useCalculator.getState().manualPlacements).toHaveLength(1)
    expect(useCalculator.getState().manualPlacements[0].itemId).toBe(item.id)
  })

  // Round 20 (composition-only preservation). handleModeChange's AUTO->MANUAL
  // branch sources from `result.placed` (PlacedItem[]) — PlacedItem already
  // carries `composition` (Round 14, copy-through only), so this is a
  // straight passthrough that was simply missing before this round.
  it('handleModeChange (AUTO -> MANUAL) preserves composition on a composed pin', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // quantity exactly matching what the composed pin's own composition
      // consumes (2 of A, 3 of B) — otherwise AUTO auto-packs the remaining
      // unplaced quantity of both items alongside the pin, polluting
      // manualPlacements with unrelated extra placements after the switch.
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 2 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 3 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
    })

    fireEvent.click(screen.getByText('Ручной'))

    expect(useCalculator.getState().manualPlacements).toHaveLength(1)
    expect(useCalculator.getState().manualPlacements[0].composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
    ])
  })

  // Round 20: handleModeChange's MANUAL->AUTO branch sources from raw stored
  // ManualPlacements directly — same passthrough, different source.
  it('handleModeChange (MANUAL -> AUTO) preserves composition on a composed manual placement', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 5 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1,
        layers: 5, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
    })

    fireEvent.click(screen.getByRole('radio', { name: 'Авто' }))
    // Manual → Auto asks first (Phase 0, L5); these tests cover the
    // keep-positions conversion.
    fireEvent.click(screen.getByRole('button', { name: 'Оставить позиции' }))

    const pins = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    expect(pins).toHaveLength(1)
    expect(pins[0].composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
    ])
  })

  // Round 20: handleAutoRedistribute's frozenPinned freezes a LOCKED
  // composed pin in place, and applyVariant's AUTO branch (auto-applied
  // immediately after redistribute) must carry its composition through.
  // Together these cover BOTH the frozenPinned passthrough AND applyVariant
  // AUTO in one real end-to-end interaction.
  it('handleAutoRedistribute + applyVariant (AUTO): a LOCKED composed pin survives redistribute with composition intact', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 5 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        locked: true,
      })
    })

    clickAutoRedistribute()

    // applyVariant assigns a brand-new id to every placed item (including
    // the frozen one), so match by the frozen/locked position instead —
    // freezing means it must not have moved.
    const pins = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    const survivor = pins.find((p) => Math.abs(p.x - 1) < 0.01 && Math.abs(p.y - 1) < 0.01)
    expect(survivor?.composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
    ])
  })

  // Round 20: same redistribute flow, but starting from MANUAL mode — covers
  // frozenPinned's OTHER source (manualPlacements, not pinnedPlacements) and
  // applyVariant's MANUAL branch. A manual placement has no `locked` field,
  // so `clearanceMargin` is what freezes it for handleAutoRedistribute here.
  it('handleAutoRedistribute + applyVariant (MANUAL): a clearance-zoned composed placement survives redistribute with composition intact', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 5 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1,
        layers: 5, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        clearanceMargin: { top: 0, right: 0, bottom: 0, left: 0 },
      })
    })

    clickAutoRedistribute()

    const survivor = useCalculator.getState().manualPlacements.find((p) => Math.abs(p.x - 1) < 0.01 && Math.abs(p.y - 1) < 0.01)
    expect(survivor?.composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
    ])
  })

  // A placement quarantined on load (malformed, no composition) is never in
  // result.placed — the handlers that rebuild a placement list from it used
  // to delete it (AUTO->MANUAL, applyVariant) or drop its `malformed` flag
  // (MANUAL->AUTO), which turned it back into an ordinary, counted pin. The
  // load-time toast promises it stays in the project and out of every
  // calculation.
  const ghostPlacement = (itemId: string) => ({
    id: 'ghost', itemId, name: 'Ghost', x: 5, y: 5, width: 1, length: 1, layers: 6, rotated: false, color: '#000', weight: 100,
    malformed: { invalidComposition: true as const, rawComposition: [{ itemId, layers: 2 }, { itemId: 'garbage', layers: 4 }] },
  })

  it('a quarantined placement survives a MANUAL -> AUTO -> MANUAL round trip, still quarantined', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, quantity: 2 })
    })
    const itemA = useCalculator.getState().items[0]
    act(() => {
      useCalculator.setState({ manualPlacements: [ghostPlacement(itemA.id)] })
    })

    fireEvent.click(screen.getByText('Авто'))
    const pins = useCalculator.getState().pinnedPlacementsByTrip[0] ?? []
    expect(pins).toHaveLength(1)
    expect(pins[0].malformed?.invalidComposition).toBe(true)

    fireEvent.click(screen.getByText('Ручной'))
    const manual = useCalculator.getState().manualPlacements
    expect(manual.filter((m) => m.malformed)).toHaveLength(1)
    expect(manual.find((m) => m.malformed)?.layers).toBe(6)
  })

  it('a quarantined placement survives auto-redistribute in MANUAL mode', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, quantity: 2 })
    })
    const itemA = useCalculator.getState().items[0]
    act(() => {
      useCalculator.setState({ manualPlacements: [ghostPlacement(itemA.id)] })
    })

    clickAutoRedistribute()

    expect(useCalculator.getState().manualPlacements.filter((m) => m.malformed)).toHaveLength(1)
  })

  // Regression: handleModeChange used to convert ONLY the currently-viewed
  // trip and then wipe pinnedPlacementsByTrip to {} entirely (AUTO->MANUAL)
  // or hard-code everything into trip 0 (MANUAL->AUTO), silently destroying
  // every other trip's pins. A real multi-trip plan (not trip 0) is the
  // only way to catch this — the two tests above only ever exercised a
  // single trip, where wiping {} and writing {0: ...} looked identical to
  // "correct."
  it('preserves OTHER trips when switching mode while viewing a non-zero trip, both directions', () => {
    render(<Home />)
    clearDemoCargo()
    // A deck that fits exactly one 2x1 unit per trip forces packMultiTrip
    // to actually generate a second trip instead of fitting everything on
    // trip 0 alone.
    act(() => {
      useCalculator.getState().setDeck({ width: 3, length: 1, gap: 0, boardOffset: 0 })
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 0, y: 0, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.getState().pinFromPlaced(1, {
        itemId: item.id, name: item.name, x: 0, y: 0, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
    })
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[1]).toHaveLength(1)

    // Switch to trip 2 (index 1) before switching mode.
    fireEvent.click(screen.getByText(/Рейс 2/))
    fireEvent.click(screen.getByText('Ручной'))
    // Trip 1's cargo goes unplaced in single-trip manual mode — confirmed
    // through the warning (Phase 0, L21).
    fireEvent.click(screen.getByRole('button', { name: 'Перейти' }))

    expect(useCalculator.getState().mode).toBe('manual')
    // Trip 0's pin must survive completely untouched.
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].itemId).toBe(item.id)
    // Trip 1 (the one being edited) is now represented as manual instead.
    expect(useCalculator.getState().pinnedPlacementsByTrip[1]).toEqual([])
    expect(useCalculator.getState().manualPlacements).toHaveLength(1)

    // Switch back to AUTO — the edit must land back in trip 1, not trip 0.
    fireEvent.click(screen.getByRole('radio', { name: 'Авто' }))
    // Manual → Auto asks first (Phase 0, L5); these tests cover the
    // keep-positions conversion.
    fireEvent.click(screen.getByRole('button', { name: 'Оставить позиции' }))

    expect(useCalculator.getState().mode).toBe('auto')
    expect(useCalculator.getState().manualPlacements).toHaveLength(0)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].itemId).toBe(item.id)
    expect(useCalculator.getState().pinnedPlacementsByTrip[1]).toHaveLength(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[1][0].itemId).toBe(item.id)
  })

  it('handleModeChange (manual -> auto) converts manual placements back to trip-0 pins', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
    })

    // getByText('Авто') is now ambiguous — PlacementPanel's preset category
    // picker also has an "Авто" (vehicles) button. Scope to the mode toggle.
    fireEvent.click(screen.getByRole('radio', { name: 'Авто' }))
    // Manual → Auto asks first (Phase 0, L5); these tests cover the
    // keep-positions conversion.
    fireEvent.click(screen.getByRole('button', { name: 'Оставить позиции' }))

    expect(useCalculator.getState().mode).toBe('auto')
    expect(useCalculator.getState().manualPlacements).toHaveLength(0)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].itemId).toBe(item.id)
  })

  it('autosaves the active project after the debounce window', () => {
    vi.useFakeTimers()
    render(<Home />)
    clearDemoCargo()
    const activeId = useProjects.getState().activeId
    expect(activeId).toBeTruthy()

    act(() => {
      useCalculator.getState().addItem({ name: 'Autosave check', width: 3, length: 3, quantity: 1 })
    })
    // Not persisted yet — still inside the debounce window.
    expect(
      useProjects.getState().projects.find((p) => p.id === activeId)?.items.some((it) => it.name === 'Autosave check')
    ).toBe(false)

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(
      useProjects.getState().projects.find((p) => p.id === activeId)?.items.some((it) => it.name === 'Autosave check')
    ).toBe(true)
  })

  it('coalesces rapid list-hover events into a single requestAnimationFrame per burst', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, quantity: 1 })
      useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, quantity: 1 })
      useCalculator.getState().addItem({ name: 'C', width: 1, length: 1, quantity: 1 })
    })

    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    const rows = screen.getAllByTestId('cargo-list-row')
    expect(rows.length).toBeGreaterThan(1)
    act(() => {
      rows.forEach((row) => {
        fireEvent.mouseOver(row)
        fireEvent.mouseOut(row)
      })
    })

    expect(rafSpy).toHaveBeenCalledTimes(1)
  })

  // Round 19 (lashing per-segment) — the Sidebar half of the mutation gate
  // (the PDF half lives in exportPdf.test.ts, unit-testing
  // buildLashingRequirementRows directly). A composed [A(metal)x2,B(general)x3]
  // pin must render TWO independent verdict blocks, not one verdict computed
  // from only the nominal itemId's category.
  it('the inspector\'s lashing renders one verdict block PER SEGMENT for a composed placement', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Труба', width: 2, length: 1, quantity: 5, category: 'Металлопродукция', weight: 500 })
      useCalculator.getState().addItem({ name: 'Ящик', width: 2, length: 1, quantity: 5, category: 'Обычный груз', weight: 800 })
    })
    const metal = useCalculator.getState().items.find((it) => it.name === 'Труба')!
    const general = useCalculator.getState().items.find((it) => it.name === 'Ящик')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: metal.id, name: metal.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: metal.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: metal.id, layers: 2 }, { itemId: general.id, layers: 3 }],
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    // The stack's «Крепление», in its inspector (spec 6.5).
    within(screen.getByTestId('inspector-lashing')).getByText('Крепление')

    // Both segment labels appear (2 ед./3 ед. — the segment's own layers,
    // not the placement's combined 5).
    expect(screen.getByText(/Труба \(2 ед\., \d+ кг\)/)).toBeTruthy()
    expect(screen.getByText(/Ящик \(3 ед\., \d+ кг\)/)).toBeTruthy()
    // The metal segment's own РД 31.11.21.23-96 verdict is present and NOT
    // suppressed by the general-cargo segment sharing the same placement.
    expect(screen.getByText(/РД 31.11.21.23-96/)).toBeTruthy()
    expect(screen.getByText(/Ориентировочное количество найтовов/)).toBeTruthy()
  })

  it('the inspector\'s lashing: a dangerous-goods segment is excluded per-segment without hiding the other segment\'s verdict, regardless of which one is nominal', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Реагент', width: 2, length: 1, quantity: 5, category: 'Опасный груз', weight: 300 })
      useCalculator.getState().addItem({ name: 'Труба', width: 2, length: 1, quantity: 5, category: 'Металлопродукция', weight: 500 })
    })
    const dangerous = useCalculator.getState().items.find((it) => it.name === 'Реагент')!
    const metal = useCalculator.getState().items.find((it) => it.name === 'Труба')!
    let pinId = ''
    act(() => {
      // Dangerous goods is the NOMINAL itemId here — the old (pre-Round-19)
      // code would have classified the WHOLE placement as dangerous goods,
      // silently dropping the metal segment's own РД-31.11.21.23-96 verdict.
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: dangerous.id, name: dangerous.name, x: 1, y: 1, width: 2, length: 1, layers: 3, rotated: false, color: dangerous.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: dangerous.id, layers: 1 }, { itemId: metal.id, layers: 2 }],
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    within(screen.getByTestId('inspector-lashing')).getByText('Крепление')

    expect(screen.getAllByText(/IMDG Code/).length).toBeGreaterThan(0) // dangerous segment's own not-applicable notice
    // "требуется найтовов" appears ONLY in the calculated-verdict block
    // (unlike "РД 31.11.21.23-96", which the not-applicable explanation
    // text also happens to mention) — a real, specific check that the metal
    // segment's own verdict actually rendered, not just incidental text.
    expect(screen.getByText(/требуется найтовов/)).toBeTruthy()
  })

  // Round 24 (merge switch-on): real drag-to-merge through the actual
  // rendered <Home/> DOM (pointerdown/pointermove/pointerup on the deck's
  // SVG), not direct calls to a helper — planComposedMerge itself has no
  // export, so this is the only way to prove the wired-up handlers actually
  // behave as designed. Reuses the identity-SVG-transform technique from
  // the onPlace tests above: screenToDeck's mocked math is a pure linear
  // function of clientX/clientY, so an arbitrary pointerdown origin plus a
  // pointermove offset of (targetX-draggedX)*scale, (targetY-draggedY)*scale
  // deterministically lands the dragged placement exactly on the target's
  // own (x,y) — full-footprint overlap, comfortably past findMergeTarget's
  // 0.65 threshold. Each placement is given its own unique frozen `name` so
  // its <g data-cargo-placement> can be found by its on-deck text label,
  // which stays reliable even when two placements share an itemId (same
  // fill color) or when rendering order isn't guaranteed to match array
  // order.
  // ViewBox units per deck unit, read off the drawn deck rectangle rather
  // than hard-coded: the margin around the deck (room for the drawing's
  // labels) decides it. These tests use square decks, which are never drawn
  // transposed, so the rectangle's width is deck.width units.
  function deckScaleR24(): number {
    const deckRect = document.querySelector('rect[data-deck-background]')!
    return Number(deckRect.getAttribute('width')) / useCalculator.getState().deck.width
  }

  // By the placement's own name (data-cargo-name): the deck writes a name
  // only where it fits whole (spec 6.2).
  function placementGroupByLabel(label: string): Element {
    const match = document.querySelector(`g[data-cargo-placement="true"][data-cargo-name="${label}"]`)
    if (!match) throw new Error(`Round 24 test: placement group not found for label "${label}"`)
    return match
  }

  function dragMergeR24(fromLabel: string, dxDeck: number, dyDeck: number) {
    const svg = document.querySelector('svg[data-deck-plan]')!
    const g = placementGroupByLabel(fromLabel)
    const downX = 100
    const downY = 100
    const scale = deckScaleR24()
    withIdentitySvgTransform(() => {
      fireEvent.pointerDown(g, { clientX: downX, clientY: downY, button: 0 })
      fireEvent.pointerMove(svg, { clientX: downX + dxDeck * scale, clientY: downY + dyDeck * scale })
      fireEvent.pointerUp(svg, { clientX: downX + dxDeck * scale, clientY: downY + dyDeck * scale })
    })
  }

  // All cross-item Round 24 scenarios use pipe-shaped cargo (shape:
  // 'cylinder', long/short span and long/height ratios both > 1.5) since
  // planComposedMerge's compatibility gate — same as the old
  // reconcileCrossItemMerge it replaces — only allows a merge spanning more
  // than one distinct itemId when every constituent is pipe-shaped.
  function setupPipeDeck() {
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10, clearance: 25 } })
    })
  }

  it('Round 24/34: a partial standalone cross-item merge creates a real composition and leaves both catalog quantities alone', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 5, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 5, weight: 200, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 4, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
      })
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemB.id, name: 'TARGET', x: 6, y: 6, width: 4, length: 1, layers: 1, rotated: false, color: itemB.color, weight: 200,
      })
    })

    dragMergeR24('DRAG', 5, 5)

    const placements = useCalculator.getState().manualPlacements
    expect(placements.length).toBe(1)
    const merged = placements[0]
    expect(merged.id).toBe('target')
    expect(merged.itemId).toBe(itemB.id) // target survives as nominal identity
    expect(merged.composition).toEqual([{ itemId: itemB.id, layers: 1 }, { itemId: itemA.id, layers: 1 }])
    expect(merged.layers).toBe(2)
    expect(merged.weight).toBeCloseTo(150, 6) // (200*1 + 100*1) / 2
    // Round 34: A keeps 4 units elsewhere, so this is a PARTIAL transfer.
    // Round 24 still moved dragged's `delta` (1) from A's quantity to B's on
    // top of the composition, counting that unit twice — under A inside the
    // composition and again as B's quantity (AUTO then placed a ghost B and
    // left one A unplaced). The composition alone accounts for both units.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(5)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(5)
  })

  // Round 34: the merged stack is ONE column — its total height has to fit
  // the clearance just like a single-item stack of the same height. 3 + 3
  // pipes of 0.5 m (3 m) under a 2.5 m clearance: each item's own share (3)
  // fits its own cap (5), which is all the merge used to check.
  it('Round 34: a cross-item merge whose combined stack would stand above the clearance is refused', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 2.5 } })
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 5, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 5, weight: 200, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 4, length: 1, layers: 3, rotated: false, color: itemA.color, weight: 100,
      })
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemB.id, name: 'TARGET', x: 6, y: 6, width: 4, length: 1, layers: 3, rotated: false, color: itemB.color, weight: 200,
      })
    })

    dragMergeR24('DRAG', 5, 5)

    expect(useCalculator.getState().manualPlacements).toHaveLength(2)
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('Выше предельной высоты'))
  })

  // Spec 6.7: while a stack is dragged onto another, the target says what the
  // drop would do — the merged layers and height of the limit — or, in red,
  // why it can't be done, in the words the drop itself uses.
  function mergePreviewWhileOver(fromLabel: string, dxDeck: number, dyDeck: number) {
    const svg = document.querySelector('svg[data-deck-plan]')!
    const scale = deckScaleR24()
    let seen: { kind: string | null; text: string | null; targetStroked: boolean } | null = null
    withIdentitySvgTransform(() => {
      fireEvent.pointerDown(placementGroupByLabel(fromLabel), { clientX: 100, clientY: 100, button: 0 })
      fireEvent.pointerMove(svg, { clientX: 100 + dxDeck * scale, clientY: 100 + dyDeck * scale })
      const preview = document.querySelector('svg [data-merge-preview]')
      seen = {
        kind: preview?.getAttribute('data-merge-preview') ?? null,
        text: preview?.textContent ?? null,
        targetStroked: !!placementGroupByLabel('TARGET').querySelector('[stroke="#dc2626"]'),
      }
      fireEvent.pointerUp(svg, { clientX: 100 + dxDeck * scale, clientY: 100 + dyDeck * scale })
    })
    return seen!
  }

  it('a stack dragged onto another names the merge next to the target, before the drop', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 5, weight: 100, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 4, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
      })
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemA.id, name: 'TARGET', x: 6, y: 6, width: 4, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 100,
      })
    })

    const seen = mergePreviewWhileOver('DRAG', 5, 5)
    expect(seen.kind).toBe('ok')
    expect(seen.text).toBe('Объединить: 3 яр., 1.5 м из 25 м')
    expect(seen.targetStroked).toBe(false)
    // The drop did what the label said, and the label is gone.
    expect(useCalculator.getState().manualPlacements).toHaveLength(1)
    expect(document.querySelector('svg [data-merge-preview]')).toBeNull()
  })

  it('a merge that can\'t be done shows the target red with the reason, and the drop changes nothing', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 2.5 } })
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 5, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 5, weight: 200, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 4, length: 1, layers: 3, rotated: false, color: itemA.color, weight: 100,
      })
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemB.id, name: 'TARGET', x: 6, y: 6, width: 4, length: 1, layers: 3, rotated: false, color: itemB.color, weight: 200,
      })
    })

    const seen = mergePreviewWhileOver('DRAG', 5, 5)
    expect(seen.kind).toBe('blocked')
    expect(seen.text).toBe('Выше предельной высоты: 3 м из 2.5 м')
    expect(seen.targetStroked).toBe(true)
    expect(useCalculator.getState().manualPlacements).toHaveLength(2)
    expect(toast.warning).toHaveBeenCalledWith('Выше предельной высоты: 3 м из 2.5 м')
  })

  // Round 31: the one standalone cross-item merge shape Round 24's tests never
  // covered — the legacy quantity transfer takes the dragged item's WHOLE
  // remaining quantity, so the item is deleted from the catalog. The merged
  // placement used to keep a composition segment pointing at it (an orphan),
  // and the target's inflated quantity then had AUTO mode place the "missing"
  // units as a ghost second stack (the e2e suite saw counts like 24/16).
  it('Round 31: a standalone cross-item merge that DRAINS the dragged item re-attributes its units to the target — no orphan segment, no ghost stack', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 5, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 3, weight: 100, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemA.id, name: 'TARGET', x: 6, y: 6, width: 4, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 100,
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemB.id, name: 'DRAGB', x: 1, y: 1, width: 4, length: 1, layers: 3, rotated: false, color: itemB.color, weight: 100,
      })
    })

    dragMergeR24('DRAGB', 5, 5)

    const state = useCalculator.getState()
    expect(state.manualPlacements).toHaveLength(1)
    const merged = state.manualPlacements[0]
    expect(merged.id).toBe('target')
    expect(merged.composition).toBeUndefined() // plain placement of the target item — nothing left to orphan
    expect(merged.itemId).toBe(itemA.id)
    expect(merged.layers).toBe(5)
    expect(merged.weight).toBeCloseTo(100, 6)
    // B was drained (3 → 0) and removed; its 3 units moved into A (5 + 3), so
    // A's catalog quantity now matches the units physically on the deck + the
    // 3 still unplaced — the same total as before the merge.
    expect(state.items.find((it) => it.id === itemB.id)).toBeUndefined()
    expect(state.items.find((it) => it.id === itemA.id)?.quantity).toBe(8)
  })

  it('Round 31: a drained cross-item merge is checked against the TARGET item\'s own limits for the merged total, not for the two halves', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 5, weight: 100, category: 'X', maxLayers: 4 })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 3, weight: 100, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemA.id, name: 'TARGET', x: 6, y: 6, width: 4, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 100,
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemB.id, name: 'DRAGB', x: 1, y: 1, width: 4, length: 1, layers: 3, rotated: false, color: itemB.color, weight: 100,
      })
    })

    // 2 (A's own) is within A's cap of 4 and 3 (B's own) is within B's — but
    // once B's units become A's, the merged stack would be 5 high.
    dragMergeR24('DRAGB', 5, 5)

    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('лимит ярусов'))
    const state = useCalculator.getState()
    expect(state.manualPlacements).toHaveLength(2) // nothing merged
    expect(state.items.find((it) => it.id === itemB.id)?.quantity).toBe(3) // and nothing transferred
    expect(state.items.find((it) => it.id === itemA.id)?.quantity).toBe(5)
  })

  it('Round 24: composed target + standalone dragged appends the new segment on top, keeping the target\'s nominal itemId', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 200, category: 'X' })
      useCalculator.getState().addItem({ name: 'C', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 300, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    const itemC = useCalculator.getState().items.find((it) => it.name === 'C')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemA.id, name: 'TARGET', x: 1, y: 1, width: 4, length: 1, layers: 5, rotated: false, color: itemA.color, weight: 140,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemC.id, name: 'DRAGC', x: 6, y: 6, width: 4, length: 1, layers: 1, rotated: false, color: itemC.color, weight: 300,
      })
    })

    dragMergeR24('DRAGC', 1 - 6, 1 - 6)

    const placements = useCalculator.getState().manualPlacements
    expect(placements.length).toBe(1)
    const merged = placements[0]
    expect(merged.id).toBe('target')
    expect(merged.itemId).toBe(itemA.id)
    expect(merged.composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
      { itemId: itemC.id, layers: 1 },
    ])
    expect(merged.layers).toBe(6)
    expect(merged.weight).toBeCloseTo((2 * 100 + 3 * 200 + 1 * 300) / 6, 6)
    // Round 24 corrective pass: the target is composed, so this must NOT
    // touch catalog quantity for any constituent — A/B/C's own quantity
    // (10 each) stays exactly as it was before the merge.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemC.id)?.quantity).toBe(10)
  })

  it('Round 24: standalone target + composed dragged — target survives as nominal identity even though it was itself uncomposed', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 200, category: 'X' })
      useCalculator.getState().addItem({ name: 'C', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 300, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    const itemC = useCalculator.getState().items.find((it) => it.name === 'C')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemC.id, name: 'TARGETC', x: 1, y: 1, width: 4, length: 1, layers: 1, rotated: false, color: itemC.color, weight: 300,
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemA.id, name: 'DRAG', x: 6, y: 6, width: 4, length: 1, layers: 5, rotated: false, color: itemA.color, weight: 140,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
    })

    dragMergeR24('DRAG', 1 - 6, 1 - 6)

    const placements = useCalculator.getState().manualPlacements
    expect(placements.length).toBe(1)
    const merged = placements[0]
    expect(merged.id).toBe('target')
    expect(merged.itemId).toBe(itemC.id) // target (standalone C) survives, NOT dragged's nominal A
    expect(merged.composition).toEqual([
      { itemId: itemC.id, layers: 1 },
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
    ])
    expect(merged.layers).toBe(6)
    // Round 24 corrective pass: the DRAGGED side is composed, so this must
    // NOT touch catalog quantity for any constituent either — A/B/C's own
    // quantity (10 each) stays exactly as it was before the merge.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemC.id)?.quantity).toBe(10)
  })

  it('Round 24: composed + composed concatenates both compositions, never coalescing non-adjacent same-itemId segments', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 200, category: 'X' })
      useCalculator.getState().addItem({ name: 'C', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 300, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    const itemC = useCalculator.getState().items.find((it) => it.name === 'C')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemA.id, name: 'TARGET', x: 1, y: 1, width: 4, length: 1, layers: 5, rotated: false, color: itemA.color, weight: 140,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemC.id, name: 'DRAGCA', x: 6, y: 6, width: 4, length: 1, layers: 2, rotated: false, color: itemC.color, weight: 200,
        composition: [{ itemId: itemC.id, layers: 1 }, { itemId: itemA.id, layers: 1 }],
      })
    })

    dragMergeR24('DRAGCA', 1 - 6, 1 - 6)

    const placements = useCalculator.getState().manualPlacements
    expect(placements.length).toBe(1)
    const merged = placements[0]
    // [A2,B3] ++ [C1,A1] -> [A2,B3,C1,A1] — the two A segments are NOT
    // adjacent (B and C sit between them) so they must stay separate.
    expect(merged.composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
      { itemId: itemC.id, layers: 1 },
      { itemId: itemA.id, layers: 1 },
    ])
    expect(merged.layers).toBe(7)
    // Round 24 corrective pass: BOTH sides are composed, so this must NOT
    // touch catalog quantity for any constituent — A/B/C's own quantity
    // (10 each) stays exactly as it was before the merge.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemC.id)?.quantity).toBe(10)
  })

  it('Round 24: merge is blocked (no state change) when a constituent\'s combined layers would exceed its own catalog quantity', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      // A's own quantity is 3 — the composed target already uses 2, and the
      // dragged standalone placement carries 2 more of A: 2+2=4 > 3.
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 3, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 200, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemA.id, name: 'TARGET', x: 1, y: 1, width: 4, length: 1, layers: 5, rotated: false, color: itemA.color, weight: 140,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemA.id, name: 'DRAGA2', x: 6, y: 6, width: 4, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 100,
      })
    })

    const before = useCalculator.getState().manualPlacements.map((m) => ({ ...m }))
    dragMergeR24('DRAGA2', 1 - 6, 1 - 6)

    expect(useCalculator.getState().manualPlacements).toEqual(before)
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('уже размещены'))
  })

  it('Round 24: category mismatch on a NON-NOMINAL constituent blocks the merge even when both placements share the same nominal itemId', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'Обычный' })
      useCalculator.getState().addItem({ name: 'X', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'Обычный' })
      useCalculator.getState().addItem({ name: 'Y', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'Опасный груз' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemX = useCalculator.getState().items.find((it) => it.name === 'X')!
    const itemY = useCalculator.getState().items.find((it) => it.name === 'Y')!
    act(() => {
      // Both placements' own NOMINAL itemId is A — the old
      // reconcileCrossItemMerge compared only the two nominal items'
      // categories (A vs A: equal), completely missing that X and Y
      // (each hidden inside its own placement's composition) actually
      // conflict.
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemA.id, name: 'TARGET', x: 1, y: 1, width: 4, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 100,
        composition: [{ itemId: itemA.id, layers: 1 }, { itemId: itemX.id, layers: 1 }],
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemA.id, name: 'DRAGAY', x: 6, y: 6, width: 4, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 100,
        composition: [{ itemId: itemA.id, layers: 1 }, { itemId: itemY.id, layers: 1 }],
      })
    })

    const before = useCalculator.getState().manualPlacements.map((m) => ({ ...m }))
    dragMergeR24('DRAGAY', 1 - 6, 1 - 6)

    expect(useCalculator.getState().manualPlacements).toEqual(before)
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('разные категории груза'))
  })

  it('Round 24: rotation lock aggregates across EVERY constituent on both sides, not just the dragged side\'s nominal item', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'D', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'E', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'X' })
      // F is the NON-nominal constituent of the dragged composed placement
      // and is the one with allowRotation: false — the pre-Round-24 code
      // only ever consulted the dragged side's own nominal item (E, which
      // allows rotation), so this is exactly the gap Round 24 closes.
      useCalculator.getState().addItem({ name: 'F', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'X', allowRotation: false })
    })
    const itemD = useCalculator.getState().items.find((it) => it.name === 'D')!
    const itemE = useCalculator.getState().items.find((it) => it.name === 'E')!
    const itemF = useCalculator.getState().items.find((it) => it.name === 'F')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemD.id, name: 'TARGETD', x: 1, y: 1, width: 4, length: 1, layers: 1, rotated: false, color: itemD.color, weight: 100,
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemE.id, name: 'DRAGEF', x: 6, y: 6, width: 4, length: 1, layers: 2, rotated: false, color: itemE.color, weight: 100,
        composition: [{ itemId: itemE.id, layers: 1 }, { itemId: itemF.id, layers: 1 }],
      })
    })

    dragMergeR24('DRAGEF', 1 - 6, 1 - 6)

    const placements = useCalculator.getState().manualPlacements
    expect(placements.length).toBe(1)
    expect(placements[0].rotationLocked).toBe(true)
  })

  it('Round 24 (pinned/AUTO mode): same-item merge collapses back to the plain uncomposed representation and does NOT move catalog quantity', () => {
    render(<Home />)
    clearDemoCargo()
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 5, weight: 100, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      const targetId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: 'TARGET', x: 1, y: 1, width: 4, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 100,
      })
      const dragId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: 'DRAG', x: 4, y: 4, width: 4, length: 1, layers: 3, rotated: false, color: itemA.color, weight: 100,
      })
      useCalculator.setState({ selectedPinIds: [targetId, dragId] })
    })

    dragMergeR24('DRAG', 1 - 4, 1 - 4)

    const pins = useCalculator.getState().pinnedPlacementsByTrip[0] ?? []
    expect(pins.length).toBe(1)
    expect(pins[0].composition).toBeUndefined() // collapsed back to plain
    expect(pins[0].itemId).toBe(itemA.id)
    expect(pins[0].layers).toBe(5)
    expect(pins[0].weight).toBeCloseTo(100, 6)
    // Round 24 doesn't move catalog quantity on merge (unlike the old
    // reconcileCrossItemMerge) — A's own quantity is untouched.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(5)
  })

  // Round 27 (fixes R26-1/R26-2): both bugs originate in the ordinary
  // cargo edit fields — the cargo table's cells since stage 3 — not a
  // drag/drop path. These two tests drive that real DOM input, through
  // updateItem -> live store state, rather than calling the store action
  // directly (already covered at the unit level in calculator.test.ts).
  function findItemNumInput(itemName: string, label: string): HTMLInputElement {
    if (!screen.queryByRole('table', { name: 'Таблица грузов' })) fireEvent.click(screen.getByRole('button', { name: 'Таблица' }))
    return screen.getByLabelText(`${label}, ${itemName}`) as HTMLInputElement
  }

  it('Round 27: editing a NON-NOMINAL composed constituent\'s weight through the real cargo table cell is blocked when it would exceed maxDeckCargoT', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, maxDeckCargoT: 1 } }) // 1000kg
      useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, quantity: 5, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, quantity: 5, weight: 100 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      // Composed [A2,B3], nominal itemId=A. True weight 500kg, under the 1000kg cap.
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: itemA.id, name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: itemA.color, weight: 100,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
    })

    const weightInput = findItemNumInput('B', 'Вес единицы, т')
    fireEvent.change(weightInput, { target: { value: '1' } }) // 1 t a unit: the true new total would be 3200kg
    fireEvent.blur(weightInput) // NumberField applies the edit on blur/Enter, not per keystroke

    expect(toast.error).toHaveBeenCalled()
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.weight).toBe(100) // rejected
    expect(useCalculator.getState().manualPlacements[0].composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
    ])
  })

  it('Round 27: tightening a NON-NOMINAL composed constituent\'s "Ярусов" through the real cargo table cell clamps only that constituent, keeping layers in sync with composition', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 5 })
      useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 5 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: itemA.id, name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
    })

    const maxLayersInput = findItemNumInput('B', 'Ярусов') // B is NOT the nominal itemId (A is)
    fireEvent.change(maxLayersInput, { target: { value: '1' } })
    fireEvent.blur(maxLayersInput) // NumberField applies the edit on blur/Enter, not per keystroke

    const placement = useCalculator.getState().manualPlacements[0]
    expect(placement.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 1 }])
    expect(placement.layers).toBe(3) // never left desynced at the stale 5
  })

  // Round 31: setDeck()/updateItem() reflow, resize and clamp placements that
  // are already on the deck. The numeric fields used to push every keystroke
  // into them (and snap an emptied field to the minimum), so typing "24" over
  // "20" passed through a deck 2 m wide and shoved the cargo around for good.
  // NumberField now applies the value only on blur/Enter.
  it('Round 31: typing a new deck width never reflows the layout mid-edit — it applies on blur', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 20, length: 8, gap: 0.1, boardOffset: 0 } })
      useCalculator.getState().addItem({ name: 'A', width: 4, length: 1, quantity: 1 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: itemA.id, name: 'A', x: 15, y: 0, width: 4, length: 1, layers: 1, rotated: false, color: itemA.color,
      })
    })

    const widthInput = deckWidthInput()
    fireEvent.change(widthInput, { target: { value: '' } })
    fireEvent.change(widthInput, { target: { value: '2' } })
    // Half-typed: the store (and the placement at x=15) must be untouched.
    expect(useCalculator.getState().deck.width).toBe(20)
    expect(useCalculator.getState().manualPlacements[0].x).toBe(15)

    fireEvent.change(widthInput, { target: { value: '24' } })
    expect(useCalculator.getState().deck.width).toBe(20)
    fireEvent.blur(widthInput)

    expect(useCalculator.getState().deck.width).toBe(24)
    expect(useCalculator.getState().manualPlacements[0].x).toBe(15) // still fits — not moved
    expect(widthInput.value).toBe('24')
  })

  // Round 31: "Очистить" replaces `deck` wholesale (photo, outline, zones,
  // lashing points, vessel data — not just cargo) and drops the undo history,
  // with no way back. It used to fire on a single click.
  it('Round 31: "Очистить" asks first — Cancel changes nothing, confirming wipes the whole calculation', () => {
    render(<Home />)
    act(() => {
      useCalculator.setState({
        deck: { ...useCalculator.getState().deck, backgroundImage: 'data:image/jpeg;base64,AAAA', width: 33 },
      })
    })
    const itemCount = useCalculator.getState().items.length
    expect(itemCount).toBeGreaterThan(0)

    projectMenuItem('Очистить расчёт…')
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Очистить текущий расчёт?')
    expect(dialog).toHaveTextContent('фото палубы')
    expect(useCalculator.getState().items).toHaveLength(itemCount) // nothing has happened yet

    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(useCalculator.getState().items).toHaveLength(itemCount)
    expect(useCalculator.getState().deck.width).toBe(33)

    projectMenuItem('Очистить расчёт…')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Очистить' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(useCalculator.getState().items).toEqual([])
    expect(useCalculator.getState().deck.backgroundImage).toBeUndefined()
    expect(useCalculator.getState().deck.width).toBe(8)
  })

  // Spec 5.2: «Открыть пример» used to be «Сбросить к примеру», which replaced
  // the current calculation (behind a confirmation). It now opens the example
  // as a new calculation and leaves the current one as it was.
  it('«Открыть пример» opens the example as a new calculation and keeps the current one', () => {
    render(<Home />)
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 33 } })
      useCalculator.getState().addItem({ name: 'Мой груз', width: 1, length: 1, quantity: 1 })
    })
    const before = useProjects.getState().activeId

    projectMenuItem('Открыть пример')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const { projects, activeId } = useProjects.getState()
    expect(activeId).not.toBe(before)
    expect(projects.find((p) => p.id === activeId)!.name).toBe('Демо-расчёт')
    expect(useCalculator.getState().items.some((it) => it.name === 'Мой груз')).toBe(false)
    expect(useCalculator.getState().items.length).toBeGreaterThan(0)
    expect(useCalculator.getState().deck.width).toBe(8)

    act(() => {
      useProjects.getState().switchTo(before!)
    })
    expect(useCalculator.getState().items.some((it) => it.name === 'Мой груз')).toBe(true)
    expect(useCalculator.getState().deck.width).toBe(33)
  })

  // Round 31: the 2D keyboard handler (arrows nudge / Space rotates the
  // selection) used to preventDefault() every arrow and Space press, even with
  // nothing selected and even inside dialogs — killing keyboard scrolling and
  // the Space key on every dialog button.
  it('Round 31: arrow keys with nothing selected are left alone, so the page can still scroll', () => {
    render(<Home />)
    expect(fireEvent.keyDown(document.body, { key: 'ArrowDown', code: 'ArrowDown' })).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: 'ArrowLeft', code: 'ArrowLeft' })).toBe(true)
  })

  it('Round 31: arrow keys with a selected cargo item still nudge it (and are swallowed)', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 1 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: itemA.id, name: 'A', x: 4, y: 3, width: 2, length: 1, layers: 1, rotated: false, color: itemA.color,
      })
      useCalculator.setState({ selectedManualIds: ['m1'] })
    })

    expect(fireEvent.keyDown(document.body, { key: 'ArrowRight', code: 'ArrowRight' })).toBe(false)
    expect(useCalculator.getState().manualPlacements[0].x).toBeGreaterThan(4)
  })

  // Phase 0, L9: Space on a focused toolbar button used to be swallowed, so
  // no button could be pressed from the keyboard. It now goes to the button;
  // Space anywhere else still rotates the selected cargo.
  it('Space presses a focused button and still rotates the selection from anywhere else', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 1 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: itemA.id, name: 'A', x: 4, y: 3, width: 2, length: 1, layers: 1, rotated: false, color: itemA.color,
      })
      useCalculator.setState({ selectedManualIds: ['m1'] })
    })
    const toolbarButton = screen.getByRole('button', { name: 'Вид' })
    expect(fireEvent.keyDown(toolbarButton, { key: ' ', code: 'Space' })).toBe(true)
    expect(useCalculator.getState().manualPlacements[0].rotated).toBe(false)

    expect(fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })).toBe(false)
    expect(useCalculator.getState().manualPlacements[0].rotated).toBe(true)
  })

  it('Round 31: Space works on the buttons inside a dialog', () => {
    render(<Home />)
    projectMenuItem('Очистить расчёт…')
    const cancel = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Отмена' })
    expect(fireEvent.keyDown(cancel, { key: ' ', code: 'Space' })).toBe(true)
  })

  it('Round 31: an emptied deck field is restored on blur instead of snapping to the minimum', () => {
    render(<Home />)
    const widthInput = deckWidthInput()
    const before = useCalculator.getState().deck.width

    fireEvent.change(widthInput, { target: { value: '' } })
    fireEvent.blur(widthInput)

    expect(useCalculator.getState().deck.width).toBe(before)
    expect(widthInput.value).toBe(String(before))
  })

  // Round 29 (malformed-placement contract). Real end-to-end proof: a
  // project loaded through useProjects' own "load into calculator" effect
  // (the actual path a saved/imported project takes), containing a
  // placement with an invalid composition (the R28 audit's exact
  // `[A2,B3,garbage]` reproduction). Confirms: the project still opens
  // (doesn't reject/crash), the load-time warning fires, and the malformed
  // placement is NOT rendered as an ordinary "A6" cargo item on the deck.
  it('Round 29: a project with a malformed placement opens normally, warns once, and the malformed cargo is not rendered as ordinary/valid', () => {
    const badComposition = [{ itemId: 'itemA', layers: 2 }, { itemId: 'itemB', layers: 3 }, { itemId: 'garbage', layers: 1 }]
    const project = {
      id: 'p1',
      name: 'Malformed Project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deck: { width: 20, length: 8, unit: 'm' as const, gap: 0.1, boardOffset: 0.2, clearance: 5 },
      items: [
        { id: 'itemA', name: 'A', width: 1, length: 1, height: 2, quantity: 5, color: '#0ea5e9', allowRotation: true, weight: 100 },
        { id: 'itemB', name: 'B', width: 1, length: 1, height: 3, quantity: 5, color: '#0ea5e9', allowRotation: true, weight: 200 },
      ],
      manualPlacements: [{
        id: 'm1', itemId: 'itemA', name: 'Ghost', x: 1, y: 1, width: 1, length: 1, layers: 6, rotated: false, color: '#0ea5e9',
        weight: 100,
        malformed: { invalidComposition: true as const, rawComposition: badComposition },
      }],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      mode: 'manual' as const,
      sortStrategy: 'area-desc' as const,
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    }

    act(() => {
      useProjects.setState({ hydrated: true, activeId: 'p1', projects: [project] })
    })
    render(<Home />)

    // Project actually opened — item catalog loaded, not rejected wholesale.
    expect(useCalculator.getState().items.map((it) => it.name)).toEqual(['A', 'B'])
    // The malformed placement is still present in state (preserved, not
    // silently dropped) with its original raw data intact.
    const stored = useCalculator.getState().manualPlacements[0]
    expect(stored.malformed?.invalidComposition).toBe(true)
    expect(stored.layers).toBe(6)

    // But it must NOT render as an ordinary 6-layer "A" cargo item on the
    // deck — no SVG text label showing "6" stacked layers of A should exist
    // for this placement's footprint (the "×6" stacked-count badge, or the
    // item name "Ghost"/"A" appearing as a normal placed cargo label).
    expect(svgTextContents().some((t) => t === 'Ghost')).toBe(false)
    expect(svgTextContents().some((t) => t === '×6')).toBe(false)

    // And the load-time warning fired — exactly once, not once per effect
    // re-run (the project-load effect's own `loadedProjectId` guard should
    // prevent a duplicate fire on re-render/React StrictMode double-invoke).
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('повреждён'))
    expect(toast.warning).toHaveBeenCalledTimes(1)
  })

  // Round 30 (bug #15): dragging an EXISTING manual or pinned placement to a
  // position that violates a configured separation rule never warned — only
  // the brand-new-stamp click-place path did (see checkDroppedPlacementSeparation
  // in DeckVisualization.tsx). Separation stays warning-only here: it never
  // blocks or reverses the drop, matching the product's existing
  // warning-only stance (see calculator.ts's own deck-resize separation
  // check). Reuses dragMergeR24/withIdentitySvgTransform/setupPipeDeck
  // (already proven pointerdown/pointermove/pointerup + identity-SVG-CTM
  // machinery from Round 24) — a real production drag through the actual
  // rendered DOM, not a direct call to the tested-in-R29 predicate.
  describe('Round 30: existing-placement drag separation warning', () => {
    it('S30-1: dragging an existing uncomposed MANUAL placement into a violating position warns, and the drop still commits (warning-only)', () => {
      render(<Home />)
      clearDemoCargo()
      fireEvent.click(screen.getByText('Ручной'))
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'Cat1' })
        useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 1, weight: 200, category: 'Cat2' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
      act(() => {
        useCalculator.getState().addManualPlacement({
          id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
        })
        useCalculator.getState().addManualPlacement({
          id: 'target', itemId: itemB.id, name: 'TARGET', x: 6, y: 5, width: 1, length: 1, layers: 1, rotated: false, color: itemB.color, weight: 200,
        })
        useCalculator.getState().addSeparationRule({ categoryA: 'Cat1', categoryB: 'Cat2', minDistance: 3 })
      })

      // (1,1) -> (7.1,5): footprints end up NOT overlapping (7.1 > 6+1),
      // so this never latches a merge target — a plain move, landing 0.1m
      // from TARGET's edge, well inside the 3m rule.
      dragMergeR24('DRAG', 6.1, 4)

      const dragged = useCalculator.getState().manualPlacements.find((p) => p.id === 'drag')!
      expect(dragged.x).toBeCloseTo(7.1, 1)
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('сепарац'))
    })

    it('S30-2: dragging an existing placement to a SAFE position does not warn (regression guard)', () => {
      render(<Home />)
      clearDemoCargo()
      fireEvent.click(screen.getByText('Ручной'))
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'Cat1' })
        useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 1, weight: 200, category: 'Cat2' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
      act(() => {
        useCalculator.getState().addManualPlacement({
          id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
        })
        useCalculator.getState().addManualPlacement({
          id: 'target', itemId: itemB.id, name: 'TARGET', x: 6, y: 5, width: 1, length: 1, layers: 1, rotated: false, color: itemB.color, weight: 200,
        })
        useCalculator.getState().addSeparationRule({ categoryA: 'Cat1', categoryB: 'Cat2', minDistance: 3 })
      })

      // (1,1) -> ~(1,9): far from TARGET on every axis (exact landing spot
      // may clamp slightly inside the deck edge — the point of this test is
      // "moved, and no separation warning", not the precise coordinate).
      dragMergeR24('DRAG', 0, 8)

      const dragged = useCalculator.getState().manualPlacements.find((p) => p.id === 'drag')!
      expect(dragged.y).toBeGreaterThan(7)
      expect(toast.warning).not.toHaveBeenCalled()
    })

    it('S30-3: dragging a COMPOSED placement checks its constituent\'s category, not just the nominal itemId', () => {
      render(<Home />)
      clearDemoCargo()
      fireEvent.click(screen.getByText('Ручной'))
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'CatA' })
        useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 1, weight: 200, category: 'CatB' })
        useCalculator.getState().addItem({ name: 'C', width: 1, length: 1, height: 1, quantity: 1, weight: 300, category: 'CatC' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
      const itemC = useCalculator.getState().items.find((it) => it.name === 'C')!
      act(() => {
        useCalculator.getState().addManualPlacement({
          id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 1, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 150,
          composition: [{ itemId: itemA.id, layers: 1 }, { itemId: itemB.id, layers: 1 }],
        })
        useCalculator.getState().addManualPlacement({
          id: 'target', itemId: itemC.id, name: 'TARGET', x: 6, y: 5, width: 1, length: 1, layers: 1, rotated: false, color: itemC.color, weight: 300,
        })
        // No rule at all for CatA<->CatC — only the constituent B's category
        // conflicts. A naive nominal-itemId-only check (pre-Round-30) would
        // resolve only 'CatA' and never see this violation.
        useCalculator.getState().addSeparationRule({ categoryA: 'CatB', categoryB: 'CatC', minDistance: 3 })
      })

      dragMergeR24('DRAG', 6.1, 4)

      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('сепарац'))
    })

    it('S30-4: multi-category composition vs composition — conflict via one specific constituent PAIR is still caught', () => {
      render(<Home />)
      clearDemoCargo()
      fireEvent.click(screen.getByText('Ручной'))
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'CatA' })
        useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 1, weight: 200, category: 'CatB' })
        useCalculator.getState().addItem({ name: 'C', width: 1, length: 1, height: 1, quantity: 1, weight: 300, category: 'CatC' })
        useCalculator.getState().addItem({ name: 'D', width: 1, length: 1, height: 1, quantity: 1, weight: 400, category: 'CatD' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
      const itemC = useCalculator.getState().items.find((it) => it.name === 'C')!
      const itemD = useCalculator.getState().items.find((it) => it.name === 'D')!
      act(() => {
        useCalculator.getState().addManualPlacement({
          id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 1, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 150,
          composition: [{ itemId: itemA.id, layers: 1 }, { itemId: itemB.id, layers: 1 }],
        })
        useCalculator.getState().addManualPlacement({
          id: 'target', itemId: itemC.id, name: 'TARGET', x: 6, y: 5, width: 1, length: 1, layers: 2, rotated: false, color: itemC.color, weight: 350,
          composition: [{ itemId: itemC.id, layers: 1 }, { itemId: itemD.id, layers: 1 }],
        })
        // Only B<->D conflicts — A-C, A-D, B-C all have no rule.
        useCalculator.getState().addSeparationRule({ categoryA: 'CatB', categoryB: 'CatD', minDistance: 3 })
      })

      dragMergeR24('DRAG', 6.1, 4)

      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('сепарац'))
    })

    it('S30-5: self-exclusion — a placement is never checked against itself, even under a self-pairing rule', () => {
      render(<Home />)
      clearDemoCargo()
      fireEvent.click(screen.getByText('Ручной'))
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'CatSelf' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      act(() => {
        useCalculator.getState().addManualPlacement({
          id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
        })
        // Self-pairing rule: CatSelf <-> CatSelf. With no OTHER placement on
        // the deck, this must never fire against the moving placement itself.
        useCalculator.getState().addSeparationRule({ categoryA: 'CatSelf', categoryB: 'CatSelf', minDistance: 3 })
      })

      dragMergeR24('DRAG', 3, 3)

      const dragged = useCalculator.getState().manualPlacements.find((p) => p.id === 'drag')!
      expect(dragged.x).toBeCloseTo(4, 1)
      expect(toast.warning).not.toHaveBeenCalled()
    })

    it('S30-6: a placement in a DIFFERENT trip never participates in the separation check (cross-trip isolation)', () => {
      render(<Home />)
      clearDemoCargo()
      // AUTO/pinned mode — trips only exist here (MANUAL is architecturally
      // single-trip, see the Round 30 investigation).
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'Cat1' })
        useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 1, weight: 200, category: 'Cat2' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
      act(() => {
        useCalculator.getState().pinFromPlaced(0, {
          itemId: itemA.id, name: 'PINA', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color,
        })
        // A DIFFERENT trip's placement, positioned exactly where it WOULD
        // violate separation with PINA's drop target if the two were ever
        // compared — proving the check never reaches across trips, not just
        // that it happens not to conflict.
        useCalculator.getState().pinFromPlaced(1, {
          itemId: itemB.id, name: 'PINB_OTHER_TRIP', x: 7, y: 5, width: 1, length: 1, layers: 1, rotated: false, color: itemB.color,
        })
        useCalculator.getState().addSeparationRule({ categoryA: 'Cat1', categoryB: 'Cat2', minDistance: 3 })
      })
      // activeTripIndex defaults to 0 — trip 1's pin is never rendered or
      // passed to DeckVisualization at all while viewing trip 0.
      expect(screen.queryByText('PINB_OTHER_TRIP')).toBeNull()

      dragMergeR24('PINA', 6.1, 4)

      const trip0 = useCalculator.getState().pinnedPlacementsByTrip[0] ?? []
      expect(trip0.find((p) => p.name === 'PINA')?.x).toBeCloseTo(7.1, 1)
      expect(toast.warning).not.toHaveBeenCalled()
    })

    it('S30-7: dragging an existing PINNED placement into a violating position also warns (same contract as manual)', () => {
      render(<Home />)
      clearDemoCargo()
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'Cat1' })
        useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 1, weight: 200, category: 'Cat2' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
      act(() => {
        useCalculator.getState().pinFromPlaced(0, {
          itemId: itemA.id, name: 'PINA', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color,
        })
        useCalculator.getState().pinFromPlaced(0, {
          itemId: itemB.id, name: 'PINB', x: 6, y: 5, width: 1, length: 1, layers: 1, rotated: false, color: itemB.color,
        })
        useCalculator.getState().addSeparationRule({ categoryA: 'Cat1', categoryB: 'Cat2', minDistance: 3 })
      })

      dragMergeR24('PINA', 6.1, 4)

      const trip0 = useCalculator.getState().pinnedPlacementsByTrip[0] ?? []
      expect(trip0.find((p) => p.name === 'PINA')?.x).toBeCloseTo(7.1, 1)
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('сепарац'))
    })

    it('S30-8: a drag that resolves into a merge never fires the separation warning (contract: merge and separation-check are mutually exclusive)', () => {
      render(<Home />)
      clearDemoCargo()
      fireEvent.click(screen.getByText('Ручной'))
      setupPipeDeck()
      act(() => {
        // Self-pairing rule so that IF the merge-target's final overlapping
        // position were (incorrectly) separation-checked, it would violate.
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 2, weight: 100, category: 'CatSelf' })
        useCalculator.getState().addSeparationRule({ categoryA: 'CatSelf', categoryB: 'CatSelf', minDistance: 3 })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      act(() => {
        useCalculator.getState().addManualPlacement({
          id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
        })
        useCalculator.getState().addManualPlacement({
          id: 'target', itemId: itemA.id, name: 'TARGET', x: 6, y: 6, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
        })
      })

      // Full-overlap drag onto TARGET — same itemId, so planComposedMerge's
      // pipe-shape gate never applies (distinctIds.length === 1) and the
      // merge succeeds outright.
      dragMergeR24('DRAG', 5, 5)

      const placements = useCalculator.getState().manualPlacements
      expect(placements.length).toBe(1) // merge actually happened
      expect(placements[0].layers).toBe(2)
      expect(toast.warning).not.toHaveBeenCalled()
    })
  })

  // Phase 0, L16: in auto mode the PDF's lashing table took only pinned
  // stacks — cargo the packer placed by itself fell out of it — and the
  // cargo table showed one trip without saying which.
  it('the PDF lashing table covers every trip\'s auto-placed cargo, and the trip is named', async () => {
    vi.mocked(exportPlanPdf).mockClear()
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 4, length: 4, clearance: 0 } })
      useCalculator.getState().addItem({ name: 'Труба', width: 1, length: 1, height: 1, quantity: 30, category: 'Металлопродукция', weight: 500 })
    })
    expect(Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /Скачать PDF/ }))
    await waitFor(() => expect(exportPlanPdf).toHaveBeenCalled())
    const model = buildPlanPdf(vi.mocked(exportPlanPdf).mock.calls[0][0])
    // 30 single-tier stacks over several trips: a sheet per trip, named, its
    // own stacks' lashing on it, and every one of them on the totals sheet.
    expect(model.trips.length).toBeGreaterThan(1)
    expect(model.trips.map((t) => t.title)).toEqual(model.trips.map((_, i) => `Рейс ${i + 1} из ${model.trips.length}`))
    const stacks = (rows: { stacks: number }[]) => rows.reduce((n, r) => n + r.stacks, 0)
    expect(model.trips.reduce((n, t) => n + stacks(t.lashing.rows), 0)).toBe(30)
    expect(stacks(model.totals.lashing.rows)).toBe(30)
  })

  // Phase 0, L14: in manual mode an obstacle moved onto standing cargo (or a
  // new outline, or a widened clearance zone) left the stack where it may
  // not stand, with nothing said.
  it('manual cargo the deck changed under is hatched red and needs attention in «Проверки», which shows it', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10 } })
      useCalculator.getState().addItem({ name: 'Ящик', width: 2, length: 1, quantity: 1, height: 1 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      useCalculator.setState({
        mode: 'manual',
        manualPlacements: [{ id: 'm1', itemId: item.id, name: 'Ящик', x: 4, y: 4, width: 2, length: 1, layers: 1, rotated: false, color: item.color }],
      })
    })
    expect(document.querySelectorAll('svg [data-conflict="true"]')).toHaveLength(0)
    act(() => {
      useCalculator.setState({
        deck: {
          ...useCalculator.getState().deck,
          restrictionZones: [{ id: 'z', name: 'Кран', shapeType: 'rect', x: 3, y: 3, width: 3, length: 3 }],
        },
      })
    })
    expect(document.querySelectorAll('svg [data-conflict="true"]')).toHaveLength(1)
    // Not in the red strip, which is for cargo that fits nowhere (A.12).
    expect(screen.queryByText(/Не поместилось/)).toBeNull()
    openSection('Проверки')
    const row = openCheckRow('attention')
    expect(row.getAttribute('data-check-status')).toBe('error')
    fireEvent.click(within(row).getByRole('button', { name: 'Показать: «Ящик»: в зоне ограничения' }))
    expect(useCalculator.getState().selectedManualIds).toEqual(['m1'])
    // Still on the deck: manual mode never moves cargo by itself.
    expect(useCalculator.getState().manualPlacements).toHaveLength(1)
  })

  // The recheck must not cry wolf: what auto mode laid out, taken into
  // manual mode as is, stands clean.
  function switchToManual() {
    fireEvent.click(screen.getByText('Ручной'))
    const go = screen.queryByRole('button', { name: 'Перейти' })
    if (go) fireEvent.click(go)
    expect(useCalculator.getState().mode).toBe('manual')
  }

  it('the demo layout taken into manual mode raises no conflicts', () => {
    render(<Home />)
    switchToManual()
    expect(useCalculator.getState().manualPlacements.length).toBeGreaterThan(0)
    expect(document.querySelectorAll('svg [data-conflict="true"]')).toHaveLength(0)
    openSection('Проверки')
    expect(document.querySelector('[data-check="attention"]')).toBeNull()
  })

  it('stacked pipes on a cut-corner deck taken into manual mode raise no conflicts', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({
        deck: {
          ...useCalculator.getState().deck,
          width: 20,
          length: 8,
          clearance: 3,
          outline: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 20, y: 3 }, { x: 20, y: 8 }, { x: 0, y: 8 }],
        },
      })
      useCalculator.getState().addItem({ name: 'Труба', width: 0.5, length: 6, height: 0.5, quantity: 30, shape: 'cylinder' })
      useCalculator.getState().addItem({ name: 'Ящик', width: 1.5, length: 1, height: 1, quantity: 10 })
    })
    switchToManual()
    expect(useCalculator.getState().manualPlacements.some((m) => m.name === 'Труба' && m.layers > 1)).toBe(true)
    expect(document.querySelectorAll('svg [data-conflict="true"]')).toHaveLength(0)
    openSection('Проверки')
    expect(document.querySelector('[data-check="attention"]')).toBeNull()
  })

  // Phase 0, group D: selecting never changes saved data; a change the user
  // makes (drag, layers, rotate, «Закрепить») pins the stack, locked.
  describe('selection and pinning', () => {
    const pins = () => Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    const deckSvg = () => document.querySelector('svg[data-deck-plan]')!
    function setupAuto(extra: Partial<CargoItemLike>[] = []) {
      act(() => {
        useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10, clearance: 5 } })
        useCalculator.getState().addItem({ name: 'BoxA', width: 2, length: 1, quantity: 1, height: 1 })
        for (const it of extra) useCalculator.getState().addItem({ width: 2, length: 1, quantity: 1, height: 1, ...it })
      })
    }
    type CargoItemLike = { name: string; width: number; length: number; quantity: number; height: number }

    it('a press on an auto-placed stack selects it and pins nothing (L2)', () => {
      render(<Home />)
      clearDemoCargo()
      setupAuto()
      withIdentitySvgTransform(() => {
        fireEvent.pointerDown(placementGroupByLabel('BoxA'), { clientX: 100, clientY: 100, button: 0 })
        fireEvent.pointerUp(deckSvg(), { clientX: 100, clientY: 100 })
      })
      expect(pins()).toHaveLength(0)
      expect(useCalculator.getState().selectedAutoKeys).toHaveLength(1)
    })

    it('a stack becomes a locked pin only once it is really dragged (L2, L7)', () => {
      render(<Home />)
      clearDemoCargo()
      setupAuto()
      withIdentitySvgTransform(() => {
        fireEvent.pointerDown(placementGroupByLabel('BoxA'), { clientX: 100, clientY: 100, button: 0 })
        fireEvent.pointerMove(deckSvg(), { clientX: 103, clientY: 100 })
      })
      expect(pins()).toHaveLength(0)
      withIdentitySvgTransform(() => {
        fireEvent.pointerMove(deckSvg(), { clientX: 100 + 49.6, clientY: 100 })
        fireEvent.pointerUp(deckSvg(), { clientX: 100 + 49.6, clientY: 100 })
      })
      expect(pins()).toHaveLength(1)
      expect(pins()[0].locked).toBe(true)
    })

    it('Shift+press adds an auto-placed stack to the selection without pinning (L4)', () => {
      render(<Home />)
      clearDemoCargo()
      setupAuto([{ name: 'BoxB' }])
      withIdentitySvgTransform(() => {
        fireEvent.pointerDown(placementGroupByLabel('BoxA'), { clientX: 100, clientY: 100, button: 0 })
        fireEvent.pointerUp(deckSvg(), { clientX: 100, clientY: 100 })
        // No pointer capture on an additive press, so the release lands on the
        // stack itself; a release on the bare deck would clear the selection.
        fireEvent.pointerDown(placementGroupByLabel('BoxB'), { clientX: 200, clientY: 100, button: 0, shiftKey: true })
        fireEvent.pointerUp(placementGroupByLabel('BoxB'), { clientX: 200, clientY: 100 })
      })
      expect(pins()).toHaveLength(0)
      expect(useCalculator.getState().selectedAutoKeys).toHaveLength(2)
    })

    it('pressing a selected pin keeps it selected (L7)', () => {
      render(<Home />)
      clearDemoCargo()
      setupAuto()
      const item = useCalculator.getState().items[0]
      let id = ''
      act(() => {
        id = useCalculator.getState().pinFromPlaced(0, {
          itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, locked: true,
        })
      })
      withIdentitySvgTransform(() => {
        fireEvent.pointerDown(placementGroupByLabel('BoxA'), { clientX: 100, clientY: 100, button: 0 })
        fireEvent.pointerUp(deckSvg(), { clientX: 100, clientY: 100 })
      })
      expect(useCalculator.getState().selectedPinIds).toEqual([id])
    })

    it('with a tool armed, a press on cargo belongs to the tool, not the cargo (L8)', () => {
      render(<Home />)
      clearDemoCargo()
      setupAuto()
      act(() => {
        useCalculator.getState().setPlacingPowerSocket(true)
      })
      withIdentitySvgTransform(() => {
        fireEvent.pointerDown(placementGroupByLabel('BoxA'), { clientX: 100, clientY: 100, button: 0 })
        fireEvent.pointerMove(deckSvg(), { clientX: 100 + 49.6, clientY: 100 })
      })
      expect(useCalculator.getState().selectedAutoKeys).toHaveLength(0)
      expect(pins()).toHaveLength(0)
    })

    // A stamp can't place on top of a stack, and placing a unit then dragging
    // it into position is the routine — so a stamp leaves cargo presses alone.
    it('with a stamp armed, a press on cargo still selects it', () => {
      render(<Home />)
      clearDemoCargo()
      setupAuto()
      act(() => {
        useCalculator.getState().setActiveStamp(useCalculator.getState().items[0].id)
      })
      withIdentitySvgTransform(() => {
        fireEvent.pointerDown(placementGroupByLabel('BoxA'), { clientX: 100, clientY: 100, button: 0 })
        fireEvent.pointerUp(placementGroupByLabel('BoxA'), { clientX: 100, clientY: 100 })
      })
      expect(useCalculator.getState().selectedAutoKeys).toHaveLength(1)
      expect(pins()).toHaveLength(0)
    })

    it('«+» takes exactly one unit off the lowest other stack when every unit is already placed (L6)', () => {
      render(<Home />)
      clearDemoCargo()
      act(() => {
        useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10, clearance: 5 } })
        useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 5, height: 1 })
      })
      const item = useCalculator.getState().items[0]
      let a = ''
      let b = ''
      let c = ''
      act(() => {
        const pin = (x: number, layers: number) =>
          useCalculator.getState().pinFromPlaced(0, {
            itemId: item.id, name: item.name, x, y: 1, width: 2, length: 1, layers, rotated: false, color: item.color,
          })
        a = pin(1, 1)
        b = pin(4, 3)
        c = pin(7, 1)
        useCalculator.setState({ selectedPinIds: [a] })
      })
      fireEvent.click(stackButton('Добавить ярус')!)
      const byId = new Map(pins().map((p) => [p.id, p]))
      expect(byId.get(a)?.layers).toBe(2)
      expect(byId.get(a)?.locked).toBe(true)
      expect(byId.get(b)?.layers).toBe(3)
      expect(byId.has(c)).toBe(false)
    })

    it('right-click «Вернуть в авто» drops the pin and keeps the cargo quantity (L20)', () => {
      render(<Home />)
      clearDemoCargo()
      setupAuto()
      const item = useCalculator.getState().items[0]
      act(() => {
        useCalculator.getState().pinFromPlaced(0, {
          itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, locked: true,
        })
      })
      fireEvent.contextMenu(placementGroupByLabel('BoxA'), { clientX: 100, clientY: 100 })
      fireEvent.click(within(screen.getByRole('menu', { name: 'Действия со штабелем' })).getByRole('button', { name: 'Вернуть в авто' }))
      expect(pins()).toHaveLength(0)
      expect(useCalculator.getState().items[0].quantity).toBe(1)
    })

    it('↻ on a selected auto-placed stack pins it, locked, and rotates it', () => {
      render(<Home />)
      clearDemoCargo()
      setupAuto()
      withIdentitySvgTransform(() => {
        fireEvent.pointerDown(placementGroupByLabel('BoxA'), { clientX: 100, clientY: 100, button: 0 })
        fireEvent.pointerUp(deckSvg(), { clientX: 100, clientY: 100 })
      })
      fireEvent.click(stackButton('Повернуть')!)
      expect(pins()).toHaveLength(1)
      expect(pins()[0].locked).toBe(true)
      expect(pins()[0].rotated).toBe(true)
    })

    // A click used to pin the stack, which is what made the sidebar's
    // «Крепление груза» see it; a selected auto-placed stack must still be
    // reachable there.
    it('the inspector\'s «Крепление» works on a selected auto-placed stack and pins it on the first change', () => {
      render(<Home />)
      clearDemoCargo()
      setupAuto()
      withIdentitySvgTransform(() => {
        fireEvent.pointerDown(placementGroupByLabel('BoxA'), { clientX: 100, clientY: 100, button: 0 })
        fireEvent.pointerUp(placementGroupByLabel('BoxA'), { clientX: 100, clientY: 100 })
      })
      const lashing = within(screen.getByTestId('inspector-lashing'))
      expect(lashing.getByRole('group', { name: 'Способ крепления' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Точки крепления' }))
      expect(pins()).toHaveLength(0)
      fireEvent.click(screen.getByRole('button', { name: 'Зона отступа' }))
      expect(pins()).toHaveLength(1)
      expect(pins()[0].locked).toBe(true)
      expect(pins()[0].clearanceMargin).toEqual({ top: 1, right: 1, bottom: 1, left: 1 })
      expect(useCalculator.getState().selectedPinIds).toEqual([pins()[0].id])
    })

    // An unlocked pin is the packer's own layout, invisible to the user, so
    // a second «Автораспределение» used to warn about «Незакреплённые
    // размещения» the user never placed.
    it('a repeated «Автораспределение» in auto mode does not warn about the packer\'s own layout', () => {
      render(<Home />)
      const clock = vi.spyOn(Date, 'now')
      try {
        clock.mockReturnValue(1_000_000)
        clickAutoRedistribute()
        expect(pins().length).toBeGreaterThan(0)
        expect(pins().every((p) => !p.locked)).toBe(true)
        clock.mockReturnValue(1_002_000)
        clickAutoRedistribute()
        expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining('переставлены'), expect.anything())
      } finally {
        clock.mockRestore()
      }
    })

    it('in manual mode «Автораспределение» says how many hand placements get re-arranged', () => {
      render(<Home />)
      clearDemoCargo()
      setupAuto()
      const item = useCalculator.getState().items[0]
      const base = { itemId: item.id, name: item.name, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color }
      act(() => {
        useCalculator.setState({
          mode: 'manual',
          items: [{ ...item, quantity: 2 }],
          manualPlacements: [{ ...base, id: 'm1', x: 1 }, { ...base, id: 'm2', x: 4 }],
        })
      })
      clickAutoRedistribute()
      expect(toast.warning).toHaveBeenCalledWith(
        'Ручные штабели (2) переставлены заново',
        expect.objectContaining({ action: expect.objectContaining({ label: 'Отменить' }) })
      )
    })

    it('only a position the user chose (locked pin) is red when the packer rejects it', () => {
      render(<Home />)
      clearDemoCargo()
      setupAuto()
      const item = useCalculator.getState().items[0]
      act(() => {
        useCalculator.getState().pinFromPlaced(0, {
          itemId: item.id, name: item.name, x: 20, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
        })
      })
      openSection('Проверки')
      expect(document.querySelector('[data-check="attention"]')).toBeNull()
      act(() => {
        const id = pins()[0].id
        useCalculator.getState().updatePinned(0, id, { locked: true })
        clearCalculatorHistory()
      })
      const row = openCheckRow('attention')
      fireEvent.click(within(row).getByRole('button', { name: /^Снять закрепление: «BoxA»: закреплённая позиция вне палубы/ }))
      expect(pins()).toHaveLength(0)
      expect(document.querySelector('[data-check="attention"]')).toBeNull()
      // «Отменить» brings the pin back.
      const call = vi.mocked(toast.info).mock.calls.find(([text]) => String(text).startsWith('Закрепление снято'))!
      act(() => (call[1] as unknown as { action: { onClick: () => void } }).action.onClick())
      expect(pins()).toHaveLength(1)
    })
  })

  // Stage 2, group C (spec 6.4–6.6): the inspector over the right of the
  // deck and the mini-panel over the selected stack carry every action on a
  // stack; the right-click menu repeats them. None is reachable only there.
  describe('the inspector and the mini-panel', () => {
    const pins = () => Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    const inspector = () => screen.queryByRole('complementary', { name: 'Инспектор' })
    const quantityOf = (name: string) => useCalculator.getState().items.find((it) => it.name === name)!.quantity
    function setup(names: string[] = ['BoxA'], quantity = 1) {
      act(() => {
        useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10, clearance: 5 } })
        for (const name of names) useCalculator.getState().addItem({ name, width: 2, length: 1, quantity, height: 1, weight: 1500 })
      })
    }
    // A click on a stack, as a user selects it.
    function press(label: string) {
      withIdentitySvgTransform(() => {
        fireEvent.pointerDown(placementGroupByLabel(label), { clientX: 100, clientY: 100, button: 0 })
        fireEvent.pointerUp(document.querySelector('svg[data-deck-plan]')!, { clientX: 100, clientY: 100 })
      })
    }
    function pinBox(name: string, x: number, extra: Partial<{ layers: number; locked: boolean }> = {}) {
      const item = useCalculator.getState().items.find((it) => it.name === name)!
      let id = ''
      act(() => {
        id = useCalculator.getState().pinFromPlaced(0, {
          itemId: item.id, name: item.name, x, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, weight: 1500, ...extra,
        })
      })
      return id
    }

    it('shows the selected stack and closes with ✕, Esc or nothing selected', () => {
      render(<Home />)
      clearDemoCargo()
      setup()
      expect(inspector()).toBeNull()
      press('BoxA')
      const panel = within(inspector()!)
      expect(panel.getByRole('heading', { name: /BoxA/ })).toBeTruthy()
      expect(panel.getByText('Расставлен автоматически')).toBeTruthy()
      expect(panel.getByText('2 × 1 × 1 м')).toBeTruthy()
      expect(panel.getByText('1500 кг')).toBeTruthy()
      expect(panel.getByText('1.5 т')).toBeTruthy()
      expect(panel.getByText('макс. 5 по высоте')).toBeTruthy()
      fireEvent.click(panel.getByRole('button', { name: 'Закрыть инспектор' }))
      expect(inspector()).toBeNull()
      press('BoxA')
      expect(inspector()).toBeTruthy()
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(inspector()).toBeNull()
      expect(screen.queryByRole('toolbar', { name: 'Действия со штабелем' })).toBeNull()
    })

    it('pins, returns to auto and deletes an auto-placed stack from the inspector', () => {
      render(<Home />)
      clearDemoCargo()
      setup(['BoxA'], 2)
      press('BoxA')
      fireEvent.click(inspectorButton('Закрепить'))
      expect(pins()).toHaveLength(1)
      expect(pins()[0].locked).toBe(true)
      expect(within(inspector()!).getByText(/Закреплён/)).toBeTruthy()
      fireEvent.click(inspectorButton('Вернуть в авто'))
      expect(pins()).toHaveLength(0)
      expect(quantityOf('BoxA')).toBe(2)
      press('BoxA')
      const units = Number(inspectorButton(/^Удалить/).textContent!.match(/−(\d+)/)![1])
      fireEvent.click(inspectorButton(/^Удалить/))
      expect(quantityOf('BoxA')).toBe(2 - units)
    })

    it('rotates a stack and changes its layers from the mini-panel', () => {
      render(<Home />)
      clearDemoCargo()
      setup(['BoxA'], 2)
      const id = pinBox('BoxA', 1, { locked: true })
      act(() => useCalculator.setState({ selectedPinIds: [id] }))
      const pin = () => pins().find((p) => p.id === id)!
      expect(stackButton('Убрать ярус').hasAttribute('disabled')).toBe(true)
      expect(within(inspector()!).getAllByRole('button', { name: 'Убрать ярус' })[0].hasAttribute('disabled')).toBe(true)
      fireEvent.click(stackButton('Добавить ярус'))
      expect(pin().layers).toBe(2)
      fireEvent.click(stackButton('Убрать ярус'))
      expect(pin().layers).toBe(1)
      fireEvent.click(stackButton('Повернуть'))
      expect(pin().rotated).toBe(true)
    })

    it('the mini-panel\'s «⋯» holds «Вернуть в авто» and «Удалить»', () => {
      render(<Home />)
      clearDemoCargo()
      setup(['BoxA', 'BoxB'])
      const a = pinBox('BoxA', 1, { locked: true })
      act(() => useCalculator.setState({ selectedPinIds: [a] }))
      // The «⋯» menu: the popover the mini-panel opens.
      const moreMenu = () => within(document.querySelector('[data-radix-popper-content-wrapper]') as HTMLElement)
      fireEvent.click(stackButton('Ещё действия'))
      fireEvent.click(moreMenu().getByRole('button', { name: 'Вернуть в авто' }))
      expect(pins()).toHaveLength(0)
      const b = pinBox('BoxB', 5, { locked: true })
      act(() => useCalculator.setState({ selectedPinIds: [b] }))
      fireEvent.click(stackButton('Ещё действия'))
      fireEvent.click(moreMenu().getByRole('button', { name: 'Удалить (−1 ед.)' }))
      expect(quantityOf('BoxB')).toBe(0)
    })

    it('in manual mode a stack is taken off the deck, its cargo kept, and «−» says why it is off', () => {
      render(<Home />)
      clearDemoCargo()
      setup()
      const item = useCalculator.getState().items[0]
      act(() => {
        useCalculator.setState({
          mode: 'manual',
          manualPlacements: [{ id: 'm1', itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, weight: 1500 }],
          selectedManualIds: ['m1'],
        })
      })
      const panel = within(inspector()!)
      expect(panel.getByText('Поставлен вручную')).toBeTruthy()
      expect(panel.queryByRole('button', { name: 'Закрепить' })).toBeNull()
      expect(stackButton('Убрать ярус').closest('span')!.getAttribute('title')).toMatch(/Минимум 1 ярус/)
      fireEvent.click(inspectorButton('Убрать с палубы'))
      expect(useCalculator.getState().manualPlacements).toHaveLength(0)
      expect(quantityOf('BoxA')).toBe(1)
      expect(inspector()).toBeNull()
    })

    it('several selected stacks: pin all, return to auto, delete after a confirmation', () => {
      render(<Home />)
      clearDemoCargo()
      setup(['BoxA', 'BoxB'], 2)
      const a = pinBox('BoxA', 1)
      const b = pinBox('BoxB', 5)
      act(() => useCalculator.setState({ selectedPinIds: [a, b] }))
      const panel = within(inspector()!)
      expect(panel.getByRole('heading', { name: 'Выбрано 2 штабеля' })).toBeTruthy()
      fireEvent.click(panel.getByRole('button', { name: 'Закрепить все' }))
      expect(pins().every((p) => p.locked)).toBe(true)
      expect(useCalculator.getState().selectedPinIds).toEqual([a, b])

      fireEvent.click(within(inspector()!).getByRole('button', { name: 'Удалить…' }))
      const dialog = screen.getByRole('alertdialog')
      expect(within(dialog).getByText('Удалить 2 штабеля?')).toBeTruthy()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))
      expect(pins()).toHaveLength(0)
      expect(quantityOf('BoxA')).toBe(1)
      expect(quantityOf('BoxB')).toBe(1)
      expect(inspector()).toBeNull()
    })

    it('the right-click menu repeats the inspector\'s actions', () => {
      render(<Home />)
      clearDemoCargo()
      setup()
      fireEvent.contextMenu(placementGroupByLabel('BoxA'), { clientX: 100, clientY: 100 })
      const menu = within(screen.getByRole('menu', { name: 'Действия со штабелем' }))
      expect(menu.getAllByRole('button').map((b) => b.textContent)).toEqual(['Повернуть', 'Закрепить', 'Удалить (−1 ед.)'])
      // The stack is selected, so the inspector shows the same actions.
      expect(inspectorButton('Закрепить')).toBeTruthy()
      fireEvent.click(menu.getByRole('button', { name: 'Закрепить' }))
      expect(pins()[0].locked).toBe(true)
      expect(screen.queryByRole('menu', { name: 'Действия со штабелем' })).toBeNull()
    })

    it('moves the view so a stack under the inspector stays in sight, the scale kept', () => {
      render(<Home />)
      clearDemoCargo()
      setup(['BoxA', 'BoxB'])
      const left = pinBox('BoxA', 0)
      const right = pinBox('BoxB', 8)
      // The SVG and its mini-panel move together.
      const shifted = () => (document.querySelector('[data-mini-panel]')!.parentElement as HTMLElement).style.transform
      act(() => useCalculator.setState({ selectedPinIds: [left] }))
      expect(shifted()).toBe('')
      act(() => useCalculator.setState({ selectedPinIds: [right] }))
      expect(shifted()).toMatch(/^translateX\(-\d+(\.\d+)?px\)$/)
      const viewBox = document.querySelector('svg[data-deck-plan]')!.getAttribute('viewBox')
      act(() => useCalculator.setState({ selectedPinIds: [] }))
      expect(document.querySelector('svg[data-deck-plan]')!.getAttribute('viewBox')).toBe(viewBox)
    })

    it('lists what is wrong with the stack and leads to «Проверки»', () => {
      render(<Home />)
      clearDemoCargo()
      setup()
      const item = useCalculator.getState().items[0]
      act(() => {
        useCalculator.setState({
          mode: 'manual',
          deck: {
            ...useCalculator.getState().deck,
            restrictionZones: [{ id: 'crane', name: 'Кран', shapeType: 'rect', x: 0, y: 0, width: 4, length: 4 }],
          },
          manualPlacements: [{ id: 'm1', itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, weight: 1500 }],
          selectedManualIds: ['m1'],
        })
      })
      const problems = within(screen.getByRole('region', { name: 'Проблемы штабеля' }))
      expect(problems.getByText('Стоит там, где нельзя: в зоне ограничения')).toBeTruthy()
      fireEvent.click(problems.getByRole('button', { name: 'Показать в проверках' }))
      expect(screen.getByRole('heading', { name: 'Проверки' })).toBeTruthy()
    })
  })
})
