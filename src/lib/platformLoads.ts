// What the supply run brings and takes, as a platform's calculations read
// the plan (spec 2026-11-06, 7.2, 11.3, 12):
// - each stack arriving, at its height and its place on the deck — a mixed
//   pile by its parts, each by its own cargo's status, since cargo arriving
//   may stand on cargo already aboard;
// - the cargo leaving, one tier high on the deck's lowest level, as the plan
//   doesn't say where it stands — the least moment taken off;
// - the units arriving with no weight: on the deck, in no figure — no check
//   is passed while they aren't counted.
import type { DeckConfig } from '@/store/calculator'
import type { PlacedWeight } from './jackUp'
import { platformStatusOf } from './objectKind'
import type { CargoItem, PackingResult } from './packing'
import { segmentWeights } from './placementComposition'
import type { Weight } from './semiSub'
import { buildCargoWeightMoments, catalogInMeters, deckLevels, footprintCenter, lowestDeckLevel, placementLevel, placementsInMeters } from './stability'
import { resolveShipFrame } from './stabilityConditions'
import { computeItemVCG } from './stabilityMath'
import { toMeters } from './units'

export interface PlatformLoads {
  arriving: PlacedWeight[]
  leaving: Weight[]
  // Units arriving with no weight given.
  unweighed: number
  // The deck's height over the baseline isn't given: the cargo's heights
  // aren't known, nor the KG they move.
  heightMissing: boolean
}

export function platformLoads(deck: DeckConfig, trip: PackingResult | undefined, items: readonly CargoItem[]): PlatformLoads {
  const { frame, heightMissing } = resolveShipFrame(deck.shipFrame)
  const status = new Map(items.map((it) => [it.id, platformStatusOf(it)]))
  const unit = deck.unit
  // Heights and a cargo's own VCG in metres, as the stability works them.
  const itemsM = catalogInMeters([...items], unit)
  const widthM = toMeters(deck.width, unit)
  const lengthM = toMeters(deck.length, unit)
  const forward = deck.deckForwardIsPositiveY ?? true
  const levels = deckLevels(deck.loadZones, unit)
  const arriving: PlacedWeight[] = []
  let unweighed = 0
  for (const p of placementsInMeters([...(trip?.placed ?? [])], unit)) {
    // Where its weight stands on the deck, in the deck's own metres.
    const { x, y } = footprintCenter(p)
    if (!p.composition) {
      if (status.get(p.itemId) !== 'incoming') continue
      const [w] = buildCargoWeightMoments([p], widthM, lengthM, frame, forward, itemsM, levels)
      if (w) arriving.push({ weightT: w.weightKg / 1000, vcgM: w.vcgM, x, y })
      else unweighed += Math.max(1, p.layers)
      continue
    }
    // A mixed pile: each part on its own, at its own height in the pile.
    const base = frame.heightAboveBaselineM + placementLevel(levels, p)
    for (const part of segmentWeights(p, itemsM)) {
      if (status.get(part.itemId) !== 'incoming') continue
      if (part.weightKg > 0) arriving.push({ weightT: part.weightKg / 1000, vcgM: base + part.vcgM, x, y })
      else unweighed += part.layers
    }
  }
  const leaving: Weight[] = itemsM
    .filter((it) => status.get(it.id) === 'outgoing' && it.quantity > 0 && (it.weight ?? 0) > 0)
    .map((it) => ({
      weightT: ((it.weight ?? 0) * it.quantity) / 1000,
      vcgM: frame.heightAboveBaselineM + lowestDeckLevel(levels) + computeItemVCG({ height: it.height, layers: 1, stabilityOverride: it.stabilityOverride }),
    }))
  return { arriving, leaving, unweighed, heightMissing }
}

// A platform's checks with cargo arriving that has no weight: none of them
// passes — what they judge leaves that cargo out — and each says how much.
export function withUnweighed<C extends { status: 'ok' | 'warn' | 'error' | 'none'; detail: string }, R extends { checks: C[] }>(result: R, unweighed: number): R & { unweighed: number } {
  if (unweighed <= 0) return { ...result, unweighed: 0 }
  const note = ` · без веса не учтено ${unweighed} ед.`
  return {
    ...result,
    unweighed,
    checks: result.checks.map((c) => ({ ...c, status: c.status === 'ok' ? 'warn' : c.status, detail: `${c.detail}${note}` })),
  }
}
