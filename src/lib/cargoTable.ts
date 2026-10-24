// What the cargo table (spec 7.4) and the cargo list (7.1) work out about
// the cargo, kept out of the components so it can be tested on its own.

import type { CargoItem, PlacedItem } from './packing'
import { segmentsOf } from './placementComposition'

// The categories offered in every category field; the cargo's own ones are
// added to them.
export const DEFAULT_CATEGORIES = ['Обычный', 'Металлопродукция', 'Опасный груз', 'Химикаты', 'Взрывоопасный']

export interface PlacedOfItem {
  // Units of the cargo on the deck, in any trip.
  units: number
  // Stacks they stand in; a mixed stack counts once for each cargo in it.
  stacks: number
}

// Each cargo's units and stacks across the placements given — every trip's,
// so a unit carried to trip 2 still counts as placed. A mixed stack gives
// each cargo its own layers (segmentsOf).
export function placedByItem(placements: PlacedItem[]): Map<string, PlacedOfItem> {
  const out = new Map<string, PlacedOfItem>()
  for (const p of placements) {
    const seen = new Set<string>()
    for (const seg of segmentsOf(p)) {
      const units = Number.isFinite(seg.layers) && seg.layers > 0 ? seg.layers : 1
      const entry = out.get(seg.itemId) ?? { units: 0, stacks: 0 }
      entry.units += units
      if (!seen.has(seg.itemId)) entry.stacks += 1
      seen.add(seg.itemId)
      out.set(seg.itemId, entry)
    }
  }
  return out
}

export interface CargoTotals {
  units: number
  weightKg: number
  // Cargo whose weight isn't given — the total leaves it out.
  unweighed: number
  // Footprint of every unit, in the deck's unit squared.
  area: number
}

// The table's totals row.
export function cargoTotals(items: CargoItem[]): CargoTotals {
  return items.reduce<CargoTotals>(
    (t, it) => {
      const quantity = Math.max(0, it.quantity)
      if (it.weight === undefined || !(it.weight > 0)) t.unweighed += 1
      else t.weightKg += it.weight * quantity
      t.units += quantity
      t.area += it.width * it.length * quantity
      return t
    },
    { units: 0, weightKg: 0, unweighed: 0, area: 0 }
  )
}

// The rows a Shift-click selects: from the row clicked last to this one,
// both included, in the list's order.
export function rangeOf(ids: string[], anchor: string, target: string): string[] {
  const a = ids.indexOf(anchor)
  const b = ids.indexOf(target)
  if (a < 0 || b < 0) return [target]
  return ids.slice(Math.min(a, b), Math.max(a, b) + 1)
}

// «Ярусов» as maxLayersFor (packing.ts) applies it, in the words of the
// column's hint (spec 7.4).
export const LAYERS_RULE =
  'Сколько единиц этого груза можно поставить друг на друга. Предельная высота берётся у палубы и у самого груза, действует меньшая. ' +
  'Если она задана, ярусов столько, сколько помещается по высоте, но не больше этого числа; без высоты груза — один ярус. ' +
  'Если предельной высоты нет ни у палубы, ни у груза, ярусов столько, сколько указано здесь, а при пустом поле — один.'
