// The status line under the deck (spec 8.3):
// «81% · 16.6 из 2550 т · 22/22 ед. · 2 рейса · GM 2.77 м (приход) ⚠ · ✕ 1 · ⚠ 2»
// One place for the numbers that used to repeat across the screen. Each item
// leads to the section where it is set or explained.
import type { Check } from './checks'
import type { SemiSubResult } from './semiSub'
import { fmtTonnes, pluralRu } from './utils'
import type { SectionId } from './workflow'

export interface StatusLineInput {
  // A platform's plan: one deck after the supply run, no trips.
  platform?: boolean
  // A semi-submersible's VDL and KG after the run (semiSub.ts).
  semiSub?: SemiSubResult
  // Current trip.
  utilization: number
  weightKg: number
  maxDeckCargoT?: number
  // Every trip.
  placedUnits: number
  totalUnits: number
  tripCount: number
  // Initial stability of the current trip, when the vessel's data allows it:
  // the state it's judged by (the worse of departure and arrival) and the
  // booklet check's verdict on it — a tick only against the booklet's limit.
  gm?: { valueM: number; status: 'ok' | 'warn' | 'error'; estimated: boolean; state: 'departure' | 'arrival' }
  // Why GM isn't worked out though the vessel's data is there — said in
  // its place rather than a GM it would get wrong.
  gmMissing?: string
  // The whole plan's checks (checks.ts): their ✕ and ⚠ are counted here.
  checks?: readonly Check[]
}

export interface StatusItem {
  id: 'load' | 'weight' | 'units' | 'trips' | 'gm' | 'vdl' | 'kg' | 'errors' | 'warnings'
  text: string
  title: string
  // For a screen reader, when the text alone is a symbol.
  label?: string
  // The section it opens, or the stability workspace in the deck's place.
  target: SectionId | 'stability'
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
      title: s.platform ? 'Загрузка площади палубы' : 'Загрузка площади текущего рейса',
      target: 'placement',
    },
  ]

  const overWeight = s.maxDeckCargoT !== undefined && s.weightKg / 1000 > s.maxDeckCargoT
  items.push({
    id: 'weight',
    text: s.maxDeckCargoT !== undefined ? `${fmtTonnes(s.weightKg)} из ${s.maxDeckCargoT} т` : `${fmtTonnes(s.weightKg)} т`,
    title: s.platform
      ? s.maxDeckCargoT !== undefined
        ? 'Груз на палубе после рейса и допускаемая нагрузка'
        : 'Груз на палубе после рейса'
      : s.maxDeckCargoT !== undefined
        ? 'Вес груза текущего рейса и наибольший вес для судна'
        : 'Вес груза текущего рейса',
    target: 'vessel',
    tone: overWeight ? 'danger' : undefined,
  })

  items.push({
    id: 'units',
    text: `${s.placedUnits}/${s.totalUnits} ед.`,
    title: s.platform ? 'Размещено на палубе из всего, что на борту и в приходе' : 'Размещено во всех рейсах из всего',
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
    const mark = s.gm.status === 'ok' ? '✓' : s.gm.status === 'warn' ? '⚠' : '✕'
    items.push({
      id: 'gm',
      text: `GM ${s.gm.estimated ? '≈' : ''}${metres(s.gm.valueM)} м (${s.gm.state === 'arrival' ? 'приход' : 'отход'}) ${mark}`,
      title: `Начальная остойчивость текущего рейса, худшее из отхода и прихода${s.gm.estimated ? ' — оценка: числа вне таблиц судна' : ''}`,
      target: 'stability',
      tone: s.gm.status === 'error' ? 'danger' : s.gm.status === 'warn' ? 'warn' : undefined,
    })
  } else if (s.gmMissing) {
    items.push({ id: 'gm', text: 'GM — ⚠', title: s.gmMissing, label: `GM не посчитана: ${s.gmMissing.toLowerCase()}`, target: 'stability', tone: 'warn' })
  }

  // A semi-submersible's VDL and KG after the run — an estimate for
  // planning; the unit's computer says the last word.
  const semi = s.semiSub
  if (semi?.vdlAfterT !== undefined) {
    const vdl = semi.checks.find((c) => c.id === 'semi-vdl')
    const max = semi.vdlMaxOperatingT
    items.push({
      id: 'vdl',
      text: `VDL ${Math.round(semi.vdlAfterT)}${max !== undefined ? ` из ${Math.round(max)}` : ''} т`,
      title: 'VDL после рейса и предел рабочего режима — оценка для планирования',
      target: 'vessel',
      tone: vdl?.status === 'error' ? 'danger' : undefined,
    })
  }
  if (semi?.kgOperatingM !== undefined) {
    const kg = semi.checks.find((c) => c.id === 'semi-kg')
    items.push({
      id: 'kg',
      text: `KG ${metres(semi.kgOperatingM)}${semi.kgOperatingMaxM !== undefined ? ` из ${metres(semi.kgOperatingMaxM)}` : ''} м`,
      title: 'KG после рейса и допустимый в работе — оценка для планирования',
      target: 'vessel',
      tone: kg?.status === 'error' ? 'danger' : undefined,
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
