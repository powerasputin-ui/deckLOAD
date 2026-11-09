// The facts the checks (checks.ts) are built from, gathered over the whole
// plan — every trip, not only the one on screen — with the calculations the
// app already has: zone loads, separation, the lashing force balance and the
// required lashing count, stability and the IMO criteria. Nothing new is
// calculated here; the same functions the deck, the sidebar and the PDF use
// are run over the plan.
import { isPlatform } from './objectKind'
import { semiSubForPlan } from './semiSubPlan'
import { jackUpForPlan } from './jackUpPlan'
import type { DeckConfig } from '@/store/calculator'
import {
  assessLashingRequirement,
  computeFootprintPressures,
  computeZoneLoads,
  isWholeDeckZone,
  lashingMethodologyFor,
  separationViolations,
  zoneIdsOverlapping,
  DEFAULT_VESSEL_MOTION,
  DEFAULT_WIRE_ROPE_TYPE,
  WIRE_ROPE_SPECS,
  type CargoItem,
  type ManualPlacement,
  type PackingResult,
  type PinnedPlacement,
  type PlacedItem,
  type SeparationRule,
} from './packing'
import { placementCategorySet, placementTotalHeightM, placementTotalVCG, placementTotalWeightKg, segmentLashingInputs, type ComposablePlacement } from './placementComposition'
import { evaluateTripStability, stabilityMissing, weightlessUnits, type TripStabilityResult } from './stabilityConditions'
import { appliedVessel } from './vesselLibrary'
import { toMeters, UNIT_LABEL } from './units'
import { CSS_G, cssAccelerations, securingBalance, type Accelerations, type SecuringResult } from './securing'
import { fmtNumber } from './utils'
import { autoPlacementKey } from './stackSelection'
import type { PlanFacts, StackRef, TripFacts, TripFindings, TripStability } from './checks'

export interface PlanInput {
  mode: 'auto' | 'manual'
  // The trips shown (an empty trailing trip left out).
  trips: readonly PackingResult[]
  pinnedPlacementsByTrip: Readonly<Record<number, readonly PinnedPlacement[]>>
  manualPlacements: readonly ManualPlacement[]
  items: CargoItem[]
  // A platform's whole list, its cargo leaving too (`items` is what stands
  // on its deck). Unset — `items`.
  allItems?: CargoItem[]
  deck: DeckConfig
  // In the deck's unit, like the placements.
  separationRules: readonly SeparationRule[]
}

export function gatherPlanFacts(p: PlanInput): PlanFacts {
  const { mode, trips, deck, items } = p
  const isQuarantined = (pl: { malformed?: unknown; composition?: unknown }) => !!pl.malformed && !pl.composition
  const pinsOf = (tripIndex: number) => p.pinnedPlacementsByTrip[tripIndex] ?? []
  // The plan's own placement records — the ones lashing points attach to and
  // flags live on. Pins left from an earlier auto session aren't part of a
  // manual plan.
  const records: readonly (ManualPlacement | PinnedPlacement)[] =
    mode === 'manual' ? p.manualPlacements : trips.flatMap((_, i) => pinsOf(i))

  const lastTrip = trips[trips.length - 1]
  const tripFacts = trips.map((t, i): TripFacts => {
    // The trip's own placement records: what flags and lashing points sit on.
    const tripRecords = (mode === 'manual' ? (i === 0 ? p.manualPlacements : []) : pinsOf(i)).filter((r) => !isQuarantined(r))
    const evaluation = evaluateDeckTripStability(deck, t, items)
    // The trip's GM sets its securing's accelerations (CSS Code, annex 13).
    const gm = securingGmOf(evaluation)
    const found = tripFindings(t, tripRecords, mode === 'auto' ? pinsOf(i) : [], deck, items, p.separationRules, gm)
    return {
      weightKg: t.totalWeight,
      overloadedZones: found.zones.length,
      overPressureStacks: found.pressure.length,
      securedStacks: tripRecords.filter((r) => lashingVerdict(r, deck, items, gm) !== 'none').length,
      separationViolations: found.separation.length,
      stability: tripStability(evaluation),
      stabilityMissing: deckStabilityMissing(deck, t),
      weightlessUnits: weightlessUnits(t.placed, items),
      found,
    }
  })

  // A count over every trip's findings.
  const sum = (count: (f: TripFindings) => number) => tripFacts.reduce((n, t) => n + count(t.found!), 0)

  return {
    mode,
    platform: isPlatform(deck),
    // A platform has one deck: the first trip is all of it. Cargo leaving is
    // in no trip — it comes from the whole list.
    semiSub: semiSubForPlan(deck, trips[0], p.allItems ?? items),
    jackUp: jackUpForPlan(deck, trips[0], p.allItems ?? items),
    totalUnits: items.reduce((n, it) => n + Math.max(0, it.quantity), 0),
    // Each trip passes on what it couldn't place, so what the last one
    // leaves fits nowhere; in manual mode it is what isn't placed yet.
    unplacedUnits: lastTrip ? Math.max(0, lastTrip.requestedCount - lastTrip.placedCount) : 0,
    trips: tripFacts,
    maxDeckCargoT: deck.maxDeckCargoT,
    zoneCount: deck.loadZones?.length ?? 0,
    deckStrength: deckStrengthState(deck),
    separationRuleCount: p.separationRules.length,
    lashing: {
      securedStacks: records.filter((r) => !isQuarantined(r) && lashingVerdict(r, deck, items) !== 'none').length,
      shortStacks: sum((f) => f.lashingShort.length),
      balanceFailStacks: sum((f) => f.lashingShort.filter((l) => l.balanceFails).length),
      uncheckedStacks: sum((f) => f.lashingUnchecked?.length ?? 0),
      uncheckedReason: tripFacts.flatMap((t) => t.found!.lashingUnchecked ?? [])[0]?.reason,
      dangerousGoodsStacks: sum((f) => f.dangerousGoods.length),
    },
    hasVessel: !!deck.vessel,
    unfit: lastTrip
      ? lastTrip.unplaced
          .filter((u) => (mode === 'auto' ? u.kind === 'shortfall' : u.kind === 'manual'))
          .map((u) => ({ name: u.name, reason: u.reason }))
      : [],
    tenFoot:
      deck.tenFootContainerCapacity !== undefined
        ? { capacity: deck.tenFootContainerCapacity, byTrip: trips.map((t) => tenFootUnits(t)) }
        : undefined,
    unitLabel: UNIT_LABEL[deck.unit],
    attention: {
      malformed: sum((f) => f.quarantined.length),
      legacyUnknown: sum((f) => f.unknownMakeup.length),
      rejectedPins: sum((f) => f.rejectedPins.length),
      manualConflicts: sum((f) => f.conflicts.length),
    },
  }
}

// What the checks find on one trip, stack by stack (spec 8.4). `records`
// are the trip's placement records on the deck, `pins` every pin of the trip
// (a rejected one is in no result).
function tripFindings(
  t: PackingResult,
  records: readonly (ManualPlacement | PinnedPlacement)[],
  pins: readonly PinnedPlacement[],
  deck: DeckConfig,
  items: CargoItem[],
  separationRules: readonly SeparationRule[],
  tripGmM?: number
): TripFindings {
  const ref = (pl: { itemId: string; x: number; y: number; name: string }): StackRef => ({ key: autoPlacementKey(pl), name: pl.name })
  const zones = deck.loadZones ?? []
  const loads = t.placed.map((pl) => ({ x: pl.x, y: pl.y, width: pl.width, length: pl.length, totalWeightKg: (pl.weight ?? 0) * pl.stackedCount }))
  const zoneLabel = (id: string) => {
    const index = zones.findIndex((z) => z.id === id)
    const zone = zones[index]
    return zone && isWholeDeckZone(zone, deck.width, deck.length) ? `Зона ${index + 1} (вся палуба)` : `Зона ${index + 1}`
  }
  return {
    zones:
      zones.length > 0
        ? computeZoneLoads(loads, zones, deck.outline, deck.unit)
            .filter((z) => z.exceeded)
            .map((z) => ({
              label: zoneLabel(z.zoneId),
              densityTPerM2: z.densityTPerM2,
              limitTPerM2: z.limitTPerM2,
              stacks: t.placed.filter((pl) => zoneIdsOverlapping(pl, zones).includes(z.zoneId)).map(ref),
            }))
        : [],
    pressure: computeFootprintPressures(loads, zones, deck.unit)
      .filter((c) => c.exceeded)
      .map((c) => ({ stack: ref(t.placed[c.index]), pressureTPerM2: c.pressureTPerM2, limitTPerM2: c.limitTPerM2 })),
    separation: separationViolations(
      t.placed.map((pl) => ({ x: pl.x, y: pl.y, width: pl.width, length: pl.length, categories: placementCategorySet(pl, items) })),
      separationRules
    ).map((v) => ({ a: ref(t.placed[v.a]), b: ref(t.placed[v.b]), distance: v.distance, minDistance: v.minDistance })),
    lashingShort: records.flatMap((r) => {
      const s = lashingShortfall(r, deck, items, tripGmM)
      return s ? [{ stack: ref(r), ...s }] : []
    }),
    lashingUnchecked: records.flatMap((r) => {
      const s = stackSecuring(r, deck, items, tripGmM)
      return s.status === 'unchecked' ? [{ stack: ref(r), reason: s.reason }] : []
    }),
    dangerousGoods: t.placed
      .filter((pl) => segmentLashingInputs(pl, items).some((seg) => lashingMethodologyFor(seg.category) === 'dangerous-goods'))
      .map(ref),
    unknownMakeup: records.filter((r) => r.legacyUnknownComposition).map((r) => ({ stack: ref(r), recordId: r.id })),
    // A manual stack stands where its record says: they share the key.
    conflicts: t.placed.flatMap((pl) => {
      const record = pl.conflict ? records.find((r) => autoPlacementKey(r) === autoPlacementKey(pl)) : undefined
      return record && pl.conflict ? [{ stack: ref(pl), recordId: record.id, reason: pl.conflict }] : []
    }),
    // Only a position the user locked is a problem: a rejected layout pin
    // (left by an applied variant) just has its units placed elsewhere.
    rejectedPins: t.unplaced.flatMap((u) =>
      u.kind === 'pin' && u.pinId && pins.find((pin) => pin.id === u.pinId)?.locked ? [{ recordId: u.pinId, name: u.name, reason: u.reason }] : []
    ),
    quarantined: t.quarantined.map((q) => ({ recordId: q.id, name: q.name })),
  }
}

// 10-foot units on a trip: every 10' catalogue cargo carries «10'» in its
// name, the only mark they have (see the PRESETS).
function tenFootUnits(t: PackingResult): number {
  return t.placed.filter((p) => p.name.includes("10'")).reduce((sum, p) => sum + p.stackedCount, 0)
}

// The booklet check of one trip, at departure and arrival.
function tripStability(evaluation: TripStabilityResult | undefined): TripStability | undefined {
  if (!evaluation) return undefined
  return {
    verdict: evaluation.verdict,
    reasons: evaluation.reasons.map((r) => ({ status: r.status, text: r.text, states: r.states })),
  }
}

// One trip's stability from the deck's own data — the reading the page,
// the checks and the PDF all share.
export function evaluateDeckTripStability(deck: DeckConfig, t: PackingResult, items: CargoItem[]): TripStabilityResult | undefined {
  if (!deck.vessel) return undefined
  return evaluateTripStability({
    vessel: deck.vessel,
    shipFrame: deck.shipFrame ?? {},
    deck: { width: deck.width, length: deck.length, unit: deck.unit, outline: deck.outline, loadZones: deck.loadZones },
    deckForwardIsPositiveY: deck.deckForwardIsPositiveY ?? true,
    placements: t.placed,
    items,
    icing: deck.icing ?? false,
  })
}

// Why the trip's stability isn't worked out though the vessel's data is
// there (stabilityMissing), for the places that say so.
export function deckStabilityMissing(deck: DeckConfig, t: PackingResult): string | undefined {
  if (!deck.vessel) return undefined
  return stabilityMissing({ vessel: deck.vessel, shipFrame: deck.shipFrame ?? {}, placements: t.placed, icing: deck.icing ?? false })
}

function deckStrengthState(deck: DeckConfig): PlanFacts['deckStrength'] {
  if (!appliedVessel(deck)?.deckStrengthTPerM2) return undefined
  if (deck.deckStrengthChoiceTPerM2 === undefined) return 'pending'
  return (deck.loadZones ?? []).some((z) => isWholeDeckZone(z, deck.width, deck.length)) ? undefined : 'unchecked'
}

// The GM a trip's securing is judged by (securing.ts): the larger of
// departure and arrival — the larger the GM, the larger the accelerations.
export function securingGmOf(evaluation: TripStabilityResult | undefined): number | undefined {
  if (!evaluation) return undefined
  return Math.max(evaluation.departure.stability.GM_fluid, evaluation.arrival.stability.GM_fluid)
}

// A stack's securing by the balance of forces (CSS Code, annex 13 —
// securing.ts): 'none' without lashing points; 'unchecked' when a figure it
// needs isn't there (no data, no green); 'checked' with the six balances.
export type StackSecuring =
  | { status: 'none' }
  | { status: 'unchecked'; reason: string }
  | { status: 'checked'; result: SecuringResult; accelerations: Accelerations; source: 'css' | 'custom' }

type SecuredRecord = ComposablePlacement & { id: string; x: number; y: number; width: number; length: number }

// Where the stack's centre is along the vessel, 0 at the aft perpendicular
// and 1 at the forward one — unknown without the vessel's length and the
// deck's place on it.
function alongShipFraction(deck: DeckConfig, r: SecuredRecord): number | undefined {
  const v = deck.vessel?.particulars
  const L = v?.lengthBpp
  const offset = deck.shipFrame?.originOffsetFromMidshipsM
  if (!v || !(L !== undefined && L > 0) || offset === undefined || !Number.isFinite(offset)) return undefined
  const along = toMeters(r.y + r.length / 2, deck.unit) - toMeters(deck.length, deck.unit) / 2
  const lcg = offset + ((deck.deckForwardIsPositiveY ?? true) ? along : -along)
  return (v.longitudinalOrigin === 'midships' ? lcg + L / 2 : lcg) / L
}

export function stackSecuring(r: SecuredRecord, deck: DeckConfig, items: CargoItem[], tripGmM?: number): StackSecuring {
  const own = (deck.lashingPoints ?? []).filter((pt) => pt.placementId === r.id)
  if (own.length === 0) return { status: 'none' }
  const m = (v: number) => toMeters(v, deck.unit)
  const lashings = own
    .filter((pt) => pt.cornerX !== undefined && pt.cornerY !== undefined && (pt.mslKg ?? 0) > 0)
    .map((pt) => ({ cornerX: m(pt.cornerX!), cornerY: m(pt.cornerY!), anchorX: m(pt.x), anchorY: m(pt.y), mslKg: pt.mslKg!, verticalAngleDeg: pt.verticalAngleDeg ?? 45 }))
  const massKg = placementTotalWeightKg(r, items)
  if (!(massKg > 0)) return { status: 'unchecked', reason: 'нет веса груза' }
  if (lashings.length === 0) return { status: 'unchecked', reason: 'у точек не задан MSL' }
  const motion = deck.vesselMotion ?? DEFAULT_VESSEL_MOTION
  let accelerations: Accelerations
  if (motion.preset === 'custom') {
    if (!(motion.ay > 0) && !(motion.ax > 0)) return { status: 'unchecked', reason: 'свои ускорения не заданы' }
    accelerations = { ax: motion.ax * CSS_G, ay: motion.ay * CSS_G, az: motion.az * CSS_G }
  } else {
    const particulars = deck.vessel?.particulars
    const css = cssAccelerations(
      {
        lengthM: particulars && particulars.lengthBpp > 0 ? particulars.lengthBpp : motion.lengthM,
        breadthM: particulars && particulars.breadth > 0 ? particulars.breadth : motion.breadthM,
        speedKn: motion.speedKn,
        gmM: tripGmM ?? motion.gmM,
      },
      alongShipFraction(deck, r)
    )
    if (css.status === 'missing') return { status: 'unchecked', reason: `нет: ${css.missing.join(', ')}` }
    if (css.status === 'outside') return { status: 'unchecked', reason: `вне таблиц CSS Code: ${css.reason} — задайте свои ускорения` }
    accelerations = css.accelerations
  }
  const heightM = m(placementTotalHeightM(r, items))
  // Without a height the wind, the sloshing and the tipping would come out
  // as nothing — no data, no green.
  if (!(heightM > 0)) return { status: 'unchecked', reason: 'нет высоты груза' }
  // The centre of gravity as given, even above the stack's top (an override
  // the height doesn't hold): cut to the top, the tipping moment came out
  // smaller — not on the safe side (audit 2026-11-09).
  const cgHeightM = Math.max(0, m(placementTotalVCG(r, items)))
  const result = securingBalance(
    { massKg, x: m(r.x), y: m(r.y), width: m(r.width), length: m(r.length), heightM, cgHeightM },
    lashings,
    accelerations,
    motion.friction
  )
  return { status: 'checked', result, accelerations, source: motion.preset === 'custom' ? 'custom' : 'css' }
}

// A stack's lashing: 'none' without lashing points (not judged); 'short' when
// the balance of forces (CSS Code, annex 13 — the check behind the green and
// red points on the deck) fails, or when it has fewer points than the
// required count and no justification (the sidebar asks for one, and it
// goes into the PDF).
export function lashingVerdict(
  r: ManualPlacement | PinnedPlacement,
  deck: DeckConfig,
  items: CargoItem[],
  tripGmM?: number
): 'none' | 'ok' | 'short' {
  if (!(deck.lashingPoints ?? []).some((pt) => pt.placementId === r.id)) return 'none'
  return lashingShortfall(r, deck, items, tripGmM) ? 'short' : 'ok'
}

// How a secured stack falls short, or null when it doesn't (or has no
// lashing points to judge). A balance not worked out for lack of data is
// no shortfall — the check says it apart.
export function lashingShortfall(
  r: ManualPlacement | PinnedPlacement,
  deck: DeckConfig,
  items: CargoItem[],
  tripGmM?: number
): { required: number; attached: number; balanceFails: boolean } | null {
  const attached = (deck.lashingPoints ?? []).filter((pt) => pt.placementId === r.id)
  if (attached.length === 0) return null
  const securing = stackSecuring(r, deck, items, tripGmM)
  const breakingLoadKN = WIRE_ROPE_SPECS[r.lashingWireType ?? DEFAULT_WIRE_ROPE_TYPE].breakingLoadKN
  const required = Math.max(
    0,
    ...segmentLashingInputs(r, items).map((seg) => {
      const a = assessLashingRequirement(seg.category, seg.weightKg, breakingLoadKN)
      return a.status === 'calculated' ? a.requiredCount : 0
    })
  )
  const tooFew = attached.length < required && !r.lashingJustification?.trim()
  const balanceFails = securing.status === 'checked' && !securing.result.ok
  return tooFew || balanceFails ? { required, attached: attached.length, balanceFails } : null
}

// What is wrong with one stack, for its inspector (spec 6.5): the facts the
// checks count, about this stack only. `placed` is the stack on the open
// trip's deck (absent when the packer refused the position), `record` its
// pin or manual placement, when it has one.
export function stackProblems(p: {
  placed?: PlacedItem
  record?: ManualPlacement | PinnedPlacement
  trip: PackingResult
  deck: DeckConfig
  items: CargoItem[]
  separationRules: readonly SeparationRule[]
}): string[] {
  const { placed, record, trip, deck, items } = p
  const problems: string[] = []
  if (placed?.conflict) problems.push(`Стоит там, где нельзя: ${placed.conflict.toLowerCase()}`)
  if (record?.legacyUnknownComposition)
    problems.push('Состав неизвестен: штабель объединили до того, как расчёт стал хранить состав')
  if (placed) {
    const zones = deck.loadZones ?? []
    if (zones.length > 0) {
      const loads = new Map(
        computeZoneLoads(
          trip.placed.map((pl) => ({ x: pl.x, y: pl.y, width: pl.width, length: pl.length, totalWeightKg: (pl.weight ?? 0) * pl.stackedCount })),
          zones,
          deck.outline,
          deck.unit
        ).map((z) => [z.zoneId, z])
      )
      for (const id of zoneIdsOverlapping(placed, zones)) {
        const z = loads.get(id)
        if (z?.exceeded) problems.push(`Перегружена зона: ${fmtNumber(z.densityTPerM2)} из ${fmtNumber(z.limitTPerM2)} т/м²`)
      }
    }
    const index = trip.placed.indexOf(placed)
    const pairs = separationViolations(
      trip.placed.map((pl) => ({ x: pl.x, y: pl.y, width: pl.width, length: pl.length, categories: placementCategorySet(pl, items) })),
      p.separationRules
    )
    for (const v of pairs) {
      if (v.a !== index && v.b !== index) continue
      const other = trip.placed[v.a === index ? v.b : v.a]
      problems.push(
        `Сепарация: ${fmtNumber(v.distance)} из ${fmtNumber(v.minDistance)} ${UNIT_LABEL[deck.unit]} до «${other.name}»`
      )
    }
  }
  if (record && lashingVerdict(record, deck, items, securingGmOf(evaluateDeckTripStability(deck, trip, items))) === 'short')
    problems.push('Не хватает крепления')
  return problems
}
