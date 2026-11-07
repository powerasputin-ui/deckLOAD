// A semi-submersible's plan as its calculation sees it (spec 2026-11-06,
// 7.2): the stacks arriving with the supply run, at the heights the deck
// gives them, and the cargo leaving with it (platformLoads). What is on board
// is in the daily report already and moves nothing.
import type { DeckConfig } from '@/store/calculator'
import type { CargoItem, PackingResult } from './packing'
import { platformLoads, withUnweighed } from './platformLoads'
import { EMPTY_SEMI_SUB, evaluateSemiSub, type SemiSubResult } from './semiSub'

export function semiSubForPlan(deck: DeckConfig, trip: PackingResult | undefined, items: readonly CargoItem[]): SemiSubResult | undefined {
  if (deck.objectKind !== 'semi-sub') return undefined
  const loads = platformLoads(deck, trip, items)
  return withUnweighed(evaluateSemiSub(deck.semiSub ?? EMPTY_SEMI_SUB, loads.arriving, loads.leaving, !loads.heightMissing), loads.unweighed)
}
