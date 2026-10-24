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
import type { DeckShipFrame } from './stability'
import { evaluateTripStability, reasonText, type TripStabilityResult } from './stabilityConditions'
import { vesselTemplateById } from './vesselTemplates'
import { UNIT_LABEL } from './units'
import { fmtNumber } from './utils'
import type { PlanFacts, TripFacts, TripStability } from './checks'

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

const NO_SHIP_FRAME: DeckShipFrame = { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 0, heightAboveBaselineM: 0 }

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
  const tripFacts = trips.map((t): TripFacts => ({
    weightKg: t.totalWeight,
    overloadedZones: overloadedZoneCount(t, deck),
    separationViolations: separationViolations(
      t.placed.map((pl) => ({ x: pl.x, y: pl.y, width: pl.width, length: pl.length, categories: placementCategorySet(pl, items) })),
      p.separationRules
    ).length,
    stability: tripStability(t, deck, items),
  }))

  return {
    mode,
    totalUnits: items.reduce((sum, it) => sum + Math.max(0, it.quantity), 0),
    // Each trip passes on what it couldn't place, so what the last one
    // leaves fits nowhere; in manual mode it is what isn't placed yet.
    unplacedUnits: lastTrip ? Math.max(0, lastTrip.requestedCount - lastTrip.placedCount) : 0,
    trips: tripFacts,
    maxDeckCargoT: deck.maxDeckCargoT,
    zoneCount: deck.loadZones?.length ?? 0,
    deckStrength: deckStrengthState(deck),
    separationRuleCount: p.separationRules.length,
    lashing: lashingFacts(trips, records.filter((r) => !isQuarantined(r)), deck, items),
    hasVessel: !!deck.vessel,
    attention: {
      malformed: trips.reduce((sum, t) => sum + t.quarantined.length, 0),
      legacyUnknown: records.filter((r) => r.legacyUnknownComposition).length,
      // Only a position the user locked is a problem: a rejected layout pin
      // (left by an applied variant) just has its units placed elsewhere.
      rejectedPins:
        mode === 'auto'
          ? trips.reduce(
              (sum, t, i) =>
                sum + t.unplaced.filter((u) => u.kind === 'pin' && pinsOf(i).find((pin) => pin.id === u.pinId)?.locked).length,
              0
            )
          : 0,
      manualConflicts: mode === 'manual' ? trips.reduce((sum, t) => sum + t.placed.filter((pl) => pl.conflict).length, 0) : 0,
    },
  }
}

function overloadedZoneCount(t: PackingResult, deck: DeckConfig): number {
  if (!deck.loadZones || deck.loadZones.length === 0) return 0
  const placements = t.placed.map((pl) => ({
    x: pl.x,
    y: pl.y,
    width: pl.width,
    length: pl.length,
    totalWeightKg: (pl.weight ?? 0) * pl.stackedCount,
  }))
  return computeZoneLoads(placements, deck.loadZones, deck.outline, deck.unit).filter((z) => z.exceeded).length
}

// The booklet check of one trip, at departure and arrival.
function tripStability(t: PackingResult, deck: DeckConfig, items: CargoItem[]): TripStability | undefined {
  const evaluation = evaluateDeckTripStability(deck, t, items)
  if (!evaluation) return undefined
  return {
    verdict: evaluation.verdict,
    reasons: evaluation.reasons.map((r) => ({ status: r.status, text: reasonText(r) })),
  }
}

// One trip's stability from the deck's own data — the reading the page,
// the checks and the PDF all share.
export function evaluateDeckTripStability(deck: DeckConfig, t: PackingResult, items: CargoItem[]): TripStabilityResult | undefined {
  if (!deck.vessel) return undefined
  return evaluateTripStability({
    vessel: deck.vessel,
    shipFrame: deck.shipFrame ?? NO_SHIP_FRAME,
    deck: { width: deck.width, length: deck.length, unit: deck.unit, outline: deck.outline },
    deckForwardIsPositiveY: deck.deckForwardIsPositiveY ?? true,
    placements: t.placed,
    items,
    icing: deck.icing ?? false,
  })
}

function deckStrengthState(deck: DeckConfig): PlanFacts['deckStrength'] {
  if (!vesselTemplateById(deck.vesselTemplateId)?.limits?.deckStrengthTPerM2) return undefined
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
  const attached = (deck.lashingPoints ?? []).filter((pt) => pt.placementId === r.id)
  if (attached.length === 0) return 'none'
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
  return (balance && !balance.ok) || tooFew ? 'short' : 'ok'
}

function lashingFacts(
  trips: readonly PackingResult[],
  records: readonly (ManualPlacement | PinnedPlacement)[],
  deck: DeckConfig,
  items: CargoItem[]
): PlanFacts['lashing'] {
  let securedStacks = 0
  let shortStacks = 0
  for (const r of records) {
    const verdict = lashingVerdict(r, deck, items)
    if (verdict === 'none') continue
    securedStacks++
    if (verdict === 'short') shortStacks++
  }
  const dangerousGoodsStacks = trips.reduce(
    (sum, t) =>
      sum +
      t.placed.filter((pl) =>
        segmentLashingInputs(pl, items).some((seg) => lashingMethodologyFor(seg.category) === 'dangerous-goods')
      ).length,
    0
  )
  return { securedStacks, shortStacks, dangerousGoodsStacks }
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
