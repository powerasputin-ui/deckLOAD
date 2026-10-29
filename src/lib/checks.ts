// The checks of a calculation (spec 8.4) and their statuses: ✓ fine, ⚠ a
// warning, ✕ an error, «—» not checked for lack of data. Built from facts the
// app has already worked out (planFacts.ts) — nothing here calculates, it
// only says what each fact means for the plan. The status line counts ✕ and
// ⚠ from this list (8.3), the «Проверки» tab carries the same counts, and the
// section lists it.
//
// The checks cover the whole plan, every trip: an overloaded zone on trip 2
// is the plan's problem while trip 1 is on screen. A detail names the trips
// when there is more than one.
import type { LoadingState } from './stability'
import { prefixedReason } from './stabilityConditions'
import { fmtNumber, fmtTonnes, pluralRu } from './utils'
import type { SectionId } from './workflow'

export type CheckStatus = 'ok' | 'warn' | 'error' | 'none'

export type CheckId = 'capacity' | 'deck-weight' | 'zones' | 'separation' | 'lashing' | 'stability' | 'attention'

export interface Check {
  id: CheckId
  title: string
  status: CheckStatus
  // What it found, in one line.
  detail: string
  // Every reason, one line each, when there are several to list (the
  // stability check's, by trips and states — spec 2026-10-24, 5).
  lines?: { status: 'warn' | 'error'; text: string }[]
  // Where its settings are (8.4, «Где настройки»): a section, or the
  // stability workspace in the deck's place.
  target: SectionId | 'stability'
}

// One trip's stability by the booklet check (stabilityConditions.ts); a
// trip has none when the vessel's data can't give it (no hydrostatics).
export interface TripStability {
  verdict: 'ok' | 'warn' | 'error'
  // The reasons for ✕ and ⚠, each with the states it holds in.
  reasons: { status: 'warn' | 'error'; text: string; states: LoadingState[] }[]
}

export interface TripFacts {
  weightKg: number
  overloadedZones: number
  // Stacks pressing on the deck harder than the zone under them allows
  // (computeFootprintPressures): a zone's average can hide a heavy stack on
  // a small footprint.
  overPressureStacks?: number
  separationViolations: number
  stability?: TripStability
  // What the checks found, stack by stack — the counts above, itemised.
  found?: TripFindings
}

// A stack the checks name: the key the deck finds it by (autoPlacementKey)
// and its cargo's name.
export interface StackRef {
  key: string
  name: string
}

// What the checks found on one trip (8.4: a click on a check says what is
// wrong and lights up the stacks at fault).
export interface TripFindings {
  // Zones over their limit by their average load, with the stacks in them.
  zones: { label: string; densityTPerM2: number; limitTPerM2: number; stacks: StackRef[] }[]
  pressure: { stack: StackRef; pressureTPerM2: number; limitTPerM2: number }[]
  // Pairs closer than a separation rule allows, in the deck's unit.
  separation: { a: StackRef; b: StackRef; distance: number; minDistance: number }[]
  // Secured stacks short of securing: fewer points than required with no
  // justification written, or the force balance failing.
  lashingShort: { stack: StackRef; required: number; attached: number; balanceFails: boolean }[]
  dangerousGoods: StackRef[]
  // «Требуют внимания», on the deck…
  unknownMakeup: { stack: StackRef; recordId: string }[]
  conflicts: { stack: StackRef; recordId: string; reason: string }[]
  // …and off it.
  rejectedPins: { recordId: string; name: string; reason: string }[]
  quarantined: { recordId: string; name: string }[]
}

export interface PlanFacts {
  mode: 'auto' | 'manual'
  totalUnits: number
  // Auto mode: units no trip can take. Manual mode: units not placed yet.
  unplacedUnits: number
  trips: TripFacts[]
  maxDeckCargoT?: number
  zoneCount: number
  // A library vessel's deck strength, when it needs attention: not chosen
  // yet, or chosen but the zone over the whole deck that carries it is gone.
  deckStrength?: 'pending' | 'unchecked'
  separationRuleCount: number
  lashing: {
    // Stacks with lashing points attached, and those of them short of
    // securing: the force balance fails, or fewer points than the required
    // count with no justification written.
    securedStacks: number
    shortStacks: number
    // Stacks holding dangerous goods: their securing and segregation follow
    // the IMDG Code, which the app doesn't calculate.
    dangerousGoodsStacks: number
  }
  hasVessel: boolean
  // The cargo no trip takes (auto) or not placed yet (manual), with why.
  unfit?: { name: string; reason: string }[]
  // A library vessel's 10-foot container capacity, against each trip's
  // 10-foot units (informational: the figure holds for a full load of pipe).
  tenFoot?: { capacity: number; byTrip: number[] }
  // The deck's unit, for distances.
  unitLabel?: string
  // Cases that need the user's decision (8.4, «Требуют внимания»).
  attention: {
    // Stacks whose data couldn't be read; they aren't on the deck.
    malformed: number
    // Stacks merged before compositions were kept: what they hold is unknown.
    legacyUnknown: number
    // Locked positions the packer can't use: off the deck, in an obstacle…
    rejectedPins: number
    // Manual stacks standing where they may not.
    manualConflicts: number
  }
}

const stacksWord = (n: number) => pluralRu(n, 'штабель', 'штабеля', 'штабелей')

export function buildChecks(f: PlanFacts): Check[] {
  const multiTrip = f.trips.length > 1
  // The trips (1-based) where something holds.
  const tripsWhere = (holds: (t: TripFacts) => boolean) => f.trips.flatMap((t, i) => (holds(t) ? [i + 1] : []))
  // « (рейс 2)», « (рейсы 1, 3)» — only when there is more than one trip.
  const onTrips = (trips: number[]) =>
    multiTrip && trips.length > 0 ? ` (${trips.length === 1 ? 'рейс' : 'рейсы'} ${trips.join(', ')})` : ''

  const checks: Check[] = []

  // Вместимость и рейсы.
  {
    const base = { id: 'capacity' as const, title: 'Вместимость и рейсы', target: 'placement' as const }
    if (f.totalUnits === 0) checks.push({ ...base, status: 'none', detail: 'Груза нет' })
    else if (f.unplacedUnits > 0 && f.mode === 'auto')
      checks.push({ ...base, status: 'error', detail: `${f.unplacedUnits} ед. не помещаются ни в один рейс` })
    else if (f.unplacedUnits > 0) checks.push({ ...base, status: 'warn', detail: `Не размещено ${f.unplacedUnits} ед.` })
    else
      checks.push({
        ...base,
        status: 'ok',
        detail: multiTrip
          ? `Всё размещено за ${f.trips.length} ${pluralRu(f.trips.length, 'рейс', 'рейса', 'рейсов')}`
          : 'Всё размещено',
      })
  }

  // Вес палубы.
  {
    const base = { id: 'deck-weight' as const, title: 'Вес палубы', target: 'vessel' as const }
    const limit = f.maxDeckCargoT
    if (limit === undefined) checks.push({ ...base, status: 'none', detail: 'Лимит не задан' })
    else {
      const heaviest = Math.max(0, ...f.trips.map((t) => t.weightKg))
      const over = tripsWhere((t) => t.weightKg / 1000 > limit + 1e-9)
      checks.push({
        ...base,
        status: over.length > 0 ? 'error' : 'ok',
        detail: `${fmtTonnes(heaviest)} из ${limit} т${onTrips(over)}`,
      })
    }
  }

  // Зоны т/м².
  {
    const base = { id: 'zones' as const, title: 'Зоны т/м²', target: 'vessel' as const }
    const overloaded = tripsWhere((t) => t.overloadedZones > 0)
    const pressed = tripsWhere((t) => (t.overPressureStacks ?? 0) > 0)
    if (overloaded.length > 0 || pressed.length > 0) {
      const most = Math.max(...f.trips.map((t) => t.overloadedZones))
      const mostPressed = Math.max(...f.trips.map((t) => t.overPressureStacks ?? 0))
      const parts = [
        overloaded.length > 0 && `Перегружено зон: ${most}${onTrips(overloaded)}`,
        pressed.length > 0 && `Давление под грузом выше лимита: ${mostPressed} ${stacksWord(mostPressed)}${onTrips(pressed)}`,
      ].filter((p): p is string => !!p)
      checks.push({ ...base, status: 'error', detail: parts.join(' · ') })
    } else if (f.deckStrength === 'pending')
      checks.push({ ...base, status: 'warn', detail: 'Не выбран лимит прочности палубы' })
    else if (f.deckStrength === 'unchecked')
      checks.push({ ...base, status: 'warn', detail: 'Нет зоны на всю палубу — прочность не проверяется' })
    else if (f.zoneCount === 0) checks.push({ ...base, status: 'none', detail: 'Зон нет' })
    else checks.push({ ...base, status: 'ok', detail: 'Все зоны в лимите' })
  }

  // Сепарация.
  {
    const base = { id: 'separation' as const, title: 'Сепарация', target: 'checks' as const }
    const broken = tripsWhere((t) => t.separationViolations > 0)
    if (f.separationRuleCount === 0) checks.push({ ...base, status: 'none', detail: 'Правил нет' })
    else if (broken.length > 0) {
      const count = f.trips.reduce((sum, t) => sum + t.separationViolations, 0)
      checks.push({ ...base, status: 'error', detail: `Нарушений: ${count}${onTrips(broken)}` })
    } else checks.push({ ...base, status: 'ok', detail: 'Нарушений нет' })
  }

  // Крепление.
  {
    const base = { id: 'lashing' as const, title: 'Крепление', target: 'checks' as const }
    const { securedStacks, shortStacks, dangerousGoodsStacks } = f.lashing
    const warnings = [
      shortStacks > 0 && `Не хватает крепления: ${shortStacks} ${stacksWord(shortStacks)}`,
      dangerousGoodsStacks > 0 && 'Опасный груз: крепление и сегрегация — по IMDG Code, отдельно',
    ].filter((w): w is string => !!w)
    if (warnings.length > 0) checks.push({ ...base, status: 'warn', detail: warnings.join(' · ') })
    else if (securedStacks === 0) checks.push({ ...base, status: 'none', detail: 'Точки крепления не заданы' })
    else checks.push({ ...base, status: 'ok', detail: `Крепления хватает: ${securedStacks} ${stacksWord(securedStacks)}` })
  }

  // Остойчивость.
  {
    const base = { id: 'stability' as const, title: 'Остойчивость', target: 'stability' as const }
    const judged = f.trips.filter((t) => t.stability)
    const worst = judged.some((t) => t.stability!.verdict === 'error') ? 'error' : judged.some((t) => t.stability!.verdict === 'warn') ? 'warn' : 'ok'
    if (!f.hasVessel) checks.push({ ...base, status: 'none', detail: 'Нет данных судна' })
    else if (judged.length === 0) checks.push({ ...base, status: 'none', detail: 'Нет гидростатики судна' })
    else if (worst === 'ok') checks.push({ ...base, status: 'ok', detail: 'Выполнено по формуляру' })
    else {
      const lines = stabilityLines(f.trips, multiTrip)
      checks.push({
        ...base,
        status: worst,
        detail: lines.filter((l) => l.status === worst).map((l) => l.text).join(' · '),
        lines,
      })
    }
  }

  // Требуют внимания — only when there is something.
  {
    const a = f.attention
    const parts = [
      a.malformed > 0 && `Повреждённые штабели: ${a.malformed}`,
      a.legacyUnknown > 0 && `Штабели с неизвестным составом: ${a.legacyUnknown}`,
      a.rejectedPins > 0 && `Недопустимые закреплённые позиции: ${a.rejectedPins}`,
      a.manualConflicts > 0 && `Штабели там, где стоять нельзя: ${a.manualConflicts}`,
    ].filter((p): p is string => !!p)
    if (parts.length > 0)
      checks.push({ id: 'attention', title: 'Требуют внимания', status: 'error', detail: parts.join(' · '), target: 'checks' })
  }

  return checks
}

// The stability reasons of the plan, errors first, by trips and states:
// «Рейс 2, приход: GM 1.12 м ниже предела…». A reason the same on several
// trips is one line naming them; the trips are named only when there is
// more than one, the state only when the reason holds in one of the two.
function stabilityLines(trips: TripFacts[], multiTrip: boolean): NonNullable<Check['lines']> {
  const STATE: Record<LoadingState, string> = { departure: 'отход', arrival: 'приход' }
  const grouped = new Map<string, { status: 'warn' | 'error'; text: string; states: LoadingState[]; trips: number[] }>()
  trips.forEach((t, i) => {
    for (const r of t.stability?.reasons ?? []) {
      const key = `${r.status}|${r.states.join(',')}|${r.text}`
      const g = grouped.get(key)
      if (g) g.trips.push(i + 1)
      else grouped.set(key, { ...r, trips: [i + 1] })
    }
  })
  return [...grouped.values()]
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'error' ? -1 : 1))
    .map((g) => {
      const where = [
        multiTrip && `${g.trips.length === 1 ? 'Рейс' : 'Рейсы'} ${g.trips.join(', ')}`,
        g.states.length === 1 && STATE[g.states[0]],
      ].filter((p): p is string => !!p)
      const prefix = where.join(', ')
      return { status: g.status, text: prefixedReason(prefix && prefix[0].toUpperCase() + prefix.slice(1), g.text) }
    })
}

// ✕ and ⚠ in the list; «—» counts as neither (8.4).
export function checkCounts(checks: readonly Check[]): { errors: number; warnings: number } {
  return {
    errors: checks.filter((c) => c.status === 'error').length,
    warnings: checks.filter((c) => c.status === 'warn').length,
  }
}

// A line of a check's details (8.4): what is wrong, where.
export interface CheckDetailLine {
  status: 'warn' | 'error' | 'info'
  text: string
  // The trip it is about (0-based) — set only when there is more than one.
  trip?: number
}

export interface CheckDetails {
  lines: CheckDetailLine[]
  // The stacks at fault on each trip (0-based), by key: the deck lights up
  // those of the open trip.
  stacks: Map<number, Set<string>>
}

// What a check found, itemised, and the stacks it blames — read off the same
// facts the check's status comes from. Stability's reasons are the check's
// own `lines`.
export function checkDetails(f: PlanFacts, id: CheckId): CheckDetails {
  const multiTrip = f.trips.length > 1
  const lines: CheckDetailLine[] = []
  const stacks = new Map<number, Set<string>>()
  const add = (trip: number, status: CheckDetailLine['status'], text: string, ...blamed: StackRef[]) => {
    lines.push(multiTrip ? { status, text, trip } : { status, text })
    if (blamed.length === 0) return
    const set = stacks.get(trip) ?? new Set<string>()
    for (const b of blamed) set.add(b.key)
    stacks.set(trip, set)
  }
  const unit = f.unitLabel ?? 'м'
  f.trips.forEach((t, i) => {
    const found = t.found
    switch (id) {
      case 'capacity':
        if (f.tenFoot) add(i, 'info', `10-футовых контейнеров: ${f.tenFoot.byTrip[i] ?? 0} из ${fmtNumber(f.tenFoot.capacity)}`)
        break
      case 'deck-weight':
        if (f.maxDeckCargoT !== undefined && multiTrip) {
          const over = t.weightKg / 1000 > f.maxDeckCargoT + 1e-9
          add(i, over ? 'error' : 'info', `${fmtTonnes(t.weightKg)} из ${f.maxDeckCargoT} т`)
        }
        break
      case 'zones':
        for (const z of found?.zones ?? [])
          add(i, 'error', `${z.label}: ${fmtNumber(z.densityTPerM2)} из ${fmtNumber(z.limitTPerM2)} т/м²`, ...z.stacks)
        for (const p of found?.pressure ?? [])
          add(i, 'error', `«${p.stack.name}»: под грузом ${fmtNumber(p.pressureTPerM2)} т/м² при лимите ${fmtNumber(p.limitTPerM2)}`, p.stack)
        break
      case 'separation':
        for (const v of found?.separation ?? [])
          add(i, 'error', `«${v.a.name}» и «${v.b.name}»: ${fmtNumber(v.distance)} из ${fmtNumber(v.minDistance)} ${unit}`, v.a, v.b)
        break
      case 'lashing':
        for (const l of found?.lashingShort ?? []) {
          const why = [
            l.attached < l.required && `нужно ${l.required}, задано ${l.attached}`,
            l.balanceFails && 'не держит по расчёту сил',
          ].filter((w): w is string => !!w)
          add(i, 'warn', `«${l.stack.name}»: ${why.join('; ')}`, l.stack)
        }
        for (const d of found?.dangerousGoods ?? [])
          add(i, 'warn', `«${d.name}»: опасный груз — крепление и сегрегация по IMDG Code`, d)
        break
      case 'attention':
        for (const q of found?.quarantined ?? []) add(i, 'error', `«${q.name}»: данные штабеля повреждены, на палубе его нет`)
        for (const u of found?.unknownMakeup ?? []) add(i, 'error', `«${u.stack.name}»: состав неизвестен`, u.stack)
        for (const r of found?.rejectedPins ?? []) add(i, 'error', `«${r.name}»: закреплённая позиция недопустима — ${lowerFirst(r.reason)}`)
        for (const c of found?.conflicts ?? []) add(i, 'error', `«${c.stack.name}»: ${lowerFirst(c.reason)}`, c.stack)
        break
    }
  })
  // The cargo itself, not a trip's: what fits nowhere, or waits to be placed.
  if (id === 'capacity')
    lines.unshift(...(f.unfit ?? []).map((u) => ({ status: f.mode === 'auto' ? ('error' as const) : ('warn' as const), text: `«${u.name}»: ${lowerFirst(u.reason)}` })))
  return { lines, stacks }
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase('ru') + text.slice(1)
}
