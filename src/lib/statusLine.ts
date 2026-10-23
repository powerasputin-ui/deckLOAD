// The status line under the deck (spec 8.3):
// «81% · 16.6 из 2550 т · 22/22 ед. · 2 рейса · GM 2.77 м ✓ · ✕ 1 · ⚠ 2»
// One place for the numbers that used to repeat across the screen. Each item
// leads to the section where it is set or explained.
import type { Check } from './checks'
import { fmtTonnes, pluralRu } from './utils'
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
  // The whole plan's checks (checks.ts): their ✕ and ⚠ are counted here.
  checks?: readonly Check[]
}

export interface StatusItem {
  id: 'load' | 'weight' | 'units' | 'trips' | 'gm' | 'errors' | 'warnings'
  text: string
  title: string
  // For a screen reader, when the text alone is a symbol.
  label?: string
  target: SectionId
  tone?: 'danger' | 'warn'
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
    text: s.maxDeckCargoT !== undefined ? `${fmtTonnes(s.weightKg)} из ${s.maxDeckCargoT} т` : `${fmtTonnes(s.weightKg)} т`,
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

  // «✕ 1 · ⚠ 2»: shown as far as there is any.
  const counted = (status: Check['status']) => (s.checks ?? []).filter((c) => c.status === status)
  const errors = counted('error')
  if (errors.length > 0) {
    const what = `${errors.length} ${pluralRu(errors.length, 'ошибка', 'ошибки', 'ошибок')}: ${errors.map((c) => c.title).join(', ')}`
    items.push({ id: 'errors', text: `✕ ${errors.length}`, title: what, label: `Проверки — ${what}`, target: 'checks', tone: 'danger' })
  }
  const warnings = counted('warn')
  if (warnings.length > 0) {
    const what = `${warnings.length} ${pluralRu(warnings.length, 'предупреждение', 'предупреждения', 'предупреждений')}: ${warnings
      .map((c) => c.title)
      .join(', ')}`
    items.push({ id: 'warnings', text: `⚠ ${warnings.length}`, title: what, label: `Проверки — ${what}`, target: 'checks', tone: 'warn' })
  }

  return items
}
