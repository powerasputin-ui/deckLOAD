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
import { fmtTonnes, pluralRu } from './utils'
import type { SectionId } from './workflow'

export type CheckStatus = 'ok' | 'warn' | 'error' | 'none'

export type CheckId = 'capacity' | 'deck-weight' | 'zones' | 'separation' | 'lashing' | 'stability' | 'attention'

export interface Check {
  id: CheckId
  title: string
  status: CheckStatus
  // What it found, in one line.
  detail: string
  // Where its settings are (8.4, «Где настройки»).
  target: SectionId
}

// One trip's stability by the booklet check (stabilityConditions.ts); a
// trip has none when the vessel's data can't give it (no hydrostatics).
export interface TripStability {
  verdict: 'ok' | 'warn' | 'error'
  // The reasons for ✕ and ⚠, one line each: «Приход: …» when only one of the
  // two states has it.
  reasons: { status: 'warn' | 'error'; text: string }[]
}

export interface TripFacts {
  weightKg: number
  overloadedZones: number
  separationViolations: number
  stability?: TripStability
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
    if (overloaded.length > 0) {
      const most = Math.max(...f.trips.map((t) => t.overloadedZones))
      checks.push({ ...base, status: 'error', detail: `Перегружено зон: ${most}${onTrips(overloaded)}` })
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
    const base = { id: 'stability' as const, title: 'Остойчивость', target: 'checks' as const }
    const judged = f.trips.filter((t) => t.stability)
    const worst = judged.some((t) => t.stability!.verdict === 'error') ? 'error' : judged.some((t) => t.stability!.verdict === 'warn') ? 'warn' : 'ok'
    if (!f.hasVessel) checks.push({ ...base, status: 'none', detail: 'Нет данных судна' })
    else if (judged.length === 0) checks.push({ ...base, status: 'none', detail: 'Нет гидростатики судна' })
    else if (worst === 'ok') checks.push({ ...base, status: 'ok', detail: 'Выполнено по формуляру' })
    else {
      // The same reason on several trips once, with the trips it's on.
      const onWhich = new Map<string, number[]>()
      f.trips.forEach((t, i) => {
        for (const r of t.stability?.reasons ?? []) if (r.status === worst) onWhich.set(r.text, [...(onWhich.get(r.text) ?? []), i + 1])
      })
      checks.push({ ...base, status: worst, detail: [...onWhich].map(([text, trips]) => `${text}${onTrips(trips)}`).join(' · ') })
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

// ✕ and ⚠ in the list; «—» counts as neither (8.4).
export function checkCounts(checks: readonly Check[]): { errors: number; warnings: number } {
  return {
    errors: checks.filter((c) => c.status === 'error').length,
    warnings: checks.filter((c) => c.status === 'warn').length,
  }
}
