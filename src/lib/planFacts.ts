// The facts the checks (checks.ts) are built from, gathered over the whole
// plan — every trip, not only the one on screen — with the calculations the
// app already has: zone loads, separation, the lashing force balance and the
// required lashing count, stability and the IMO criteria. Nothing new is
// calculated here; the same functions the deck, the sidebar and the PDF use
// are run over the plan.
import type { DeckConfig } from '@/store/calculator'
import {
  assessLashingRequirement,
  checkLashingBalance,
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
import { placementCategorySet, placementTotalLayers, placementTotalWeightKg, segmentLashingInputs } from './placementComposition'
import { evaluateTripStability, stabilityMissing, weightlessUnits, type TripStabilityResult } from './stabilityConditions'
import { appliedVessel } from './vesselLibrary'
import { UNIT_LABEL } from './units'
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
    const found = tripFindings(t, tripRecords, mode === 'auto' ? pinsOf(i) : [], deck, items, p.separationRules)
    return {
      weightKg: t.totalWeight,
      overloadedZones: found.zones.length,
      overPressureStacks: found.pressure.length,
      securedStacks: tripRecords.filter((r) => lashingVerdict(r, deck, items) !== 'none').length,
      separationViolations: found.separation.length,
      stability: tripStability(t, deck, items),
      stabilityMissing: deckStabilityMissing(deck, t),
      weightlessUnits: weightlessUnits(t.placed, items),
      found,
    }
  })

  // A count over every trip's findings.
  const sum = (count: (f: TripFindings) => number) => tripFacts.reduce((n, t) => n + count(t.found!), 0)

  return {
    mode,
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
  separationRules: readonly SeparationRule[]
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
      const s = lashingShortfall(r, deck, items)
      return s ? [{ stack: ref(r), ...s }] : []
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
function tripStability(t: PackingResult, deck: DeckConfig, items: CargoItem[]): TripStability | undefined {
  const evaluation = evaluateDeckTripStability(deck, t, items)
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
    deck: { width: deck.width, length: deck.length, unit: deck.unit, outline: deck.outline },
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

// A stack's lashing: 'none' without lashing points (not judged); 'short' when
// the force balance (IMO CSS Code, simplified — the check behind the green
// and red points on the deck) fails, or when it has fewer points than the
// required count and no justification (the sidebar asks for one, and it
// goes into the PDF).
export function lashingVerdict(
  r: ManualPlacement | PinnedPlacement,
  deck: DeckConfig,
  items: CargoItem[]
): 'none' | 'ok' | 'short' {
  if (!(deck.lashingPoints ?? []).some((pt) => pt.placementId === r.id)) return 'none'
  return lashingShortfall(r, deck, items) ? 'short' : 'ok'
}

// How a secured stack falls short, or null when it doesn't (or has no
// lashing points to judge).
export function lashingShortfall(
  r: ManualPlacement | PinnedPlacement,
  deck: DeckConfig,
  items: CargoItem[]
): { required: number; attached: number; balanceFails: boolean } | null {
  const attached = (deck.lashingPoints ?? []).filter((pt) => pt.placementId === r.id)
  if (attached.length === 0) return null
  const layers = Math.max(1, placementTotalLayers(r))
  const balance = checkLashingBalance(
    { x: r.x, y: r.y, width: r.width, length: r.length, weight: placementTotalWeightKg(r, items) / layers, layers },
    attached,
    deck.vesselMotion ?? DEFAULT_VESSEL_MOTION
  )
  const breakingLoadKN = WIRE_ROPE_SPECS[r.lashingWireType ?? DEFAULT_WIRE_ROPE_TYPE].breakingLoadKN
  const required = Math.max(
    0,
    ...segmentLashingInputs(r, items).map((seg) => {
      const a = assessLashingRequirement(seg.category, seg.weightKg, breakingLoadKN)
      return a.status === 'calculated' ? a.requiredCount : 0
    })
  )
  const tooFew = attached.length < required && !r.lashingJustification?.trim()
  const balanceFails = !!balance && !balance.ok
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
  if (record && lashingVerdict(record, deck, items) === 'short') problems.push('Не хватает крепления')
  return problems
}
