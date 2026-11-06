// A self-elevating unit's plan as its calculation sees it (spec 2026-11-06,
// 11.3): the stacks arriving with the supply run, with their weight, height
// and place on the deck, and the cargo leaving. What is on board is in the
// daily report already.
import type { DeckConfig } from '@/store/calculator'
import { EMPTY_JACK_UP, evaluateJackUp, type JackUpResult, type PlacedWeight } from './jackUp'
import { platformStatusOf } from './objectKind'
import type { CargoItem, PackingResult } from './packing'
import type { Weight } from './semiSub'
import { buildCargoWeightMoments, catalogInMeters, deckLevels, lowestDeckLevel, placementsInMeters } from './stability'
import { resolveShipFrame } from './stabilityConditions'
import { computeItemVCG } from './stabilityMath'
import { toMeters } from './units'

export function jackUpForPlan(deck: DeckConfig, trip: PackingResult | undefined, items: readonly CargoItem[]): JackUpResult | undefined {
  if (deck.objectKind !== 'jack-up') return undefined
  const { frame, heightMissing } = resolveShipFrame(deck.shipFrame)
  const status = new Map(items.map((it) => [it.id, platformStatusOf(it)]))
  const unit = deck.unit
  const itemsM = catalogInMeters([...items], unit)
  const widthM = toMeters(deck.width, unit)
  const lengthM = toMeters(deck.length, unit)
  const forward = deck.deckForwardIsPositiveY ?? true
  const levels = deckLevels(deck.loadZones, unit)
  // Each stack arriving: its weight and height as the stability works them,
  // its centre on the deck in the deck's own metres.
  const arriving: PlacedWeight[] = placementsInMeters(
    (trip?.placed ?? []).filter((p) => status.get(p.itemId) === 'incoming'),
    unit
  ).flatMap((p) => {
    const [w] = buildCargoWeightMoments([p], widthM, lengthM, frame, forward, itemsM, levels)
    return w ? [{ weightT: w.weightKg / 1000, vcgM: w.vcgM, x: p.x + p.width / 2, y: p.y + p.length / 2 }] : []
  })
  // Cargo leaving: one tier high on the deck's lowest level, as on a
  // semi-submersible (semiSubPlan).
  const leaving: Weight[] = itemsM
    .filter((it) => status.get(it.id) === 'outgoing' && it.quantity > 0 && (it.weight ?? 0) > 0)
    .map((it) => ({
      weightT: ((it.weight ?? 0) * it.quantity) / 1000,
      vcgM: frame.heightAboveBaselineM + lowestDeckLevel(levels) + computeItemVCG({ height: it.height, layers: 1, stabilityOverride: it.stabilityOverride }),
    }))
  return evaluateJackUp(deck.jackUp ?? EMPTY_JACK_UP, arriving, leaving, { lengthM, forwardIsPositiveY: forward }, !heightMissing)
}
