// 2D bin-packing for deck loading.
// Implements the Maximal Rectangles algorithm with the
// Best Short Side Fit (BSSF) heuristic and optional 90deg rotation.
// Reference: Jukka Jylänki - "A Thousand Ways to Pack the Bin".

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface CargoItem {
  id: string
  name: string
  width: number // along X axis
  length: number // along Y axis
  height: number // vertical (for tier/stacking calculations); 0 = ignore
  quantity: number
  color: string
  allowRotation: boolean
  weight?: number
}

export interface PlacedItem {
  itemId: string
  name: string
  x: number
  y: number
  width: number
  length: number
  height: number
  layers: number // how many tiers stacked on this footprint
  stackedCount: number // units actually placed here (layers)
  rotated: boolean
  color: string
  weight?: number
  index: number
}

export interface UnplacedItem {
  itemId: string
  name: string
  width: number
  length: number
  reason: string
}

export interface ItemBreakdown {
  itemId: string
  name: string
  color: string
  requested: number
  placed: number // units placed (including stacking)
  footprints: number // number of floor slots occupied
  layers: number // max tiers for this item type
  area: number // footprint area used
  weight: number // total weight of placed units
  unitWeight: number
}

export interface PackingResult {
  placed: PlacedItem[]
  unplaced: UnplacedItem[]
  breakdown: ItemBreakdown[]
  requestedCount: number // total number of item units requested
  placedCount: number // total units placed (including stacking)
  totalArea: number
  usedArea: number
  freeArea: number
  utilization: number // 0..1 (footprint)
  totalWeight: number
  maxStackHeight: number
  deckWidth: number
  deckLength: number
}

export type SortStrategy = 'area-desc' | 'area-asc' | 'width-desc' | 'height-desc' | 'quantity-desc' | 'none'

type FreeRect = Rect

function intersects(a: Rect, b: Rect): boolean {
  return !(
    b.x >= a.x + a.width ||
    b.x + b.width <= a.x ||
    b.y >= a.y + a.height ||
    b.y + b.height <= a.y
  )
}

function isContainedIn(a: Rect, b: Rect): boolean {
  return (
    a.x >= b.x &&
    a.y >= b.y &&
    a.x + a.width <= b.x + b.width &&
    a.y + a.height <= b.y + b.height
  )
}

function pruneFreeList(list: FreeRect[]): void {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; ) {
      if (isContainedIn(list[i], list[j])) {
        list.splice(i, 1)
        i--
        break
      } else if (isContainedIn(list[j], list[i])) {
        list.splice(j, 1)
      } else {
        j++
      }
    }
  }
}

interface ScoredNode {
  node: Rect
  rotated: boolean
  shortSide: number
  longSide: number
}

// Best Short Side Fit
function findPosition(
  freeRects: FreeRect[],
  width: number,
  height: number,
  allowRotation: boolean
): ScoredNode | null {
  let best: ScoredNode | null = null
  let bestShort = Infinity
  let bestLong = Infinity

  for (const fr of freeRects) {
    // Normal orientation
    if (fr.width >= width && fr.height >= height) {
      const leftoverHoriz = fr.width - width
      const leftoverVert = fr.height - height
      const shortSide = Math.min(leftoverHoriz, leftoverVert)
      const longSide = Math.max(leftoverHoriz, leftoverVert)
      if (
        shortSide < bestShort ||
        (shortSide === bestShort && longSide < bestLong)
      ) {
        best = {
          node: { x: fr.x, y: fr.y, width, height },
          rotated: false,
          shortSide,
          longSide,
        }
        bestShort = shortSide
        bestLong = longSide
      }
    }
    // Rotated orientation (swap width/height)
    if (allowRotation && fr.width >= height && fr.height >= width) {
      const leftoverHoriz = fr.width - height
      const leftoverVert = fr.height - width
      const shortSide = Math.min(leftoverHoriz, leftoverVert)
      const longSide = Math.max(leftoverHoriz, leftoverVert)
      if (
        shortSide < bestShort ||
        (shortSide === bestShort && longSide < bestLong)
      ) {
        best = {
          node: { x: fr.x, y: fr.y, width: height, height: width },
          rotated: true,
          shortSide,
          longSide,
        }
        bestShort = shortSide
        bestLong = longSide
      }
    }
  }
  return best
}

function placeRect(used: Rect, freeRects: FreeRect[]): void {
  const next: FreeRect[] = []
  for (const fr of freeRects) {
    if (!intersects(fr, used)) {
      next.push(fr)
      continue
    }
    if (used.x < fr.x + fr.width && used.x + used.width > fr.x) {
      if (used.x > fr.x) {
        next.push({
          x: fr.x,
          y: fr.y,
          width: used.x - fr.x,
          height: fr.height,
        })
      }
      if (used.x + used.width < fr.x + fr.width) {
        next.push({
          x: used.x + used.width,
          y: fr.y,
          width: fr.x + fr.width - (used.x + used.width),
          height: fr.height,
        })
      }
    }
    if (used.y < fr.y + fr.height && used.y + used.height > fr.y) {
      if (used.y > fr.y) {
        next.push({
          x: fr.x,
          y: fr.y,
          width: fr.width,
          height: used.y - fr.y,
        })
      }
      if (used.y + used.height < fr.y + fr.height) {
        next.push({
          x: fr.x,
          y: used.y + used.height,
          width: fr.width,
          height: fr.y + fr.height - (used.y + used.height),
        })
      }
    }
  }
  pruneFreeList(next)
  freeRects.length = 0
  freeRects.push(...next)
}

function sortItems(items: CargoItem[], strategy: SortStrategy): CargoItem[] {
  const expanded = items.flatMap((it) => {
    const copies: CargoItem[] = []
    for (let i = 0; i < it.quantity; i++) {
      copies.push({ ...it, quantity: 1 })
    }
    return copies
  })

  const cmp = (a: CargoItem, b: CargoItem): number => {
    switch (strategy) {
      case 'area-desc':
        return b.width * b.length - a.width * a.length
      case 'area-asc':
        return a.width * a.length - b.width * b.length
      case 'width-desc':
        return b.width - a.width
      case 'height-desc':
        return b.length - a.length
      case 'quantity-desc':
        return 0
      case 'none':
        return 0
    }
  }
  expanded.sort(cmp)
  return expanded
}

export interface PackOptions {
  sortStrategy?: SortStrategy
  gap?: number // spacing between items
  boardOffset?: number // margin from the ship's board (deck edge)
  clearance?: number // max stack height above deck (0 = single tier)
  pinned?: PinnedPlacement[] // user-pinned stacks that must keep their positions
}

export interface PinnedPlacement {
  id: string // unique pin id
  itemId: string
  name: string
  x: number
  y: number
  width: number
  length: number
  layers: number
  rotated: boolean
  color: string
  weight?: number
}

// Compute how many tiers (layers) can be stacked for an item.
export function maxLayersFor(item: { height: number }, clearance: number): number {
  if (clearance <= 0 || item.height <= 0) return 1
  return Math.max(1, Math.floor(clearance / item.height + 1e-9))
}

export function packDeck(
  deckWidth: number,
  deckLength: number,
  items: CargoItem[],
  options: PackOptions | SortStrategy = 'area-desc'
): PackingResult {
  const sortStrategy =
    typeof options === 'string' ? options : options.sortStrategy ?? 'area-desc'
  const gap = Math.max(0, typeof options === 'string' ? 0 : options.gap ?? 0)
  const boardOffset =
    typeof options === 'string' ? 0 : Math.max(0, options.boardOffset ?? 0)
  const clearance =
    typeof options === 'string' ? 0 : Math.max(0, options.clearance ?? 0)
  const pinned =
    typeof options === 'string' ? [] : options.pinned ?? []

  const totalArea = deckWidth * deckLength
  const requestedCount = items.reduce((s, it) => s + it.quantity, 0)
  const result: PackingResult = {
    placed: [],
    unplaced: [],
    breakdown: [],
    requestedCount,
    placedCount: 0,
    totalArea,
    usedArea: 0,
    freeArea: totalArea,
    utilization: 0,
    totalWeight: 0,
    maxStackHeight: 0,
    deckWidth,
    deckLength,
  }

  if (deckWidth <= 0 || deckLength <= 0) return result

  // Usable region after board offset (margin from the ship's board)
  const ux = boardOffset
  const uy = boardOffset
  const uw = Math.max(0, deckWidth - boardOffset * 2)
  const ul = Math.max(0, deckLength - boardOffset * 2)

  const freeRects: FreeRect[] = [{ x: ux, y: uy, width: uw, height: ul }]

  // Account for units already placed in pinned stacks: reduce the quantity to pack
  const remainingByItem = new Map<string, number>()
  for (const it of items) remainingByItem.set(it.id, it.quantity)
  for (const pin of pinned) {
    const r = remainingByItem.get(pin.itemId) ?? 0
    remainingByItem.set(pin.itemId, Math.max(0, r - pin.layers))
  }

  // Reserve space for pinned stacks first: subtract their cells from free space
  let index = 0
  for (const pin of pinned) {
    // Place the pinned cell so subsequent packing avoids it
    placeRect(
      { x: pin.x, y: pin.y, width: pin.width + gap, height: pin.length + gap },
      freeRects
    )
    result.placed.push({
      itemId: pin.itemId,
      name: pin.name,
      x: pin.x,
      y: pin.y,
      width: pin.width,
      length: pin.length,
      height: 0,
      layers: pin.layers,
      stackedCount: pin.layers,
      rotated: pin.rotated,
      color: pin.color,
      weight: pin.weight,
      index: index++,
    })
    result.usedArea += pin.width * pin.length
    result.placedCount += pin.layers
    if (pin.weight) result.totalWeight += pin.weight * pin.layers
  }

  // Expand each item into the number of STACKS (floor footprints) needed.
  // A stack holds up to `layers` units vertically. Only the REMAINING quantity
  // (after pinned stacks) is expanded.
  interface Stack {
    item: CargoItem
    layers: number
    unitsInStack: number // units this particular stack will hold
  }
  const stacks: Stack[] = []
  const perItemRemaining = new Map<string, number>()
  for (const it of items) perItemRemaining.set(it.id, remainingByItem.get(it.id) ?? it.quantity)

  for (const item of items) {
    if (item.width <= 0 || item.length <= 0) continue
    const remaining = remainingByItem.get(item.id) ?? 0
    if (remaining <= 0) continue
    const layers = maxLayersFor(item, clearance)
    let r = remaining
    while (r > 0) {
      const units = Math.min(layers, r)
      stacks.push({ item, layers, unitsInStack: units })
      r -= units
    }
  }

  // Sort stacks by footprint area desc for better packing
  const stackCmp = (a: Stack, b: Stack): number => {
    switch (sortStrategy) {
      case 'area-desc':
        return b.item.width * b.item.length - a.item.width * a.item.length
      case 'area-asc':
        return a.item.width * a.item.length - b.item.width * b.item.length
      case 'width-desc':
        return b.item.width - a.item.width
      case 'height-desc':
        return b.item.length - a.item.length
      default:
        return 0
    }
  }
  stacks.sort(stackCmp)

  let stackIdx = 0

  for (const { item, layers, unitsInStack } of stacks) {
    if (perItemRemaining.get(item.id)! <= 0) continue

    const cellW = item.width + gap
    const cellL = item.length + gap
    const cellWRot = item.length + gap
    const cellLRot = item.width + gap

    const fitsNormal = cellW <= uw && cellL <= ul
    const fitsRotated =
      item.allowRotation && cellWRot <= uw && cellLRot <= ul
    if (!fitsNormal && !fitsRotated) {
      // Record unplaced only once per item type (avoid flooding)
      if (!result.unplaced.some((u) => u.itemId === item.id)) {
        result.unplaced.push({
          itemId: item.id,
          name: item.name,
          width: item.width,
          length: item.length,
          reason: 'Превышает размеры палубы',
        })
      }
      continue
    }

    const pos = findPosition(freeRects, cellW, cellL, item.allowRotation)
    if (!pos) {
      if (!result.unplaced.some((u) => u.itemId === item.id)) {
        result.unplaced.push({
          itemId: item.id,
          name: item.name,
          width: item.width,
          length: item.length,
          reason: 'Недостаточно свободного места',
        })
      }
      continue
    }

    placeRect(pos.node, freeRects)
    const visW = pos.rotated ? item.length : item.width
    const visL = pos.rotated ? item.width : item.length
    const stackHeight = item.height > 0 ? item.height * unitsInStack : 0
    result.placed.push({
      itemId: item.id,
      name: item.name,
      x: pos.node.x,
      y: pos.node.y,
      width: visW,
      length: visL,
      height: item.height,
      layers: unitsInStack,
      stackedCount: unitsInStack,
      rotated: pos.rotated,
      color: item.color,
      weight: item.weight,
      index: stackIdx++,
    })
    result.usedArea += visW * visL
    result.placedCount += unitsInStack
    if (item.weight) result.totalWeight += item.weight * unitsInStack
    if (stackHeight > result.maxStackHeight) result.maxStackHeight = stackHeight
    perItemRemaining.set(item.id, perItemRemaining.get(item.id)! - unitsInStack)
  }

  // Any remaining unplaced units
  for (const item of items) {
    const remaining = perItemRemaining.get(item.id) ?? 0
    if (remaining > 0 && !result.unplaced.some((u) => u.itemId === item.id)) {
      result.unplaced.push({
        itemId: item.id,
        name: item.name,
        width: item.width,
        length: item.length,
        reason: `Не вместилось ${remaining} ед.`,
      })
    }
  }

  // Build per-item breakdown
  for (const item of items) {
    const placedForItem = result.placed.filter((p) => p.itemId === item.id)
    const placedUnits = placedForItem.reduce((s, p) => s + p.stackedCount, 0)
    const footprints = placedForItem.length
    const layers = maxLayersFor(item, clearance)
    const area = placedForItem.reduce((s, p) => s + p.width * p.length, 0)
    const unitWeight = item.weight ?? 0
    result.breakdown.push({
      itemId: item.id,
      name: item.name,
      color: item.color,
      requested: item.quantity,
      placed: placedUnits,
      footprints,
      layers,
      area,
      weight: unitWeight * placedUnits,
      unitWeight,
    })
  }

  result.freeArea = Math.max(0, totalArea - result.usedArea)
  result.utilization = totalArea > 0 ? result.usedArea / totalArea : 0
  return result
}

// Compute remaining free rectangles for visualization. Uses cells that include
// the inter-item gap so the hatched region matches what the packer sees.
export function computeFreeRects(
  deckWidth: number,
  deckLength: number,
  placed: PlacedItem[],
  gap = 0,
  boardOffset = 0
): Rect[] {
  const ux = boardOffset
  const uy = boardOffset
  const uw = Math.max(0, deckWidth - boardOffset * 2)
  const ul = Math.max(0, deckLength - boardOffset * 2)
  let free: FreeRect[] = [{ x: ux, y: uy, width: uw, height: ul }]
  for (const p of placed) {
    placeRect(
      { x: p.x, y: p.y, width: p.width + gap, height: p.length + gap },
      free
    )
  }
  return free.filter((f) => f.width > 1e-6 && f.height > 1e-6)
}

// ---- Manual placement helpers ----

export interface ManualPlacement {
  id: string
  itemId: string
  name: string
  x: number
  y: number
  width: number
  length: number
  rotated: boolean
  color: string
  weight?: number
}

// Check whether a manual placement collides with any existing one.
export function collidesWith(
  placement: { x: number; y: number; width: number; length: number },
  others: { x: number; y: number; width: number; length: number }[],
  gap = 0
): boolean {
  const a = {
    x: placement.x - gap / 2,
    y: placement.y - gap / 2,
    w: placement.width + gap,
    h: placement.length + gap,
  }
  return others.some((o) => {
    const b = {
      x: o.x - gap / 2,
      y: o.y - gap / 2,
      w: o.width + gap,
      h: o.length + gap,
    }
    return !(
      a.x + a.w <= b.x ||
      b.x + b.w <= a.x ||
      a.y + a.h <= b.y ||
      b.y + b.h <= a.y
    )
  })
}

// Clamp a placement so it stays fully inside the deck.
export function clampToDeck(
  placement: { x: number; y: number; width: number; length: number },
  deckWidth: number,
  deckLength: number,
  edgePadding = 0
): { x: number; y: number; width: number; length: number } {
  const minX = edgePadding
  const minY = edgePadding
  const maxX = deckWidth - edgePadding - placement.width
  const maxY = deckLength - edgePadding - placement.length
  return {
    x: Math.max(minX, Math.min(maxX, placement.x)),
    y: Math.max(minY, Math.min(maxY, placement.y)),
    width: placement.width,
    length: placement.length,
  }
}

export function packingResultFromManual(
  deckWidth: number,
  deckLength: number,
  placements: ManualPlacement[],
  totalRequested: number
): PackingResult {
  const totalArea = deckWidth * deckLength
  const usedArea = placements.reduce((s, p) => s + p.width * p.length, 0)
  const totalWeight = placements.reduce((s, p) => s + (p.weight ?? 0), 0)

  const placed = placements.map((p, i) => ({
    itemId: p.itemId,
    name: p.name,
    x: p.x,
    y: p.y,
    width: p.width,
    length: p.length,
    height: 0,
    layers: 1,
    stackedCount: 1,
    rotated: p.rotated,
    color: p.color,
    weight: p.weight,
    index: i,
  }))

  // Breakdown by itemId
  const map = new Map<string, ItemBreakdown>()
  for (const p of placed) {
    const b = map.get(p.itemId) ?? {
      itemId: p.itemId,
      name: p.name,
      color: p.color,
      requested: 0,
      placed: 0,
      footprints: 0,
      layers: 1,
      area: 0,
      weight: 0,
      unitWeight: p.weight ?? 0,
    }
    b.placed += 1
    b.footprints += 1
    b.area += p.width * p.length
    b.weight += p.weight ?? 0
    map.set(p.itemId, b)
  }

  return {
    placed,
    unplaced: [],
    breakdown: [...map.values()],
    requestedCount: totalRequested,
    placedCount: placed.length,
    totalArea,
    usedArea,
    freeArea: Math.max(0, totalArea - usedArea),
    utilization: totalArea > 0 ? usedArea / totalArea : 0,
    totalWeight,
    maxStackHeight: 0,
    deckWidth,
    deckLength,
  }
}
