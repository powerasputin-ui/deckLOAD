// A semi-submersible's plan as its calculation sees it (spec 2026-11-06,
// 7.2): the stacks arriving with the supply run, at the heights the deck
// gives them, and the cargo leaving with it. What is on board is in the
// daily report already and moves nothing.
import type { DeckConfig } from '@/store/calculator'
import { platformStatusOf } from './objectKind'
import type { CargoItem, PackingResult } from './packing'
import { EMPTY_SEMI_SUB, evaluateSemiSub, type SemiSubResult, type Weight } from './semiSub'
import { buildCargoWeightMoments, catalogInMeters, placementsInMeters } from './stability'
import { resolveShipFrame } from './stabilityConditions'
import { computeItemVCG } from './stabilityMath'
import { toMeters } from './units'

export function semiSubForPlan(deck: DeckConfig, trip: PackingResult | undefined, items: readonly CargoItem[]): SemiSubResult | undefined {
  if (deck.objectKind !== 'semi-sub') return undefined
  const { frame, heightMissing } = resolveShipFrame(deck.shipFrame)
  const status = new Map(items.map((it) => [it.id, platformStatusOf(it)]))
  const unit = deck.unit
  // Heights and a cargo's own VCG in metres, as the stability works.
  const itemsM = catalogInMeters([...items], unit)
  const arrivingStacks = (trip?.placed ?? []).filter((p) => status.get(p.itemId) === 'incoming')
  const arriving: Weight[] = buildCargoWeightMoments(
    placementsInMeters(arrivingStacks, unit),
    toMeters(deck.width, unit),
    toMeters(deck.length, unit),
    frame,
    deck.deckForwardIsPositiveY ?? true,
    itemsM
  ).map((w) => ({ weightT: w.weightKg / 1000, vcgM: w.vcgM }))
  // Cargo leaving stands on the deck now, where the report has it: taken
  // one tier high, at its own height's middle (or its own VCG).
  const leaving: Weight[] = itemsM
    .filter((it) => status.get(it.id) === 'outgoing' && it.quantity > 0 && (it.weight ?? 0) > 0)
    .map((it) => ({
      weightT: ((it.weight ?? 0) * it.quantity) / 1000,
      vcgM: frame.heightAboveBaselineM + computeItemVCG({ height: it.height, layers: 1, stabilityOverride: it.stabilityOverride }),
    }))
  return evaluateSemiSub(deck.semiSub ?? EMPTY_SEMI_SUB, arriving, leaving, !heightMissing)
}
