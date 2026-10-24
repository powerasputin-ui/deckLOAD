// The cargo catalogue (spec 7.2): its groups, the search over them, and the
// templates brought into the deck's unit — kept out of the component so it
// can be tested on its own.

import type { CargoItem } from './packing'
import { convertLength, type Unit } from './units'

export interface CatalogGroup {
  key: string
  label: string
  items: Partial<CargoItem>[]
  // The group's own tool under its templates («Конструктор штабеля»,
  // «Нарисовать форму»): the search finds the group by its name too.
  tool?: string
}

const fold = (text: string) => text.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim()

// The groups with the templates whose name holds the query, in their order.
// A group with no such template stays only when its tool's name holds it;
// an empty query keeps everything.
export function searchCatalog(groups: CatalogGroup[], query: string): CatalogGroup[] {
  const q = fold(query)
  if (!q) return groups
  return groups
    .map((g) => ({ ...g, items: g.items.filter((it) => fold(it.name ?? '').includes(q)) }))
    .filter((g) => g.items.length > 0 || (g.tool !== undefined && fold(g.tool).includes(q)))
}

// Templates are written in metres; the cargo they add is in the deck's unit.
export function templateInUnit(template: Partial<CargoItem>, unit: Unit): Partial<CargoItem> {
  const conv = (v: number | undefined) => (v === undefined ? undefined : convertLength(v, 'm', unit))
  return { ...template, width: conv(template.width), length: conv(template.length), height: conv(template.height) }
}

// The cargo's own size, longest side first, as a catalogue names it:
// «6.06×2.44×2.59» for a 20-foot container however it stands on the deck.
export function ownSize(template: Partial<CargoItem>): number[] {
  const w = template.width ?? 0
  const l = template.length ?? 0
  const sides = [Math.max(w, l), Math.min(w, l)]
  return template.height ? [...sides, template.height] : sides
}
