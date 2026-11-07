// A self-elevating unit's plan as its calculation sees it (spec 2026-11-06,
// 11.3): the stacks arriving with the supply run, with their weight, height
// and place on the deck, and the cargo leaving (platformLoads). What is on
// board is in the daily report already.
import type { DeckConfig } from '@/store/calculator'
import { EMPTY_JACK_UP, evaluateJackUp, type JackUpResult } from './jackUp'
import type { CargoItem, PackingResult } from './packing'
import { platformLoads, withUnweighed } from './platformLoads'
import { toMeters } from './units'

export function jackUpForPlan(deck: DeckConfig, trip: PackingResult | undefined, items: readonly CargoItem[]): JackUpResult | undefined {
  if (deck.objectKind !== 'jack-up') return undefined
  const loads = platformLoads(deck, trip, items)
  const result = evaluateJackUp(
    deck.jackUp ?? EMPTY_JACK_UP,
    loads.arriving,
    loads.leaving,
    { lengthM: toMeters(deck.length, deck.unit), forwardIsPositiveY: deck.deckForwardIsPositiveY ?? true },
    !loads.heightMissing
  )
  return withUnweighed(result, loads.unweighed)
}
