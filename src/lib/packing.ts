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

export interface PackingResult {
  placed: PlacedItem[]
  unplaced: UnplacedItem[]
  totalArea: number
  usedArea: number
  freeArea: number
  utilization: number // 0..1
  totalWeight: number
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

export function packDeck(
  deckWidth: number,
  deckLength: number,
  items: CargoItem[],
  sortStrategy: SortStrategy = 'area-desc'
): PackingResult {
  const totalArea = deckWidth * deckLength
  const result: PackingResult = {
    placed: [],
    unplaced: [],
    totalArea,
    usedArea: 0,
    freeArea: totalArea,
    utilization: 0,
    totalWeight: 0,
    deckWidth,
    deckLength,
  }

  if (deckWidth <= 0 || deckLength <= 0) return result

  const freeRects: FreeRect[] = [
    { x: 0, y: 0, width: deckWidth, height: deckLength },
  ]

  const sorted = sortItems(items, sortStrategy)
  let index = 0

  for (const item of sorted) {
    if (item.width <= 0 || item.length <= 0) {
      result.unplaced.push({
        itemId: item.id,
        name: item.name,
        width: item.width,
        length: item.length,
        reason: 'Некорректные размеры',
      })
      continue
    }
    // Skip if item larger than deck in both orientations
    const fitsNormal = item.width <= deckWidth && item.length <= deckLength
    const fitsRotated =
      item.allowRotation && item.length <= deckWidth && item.width <= deckLength
    if (!fitsNormal && !fitsRotated) {
      result.unplaced.push({
        itemId: item.id,
        name: item.name,
        width: item.width,
        length: item.length,
        reason: 'Превышает размеры палубы',
      })
      continue
    }

    const pos = findPosition(
      freeRects,
      item.width,
      item.length,
      item.allowRotation
    )
    if (!pos) {
      result.unplaced.push({
        itemId: item.id,
        name: item.name,
        width: item.width,
        length: item.length,
        reason: 'Недостаточно свободного места',
      })
      continue
    }

    placeRect(pos.node, freeRects)
    result.placed.push({
      itemId: item.id,
      name: item.name,
      x: pos.node.x,
      y: pos.node.y,
      width: pos.node.width,
      length: pos.node.height,
      rotated: pos.rotated,
      color: item.color,
      weight: item.weight,
      index: index++,
    })
    result.usedArea += pos.node.width * pos.node.height
    if (item.weight) result.totalWeight += item.weight
  }

  result.freeArea = Math.max(0, totalArea - result.usedArea)
  result.utilization = totalArea > 0 ? result.usedArea / totalArea : 0
  return result
}

// Compute remaining free rectangles for visualization
export function computeFreeRects(
  deckWidth: number,
  deckLength: number,
  placed: PlacedItem[]
): Rect[] {
  let free: FreeRect[] = [
    { x: 0, y: 0, width: deckWidth, height: deckLength },
  ]
  for (const p of placed) {
    placeRect(
      { x: p.x, y: p.y, width: p.width, height: p.length },
      free
    )
  }
  return free.filter(
    (f) => f.width > 1e-6 && f.height > 1e-6
  )
}
