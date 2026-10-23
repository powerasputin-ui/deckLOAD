// The status line under the deck (spec 8.3):
// «81% · 16.6 из 2550 т · 22/22 ед. · 2 рейса · GM 2.77 м ✓»
// One place for the numbers that used to repeat across the screen. Each item
// leads to the section where it is set or explained.
import { pluralRu } from './utils'
import type { SectionId } from './workflow'

export interface StatusLineInput {
  // Current trip.
  utilization: number
  weightKg: number
  maxDeckCargoT?: number
  // Every trip.
  placedUnits: number
  totalUnits: number
  tripCount: number
  // Initial stability of the current trip, when the vessel's data allows it.
  gm?: { valueM: number; ok: boolean; estimated: boolean }
}

export interface StatusItem {
  id: 'load' | 'weight' | 'units' | 'trips' | 'gm'
  text: string
  title: string
  target: SectionId
  tone?: 'danger'
}

function tonnes(kg: number): string {
  const t = Math.round(kg / 100) / 10
  return Number.isInteger(t) ? `${t}` : t.toFixed(1)
}

function metres(m: number): string {
  return (Math.round(m * 100) / 100).toFixed(2)
}

export function statusItems(s: StatusLineInput): StatusItem[] {
  const items: StatusItem[] = [
    {
      id: 'load',
      text: `${Math.round(s.utilization * 100)}%`,
      title: 'Загрузка площади текущего рейса',
      target: 'placement',
    },
  ]

  const overWeight = s.maxDeckCargoT !== undefined && s.weightKg / 1000 > s.maxDeckCargoT
  items.push({
    id: 'weight',
    text: s.maxDeckCargoT !== undefined ? `${tonnes(s.weightKg)} из ${s.maxDeckCargoT} т` : `${tonnes(s.weightKg)} т`,
    title: s.maxDeckCargoT !== undefined ? 'Вес груза текущего рейса и наибольший вес для судна' : 'Вес груза текущего рейса',
    target: 'vessel',
    tone: overWeight ? 'danger' : undefined,
  })

  items.push({
    id: 'units',
    text: `${s.placedUnits}/${s.totalUnits} ед.`,
    title: 'Размещено во всех рейсах из всего',
    target: 'cargo',
  })

  if (s.tripCount > 1) {
    items.push({
      id: 'trips',
      text: `${s.tripCount} ${pluralRu(s.tripCount, 'рейс', 'рейса', 'рейсов')}`,
      title: 'Число рейсов',
      target: 'placement',
    })
  }

  if (s.gm) {
    items.push({
      id: 'gm',
      text: `GM ${s.gm.estimated ? '≈' : ''}${metres(s.gm.valueM)} м ${s.gm.ok ? '✓' : '✕'}`,
      title: s.gm.estimated
        ? 'Начальная остойчивость текущего рейса — оценка: числа вне таблиц судна'
        : 'Начальная остойчивость текущего рейса',
      target: 'checks',
      tone: s.gm.ok ? undefined : 'danger',
    })
  }

  return items
}
