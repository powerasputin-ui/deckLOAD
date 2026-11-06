import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { toast } from 'sonner'
import { CargoTakeOver } from './CargoTakeOver'
import { useCalculator } from '@/store/calculator'
import { useProjects, type Project } from '@/store/projects'
import type { CargoItem } from '@/lib/packing'

// Spec 2026-11-06, 13: «С судна» — a saved vessel calculation's trip, its
// cargo onto the platform as «приход».

const initialCalc = useCalculator.getState()
const initialProjects = useProjects.getState()

const item = (over: Partial<CargoItem>): CargoItem => ({ id: 'x', name: 'Груз', width: 2, length: 2, height: 1, quantity: 1, color: '#000', allowRotation: false, weight: 1_000, ...over })
const vessel = (over: Partial<Project> = {}): Project => ({
  id: 'neptun',
  name: 'Нептун',
  createdAt: 0,
  updatedAt: 0,
  // 6 × 6 m: nine 2 × 2 boxes a trip.
  deck: { width: 6, length: 6, unit: 'm', gap: 0, boardOffset: 0, clearance: 0 },
  items: [item({ id: 'box', name: 'Ящик', quantity: 12, weight: 2_000 }), item({ id: 'drum', name: 'Бочка', width: 1, length: 1, quantity: 0 })],
  manualPlacements: [],
  pinnedPlacementsByTrip: {},
  separationRules: [],
  mode: 'auto',
  sortStrategy: 'area-desc',
  globalRotation: false,
  showFreeSpace: true,
  showGrid: true,
  showLabels: true,
  showCargoContents: true,
  ...over,
})

function setup(projects: Project[]) {
  useProjects.setState({ ...initialProjects, projects: [...projects, vessel({ id: 'rig', name: 'Платформа', deck: { ...vessel().deck, objectKind: 'semi-sub' } })], activeId: 'rig' })
  const onDone = vi.fn()
  render(<CargoTakeOver onDone={onDone} />)
  return { onDone, panel: screen.getByRole('region', { name: 'Груз с судна' }) }
}

describe('CargoTakeOver', () => {
  beforeEach(() => {
    useCalculator.setState({ ...initialCalc, deck: { width: 20, length: 30, unit: 'cm', gap: 0, boardOffset: 0, clearance: 0, objectKind: 'semi-sub' }, items: [] })
    vi.spyOn(toast, 'success').mockImplementation(() => '')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    useProjects.setState(initialProjects)
  })

  it('says where a vessel\'s calculation comes from when there is none', () => {
    const { panel } = setup([])
    expect(panel).toHaveTextContent('Здесь нет расчётов судов')
    expect(within(panel).queryByRole('button', { name: /^Взять/ })).toBeNull()
  })

  it('takes the trip\'s ticked cargo as «приход», in the platform\'s unit, and says so', () => {
    const { panel, onDone } = setup([vessel()])
    expect(within(panel).getByLabelText('Расчёт судна')).toHaveValue('neptun')
    // Two trips: 9 and 3 boxes.
    const trip = within(panel).getByLabelText('Рейс')
    expect(within(trip).getAllByRole('option').map((o) => o.textContent)).toEqual(['Рейс 1 · 9 ед., 18 т', 'Рейс 2 · 3 ед., 6 т'])
    fireEvent.change(trip, { target: { value: '1' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Взять как приход: 3 ед., 6 т' }))
    const [taken] = useCalculator.getState().items
    expect(taken).toMatchObject({ name: 'Ящик', quantity: 3, width: 200, length: 200, platformStatus: 'incoming', from: { projectId: 'neptun', projectName: 'Нептун', trip: 1 } })
    expect(toast.success).toHaveBeenCalledWith('С «Нептун», рейс 2: 3 ед., 6 т — приход')
    expect(onDone).toHaveBeenCalled()
  })

  it('leaves out the cargo unticked; with nothing ticked there\'s nothing to take', () => {
    const { panel } = setup([vessel({ items: [item({ id: 'box', name: 'Ящик', quantity: 2 }), item({ id: 'pipe', name: 'Трубы', width: 1, length: 1, quantity: 1 })] })])
    expect(within(panel).queryByLabelText('Рейс')).toBeNull()
    fireEvent.click(within(panel).getByRole('checkbox', { name: /Трубы/ }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Взять как приход: 2 ед., 2 т' }))
    expect(useCalculator.getState().items.map((it) => it.name)).toEqual(['Ящик'])
  })

  it('replaces what the trip brought before, named, unless told to keep it', () => {
    useCalculator.setState({ items: [item({ id: 'old', name: 'Ящик', quantity: 9, from: { projectId: 'neptun', projectName: 'Нептун', trip: 0 } })] })
    const { panel } = setup([vessel()])
    const replace = within(panel).getByRole('checkbox', { name: 'Заменить взятое раньше с «Нептун», рейс 1: 9 ед.' })
    expect(replace).toBeChecked()
    fireEvent.click(within(panel).getByRole('button', { name: /^Взять как приход/ }))
    expect(useCalculator.getState().items.map((it) => [it.name, it.quantity])).toEqual([['Ящик', 9]])
    expect(useCalculator.getState().items[0].id).not.toBe('old')
  })

  it('knows the trip in a calculation opened again from a file, and keeps it when unticked', () => {
    useCalculator.setState({ items: [item({ id: 'old', name: 'Ящик', quantity: 9, from: { projectId: 'earlier-file', projectName: 'Нептун', trip: 0 } })] })
    const { panel } = setup([vessel()])
    fireEvent.click(within(panel).getByRole('checkbox', { name: /^Заменить взятое раньше/ }))
    fireEvent.click(within(panel).getByRole('button', { name: /^Взять как приход/ }))
    expect(useCalculator.getState().items.map((it) => it.id)[0]).toBe('old')
    expect(useCalculator.getState().items).toHaveLength(2)
  })
})
