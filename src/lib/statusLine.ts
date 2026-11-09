// The status line under the deck (spec 8.3):
// «81% · 16.6 из 2550 т · 22/22 ед. · 2 рейса · GM 2.77 м (приход) ⚠ · ✕ 1 · ⚠ 2»
// One place for the numbers that used to repeat across the screen. Each item
// leads to the section where it is set or explained.
import type { Check } from './checks'
import type { SemiSubResult } from './semiSub'
import type { JackUpResult } from './jackUp'
import { fmtTonnes, pluralRu } from './utils'
import type { SectionId } from './workflow'

export interface StatusLineInput {
  // A platform's plan: one deck after the supply run, no trips.
  platform?: boolean
  // A semi-submersible's VDL and KG after the run (semiSub.ts).
  semiSub?: SemiSubResult
  // A self-elevating unit's VDL, and its leg loads or KG (jackUp.ts).
  jackUp?: JackUpResult
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
  id: 'load' | 'weight' | 'units' | 'trips' | 'gm' | 'vdl' | 'kg' | 'legs' | 'errors' | 'warnings'
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
  // planning; the unit's computer says the last word. In operation, unless
  // only the survival limit is broken: then that one, so the red figure is
  // the one over its limit.
  const semi = s.semiSub
  if (semi?.vdlAfterT !== undefined) {
    const vdl = semi.checks.find((c) => c.id === 'semi-vdl')
    const storm = overOnlyInStorm(semi.vdlAfterT, semi.vdlMaxOperatingT, semi.vdlAfterT, semi.vdlMaxSurvivalT)
    const max = storm ? semi.vdlMaxSurvivalT : semi.vdlMaxOperatingT
    items.push({
      id: 'vdl',
      text: `VDL ${Math.round(semi.vdlAfterT)}${max !== undefined ? ` из ${Math.round(max)}` : ''} т${storm ? ' в шторм' : ''}`,
      title: storm ? 'VDL после рейса больше предела в шторм — оценка для планирования' : 'VDL после рейса и предел рабочего режима — оценка для планирования',
      target: 'vessel',
      tone: toneOf(vdl?.status),
    })
  }
  if (semi?.kgOperatingM !== undefined) {
    const kg = semi.checks.find((c) => c.id === 'semi-kg')
    const storm = semi.kgSurvivalM !== undefined && overOnlyInStorm(semi.kgOperatingM, semi.kgOperatingMaxM, semi.kgSurvivalM, semi.kgSurvivalMaxM)
    const [value, max] = storm ? [semi.kgSurvivalM!, semi.kgSurvivalMaxM] : [semi.kgOperatingM, semi.kgOperatingMaxM]
    items.push({
      id: 'kg',
      text: `KG${storm ? ' в шторм' : ''} ${metres(value)}${max !== undefined ? ` из ${metres(max)}` : ''} м`,
      title: storm ? 'KG при уходе в шторм больше допустимого — оценка для планирования' : 'KG после рейса и допустимый в работе — оценка для планирования',
      target: 'vessel',
      tone: toneOf(kg?.status),
    })
  }

  // A self-elevating unit's: the VDL of where it is, then the most loaded
  // leg on its legs, or its KG afloat.
  const jack = s.jackUp
  if (jack?.vdlAfterT !== undefined) {
    const vdl = jack.checks.find((c) => c.id === 'jack-vdl')
    const storm = jack.mode === 'elevated' && overOnlyInStorm(jack.vdlAfterT, jack.vdlMaxT, jack.vdlAfterT, jack.vdlStormMaxT)
    const max = storm ? jack.vdlStormMaxT : jack.vdlMaxT
    items.push({
      id: 'vdl',
      text: `VDL ${Math.round(jack.vdlAfterT)}${max !== undefined ? ` из ${Math.round(max)}` : ''} т${storm ? ' в шторм' : ''}`,
      title: storm ? 'VDL после рейса больше предела в шторм — оценка для планирования' : `VDL после рейса и предел ${jack.mode === 'afloat' ? 'на плаву' : 'на опорах'} — оценка для планирования`,
      target: 'vessel',
      tone: toneOf(vdl?.status),
    })
  }
  const loads = (jack?.legs ?? []).flatMap((l) => (l.afterT !== undefined ? [l.afterT] : []))
  if (jack?.mode === 'elevated' && loads.length > 0 && loads.length === jack.legs!.length) {
    const legsCheck = jack.checks.find((c) => c.id === 'jack-legs')
    // A leg taken below nothing lifts off: that, not the most loaded leg, is
    // what the line says (audit 2026-11-09) — by a whole tonne, as the
    // jack-legs check counts it.
    const least = Math.round(Math.min(...loads))
    items.push({
      id: 'legs',
      text:
        least < 0
          ? `Отрыв опоры: −${-least} т`
          : `Опора до ${Math.round(Math.max(...loads))}${jack.maxLegLoadT !== undefined ? ` из ${Math.round(jack.maxLegLoadT)}` : ''} т`,
      title:
        least < 0
          ? 'Нагрузка на опору после рейса ниже нуля: опора отрывается, груз за контуром опор'
          : 'Наибольшая нагрузка на опору после рейса и допустимая — статика, оценка для планирования',
      target: 'vessel',
      tone: toneOf(legsCheck?.status),
    })
  }
  if (jack?.mode === 'afloat' && jack.kgAfterM !== undefined) {
    const kg = jack.checks.find((c) => c.id === 'jack-kg')
    items.push({
      id: 'kg',
      text: `KG ${metres(jack.kgAfterM)}${jack.kgMaxM !== undefined ? ` из ${metres(jack.kgMaxM)}` : ''} м`,
      title: 'KG после рейса и допустимый на новой осадке — оценка для планирования',
      target: 'vessel',
      tone: toneOf(kg?.status),
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

// A platform check's tone in the line: red over a limit, amber when judged
// without some cargo.
function toneOf(status: 'ok' | 'warn' | 'error' | 'none' | undefined): StatusItem['tone'] {
  return status === 'error' ? 'danger' : status === 'warn' ? 'warn' : undefined
}

// Within the operating limit, over the survival one: the line shows that one.
function overOnlyInStorm(value: number, max: number | undefined, stormValue: number, stormMax: number | undefined): boolean {
  const over = (v: number, m: number | undefined) => m !== undefined && v > m + 1e-9
  return over(stormValue, stormMax) && !over(value, max)
}
