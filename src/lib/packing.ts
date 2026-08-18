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
  category?: string // free-text cargo category (e.g. "Опасный груз") used by separation rules
  shape?: 'box' | 'cylinder' // 3D render hint (Deck3DView); defaults to 'box'. Footprint/packing math is unaffected — a cylinder still packs by its rectangular bounding box.
}

// A rectangular deck zone with its own permitted load density (t/m²).
export interface LoadZone {
  id: string
  x: number
  y: number
  width: number
  length: number
  maxLoadPerArea: number // t/m²
}

export interface LoadCheck {
  densityKgPerM2: number
  limitTPerM2: number
  zoneId: string
}

// Checks a footprint's LOCAL load density (its own weight over its own area —
// not a deck-wide sum) against every load zone it overlaps. If it straddles
// several zones, it's checked against the most restrictive (lowest) limit,
// since the whole footprint bears on every zone it touches. Returns null when
// there's no violation (no zone overlap, or density within every overlapping
// zone's limit) — callers treat this as informational/non-blocking.
export function checkLoadDensity(
  footprint: { x: number; y: number; width: number; length: number },
  totalWeightKg: number,
  zones: LoadZone[] | undefined
): LoadCheck | null {
  if (!zones || zones.length === 0) return null
  const area = footprint.width * footprint.length
  if (area <= 0) return null
  let minLimit: number | null = null
  let minZoneId = ''
  for (const z of zones) {
    const overlaps =
      footprint.x < z.x + z.width &&
      footprint.x + footprint.width > z.x &&
      footprint.y < z.y + z.length &&
      footprint.y + footprint.length > z.y
    if (!overlaps) continue
    if (minLimit === null || z.maxLoadPerArea < minLimit) {
      minLimit = z.maxLoadPerArea
      minZoneId = z.id
    }
  }
  if (minLimit === null) return null
  const densityKgPerM2 = totalWeightKg / area
  const densityTPerM2 = densityKgPerM2 / 1000
  const eps = 1e-9
  if (densityTPerM2 <= minLimit + eps) return null
  return { densityKgPerM2, limitTPerM2: minLimit, zoneId: minZoneId }
}

// A lashing/securing device running from one corner of a placed cargo unit
// (cornerX/cornerY, world coords) to an anchor point on the deck (x/y).
// Visual-only until placementId is set — an unattached point is just a pin,
// same as before this feature existed.
export type LashingDeviceType = 'chain_g80_10' | 'wire_18' | 'webbing_5t' | 'custom'

export interface LashingPoint {
  id: string
  x: number
  y: number
  label?: string
  placementId?: string // id of the pinned/manual placement this secures
  itemId?: string // cargo item type of that placement (for lookups/device suggestions)
  cornerX?: number
  cornerY?: number
  verticalAngleDeg?: number // angle of the lashing off the deck plane, default 45
  mslKg?: number // rated Maximum Securing Load of this device
  deviceType?: LashingDeviceType
}

// Typical securing devices with their rated MSL (kg) — selecting one
// auto-fills mslKg, which stays freely editable afterwards (custom gear).
export const LASHING_DEVICES: Record<LashingDeviceType, { label: string; mslKg: number }> = {
  chain_g80_10: { label: 'Цепь G80 10мм', mslKg: 4000 },
  wire_18: { label: 'Трос 18мм', mslKg: 3200 },
  webbing_5t: { label: 'Ремень 5т', mslKg: 2500 },
  custom: { label: 'Другое (вручную)', mslKg: 0 },
}

// Vessel motion coefficients (in g) used by the simplified static-equivalent
// lashing check below, plus the deck/cargo friction coefficient. Presets
// stand in for a full GM/roll-period calculation, which real-world lashing
// software also avoids asking casual users for.
export type VesselMotionPreset = 'open-sea' | 'coastal' | 'sheltered' | 'custom'

export interface VesselMotion {
  ax: number
  ay: number
  az: number
  friction: number
  preset: VesselMotionPreset
}

export const VESSEL_MOTION_PRESETS: Record<Exclude<VesselMotionPreset, 'custom'>, Omit<VesselMotion, 'preset'>> = {
  'open-sea': { ax: 0.3, ay: 0.5, az: 0.3, friction: 0.3 },
  coastal: { ax: 0.2, ay: 0.35, az: 0.2, friction: 0.3 },
  sheltered: { ax: 0.1, ay: 0.2, az: 0.1, friction: 0.3 },
}

export const DEFAULT_VESSEL_MOTION: VesselMotion = { ...VESSEL_MOTION_PRESETS.coastal, preset: 'coastal' }

export interface LashingDirectionCheck {
  requiredKg: number
  availableKg: number
  ok: boolean
}

export interface LashingCheck {
  transverse: LashingDirectionCheck
  longitudinal: LashingDirectionCheck
  ok: boolean
}

const G = 9.80665

// Simplified static-equivalent method (IMO CSS Code Annex 13 style): for each
// direction, the weight's own inertial force under the vessel's motion
// coefficient must be resisted by friction plus every attached lashing's
// component in that direction. Non-blocking — same contract as
// checkLoadDensity: pure function, returns a descriptive struct, never
// mutates, caller decides how (or whether) to surface it. Returns null when
// there's nothing attached to check (an unsecured item isn't a "failure",
// it's just not evaluated — callers should track that separately).
export function checkLashingBalance(
  placement: { x: number; y: number; width: number; length: number; weight?: number },
  lashings: LashingPoint[],
  motion: VesselMotion
): LashingCheck | null {
  const attached = lashings.filter(
    (l) => l.cornerX !== undefined && l.cornerY !== undefined && (l.mslKg ?? 0) > 0
  )
  if (attached.length === 0) return null
  const weightKg = placement.weight ?? 0
  const frictionForce = motion.friction * weightKg * G

  let transverseAvail = frictionForce
  let longitudinalAvail = frictionForce
  for (const l of attached) {
    const cornerX = l.cornerX!
    const cornerY = l.cornerY!
    const dx = l.x - cornerX
    const dy = l.y - cornerY
    const dist = Math.hypot(dx, dy)
    if (dist <= 1e-9) continue
    const verticalRad = ((l.verticalAngleDeg ?? 45) * Math.PI) / 180
    const horizontalComponent = Math.cos(verticalRad) // fraction of MSL acting in the deck plane
    // Deck-plane direction of the lashing, split into transverse (X, relative
    // to the ship's centerline running along Y) and longitudinal (Y) parts.
    const ux = Math.abs(dx / dist)
    const uy = Math.abs(dy / dist)
    const mslPlane = (l.mslKg ?? 0) * horizontalComponent * G
    transverseAvail += mslPlane * ux
    longitudinalAvail += mslPlane * uy
  }
  const transverseRequired = weightKg * G * motion.ay
  const longitudinalRequired = weightKg * G * motion.ax

  const transverse: LashingDirectionCheck = {
    requiredKg: transverseRequired / G,
    availableKg: transverseAvail / G,
    ok: transverseAvail >= transverseRequired,
  }
  const longitudinal: LashingDirectionCheck = {
    requiredKg: longitudinalRequired / G,
    availableKg: longitudinalAvail / G,
    ok: longitudinalAvail >= longitudinalRequired,
  }
  return { transverse, longitudinal, ok: transverse.ok && longitudinal.ok }
}

// A rule requiring at least `minDistance` (edge-to-edge, meters) between any
// cargo of `categoryA` and any cargo of `categoryB`. Symmetric: a rule for
// (A, B) also matches candidates in the order (B, A).
export interface SeparationRule {
  id: string
  categoryA: string
  categoryB: string
  minDistance: number
}

// Edge-to-edge distance between two axis-aligned rects (0 if overlapping/touching).
function edgeDistance(
  a: { x: number; y: number; width: number; length: number },
  b: { x: number; y: number; width: number; length: number }
): number {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0)
  const dy = Math.max(a.y - (b.y + b.length), b.y - (a.y + a.length), 0)
  return Math.hypot(dx, dy)
}

// Checks whether placing `candidate` too close to any already-`placed` item
// would violate a configured separation rule between their categories.
export function violatesSeparation(
  candidate: { x: number; y: number; width: number; length: number; category?: string },
  placed: { x: number; y: number; width: number; length: number; category?: string }[],
  rules: SeparationRule[] | undefined
): boolean {
  if (!rules || rules.length === 0 || !candidate.category) return false
  const eps = 1e-9
  for (const other of placed) {
    if (!other.category) continue
    const rule = rules.find(
      (r) =>
        (r.categoryA === candidate.category && r.categoryB === other.category) ||
        (r.categoryB === candidate.category && r.categoryA === other.category)
    )
    if (!rule) continue
    if (edgeDistance(candidate, other) < rule.minDistance - eps) return true
  }
  return false
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
  shape?: 'box' | 'cylinder'
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

export type SortStrategy = 'area-desc' | 'area-asc' | 'width-desc' | 'length-desc' | 'quantity-desc' | 'none'

// ---- numeric guards ----

function toFinite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function toPositiveInt(value: number, fallback = 1): number {
  const v = Math.round(toFinite(value, fallback))
  return v > 0 ? v : fallback
}

/** Coerce a layer/stack count to a positive integer (NaN/Infinity/≤0 safe). */
export function toLayers(value: number, fallback = 1): number {
  return toPositiveInt(value, fallback)
}

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


export interface PackOptions {
  sortStrategy?: SortStrategy
  gap?: number // spacing between items
  boardOffset?: number // margin from the ship's board (deck edge)
  clearance?: number // max stack height above deck (0 = single tier)
  pinned?: PinnedPlacement[] // user-pinned stacks that must keep their positions
  separationRules?: SeparationRule[] // category-pair minimum-distance rules
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
  const h = toFinite(item.height, 0)
  const c = toFinite(clearance, 0)
  if (c <= 0 || h <= 0) return 1
  const raw = c / h
  if (!Number.isFinite(raw)) return 1
  // A tiny epsilon prevents values like 1.9999999999999998 from losing a layer.
  return Math.max(1, Math.floor(raw + 1e-9))
}

export function packDeck(
  deckWidth: number,
  deckLength: number,
  itemsArg: CargoItem[],
  options: PackOptions | SortStrategy = 'area-desc'
): PackingResult {
  const sortStrategy =
    typeof options === 'string' ? options : options.sortStrategy ?? 'area-desc'
  const gap = toFinite(typeof options === 'string' ? 0 : options.gap ?? 0, 0)
  const boardOffset = toFinite(
    typeof options === 'string' ? 0 : options.boardOffset ?? 0,
    0
  )
  const clearance = toFinite(
    typeof options === 'string' ? 0 : options.clearance ?? 0,
    0
  )
  const pinned = typeof options === 'string' ? [] : options.pinned ?? []
  const separationRules = typeof options === 'string' ? [] : options.separationRules ?? []

  // Sanitize deck dimensions and spacing so NaN/Infinity can't poison the result.
  const safeDeckWidth = toFinite(deckWidth, 0)
  const safeDeckLength = toFinite(deckLength, 0)
  const totalArea = safeDeckWidth * safeDeckLength

  // Sanitize cargo items: coerce numeric fields to finite values so corrupted
  // storage or programmatic input can't propagate NaN into aggregations.
  const items = (Array.isArray(itemsArg) ? itemsArg : []).map((it) => ({
    ...it,
    width: toFinite(it.width, 1),
    length: toFinite(it.length, 1),
    height: toFinite(it.height, 0),
    // NOT toPositiveInt: quantity 0 is a legitimate "none of this cargo left"
    // (e.g. after deleting the last placed unit), not a corrupted value —
    // toPositiveInt treats 0 the same as NaN and would silently re-pack 1
    // unit anyway. Only genuinely invalid input (NaN/undefined/negative)
    // falls back to 1.
    quantity: Math.max(0, Math.round(toFinite(it.quantity, 1))),
    weight: it.weight === undefined ? undefined : toFinite(it.weight, 0),
  }))
  const categoryByItemId = new Map(items.map((it) => [it.id, it.category]))
  const heightByItemId = new Map(items.map((it) => [it.id, it.height]))
  const shapeByItemId = new Map(items.map((it) => [it.id, it.shape]))
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
    deckWidth: safeDeckWidth,
    deckLength: safeDeckLength,
  }

  if (safeDeckWidth <= 0 || safeDeckLength <= 0) return result

  // Usable region after board offset (margin from the ship's board).
  // The packer draws each item at `cell origin + gap/2` (symmetric gap model),
  // so the free-rect origin is pulled in by gap/2 to compensate — otherwise the
  // first item at the boundary would sit at `boardOffset + gap/2` instead of
  // exactly `boardOffset`, which would disagree with manual/pinned placements
  // (validated and clamped to exactly `boardOffset`, see below and clampToDeck).
  const halfGap = gap / 2
  const ux = Math.max(0, boardOffset - halfGap)
  const uy = Math.max(0, boardOffset - halfGap)
  const uw = Math.max(0, safeDeckWidth - boardOffset * 2 + gap)
  const ul = Math.max(0, safeDeckLength - boardOffset * 2 + gap)

  const freeRects: FreeRect[] = [{ x: ux, y: uy, width: uw, height: ul }]

  // Account for units already placed in pinned stacks: reduce the quantity to pack.
  // IMPORTANT: only subtract for ACCEPTED pins (validated below), otherwise rejected
  // pins silently consume units that then vanish from both placed and unplaced.
  const remainingByItem = new Map<string, number>()
  for (const it of items) remainingByItem.set(it.id, it.quantity)

  // Reserve space for pinned stacks first: subtract their cells from free space.
  // Validate each pin: reject if it lies outside the usable area or overlaps
  // an already-accepted pin (these become unplaced instead of silently counted).
  let index = 0
  const acceptedPins: PinnedPlacement[] = []
  for (const pin of pinned) {
    const layers = toLayers(pin.layers, 1)
    const inside =
      pin.x >= boardOffset - 1e-6 &&
      pin.y >= boardOffset - 1e-6 &&
      pin.x + pin.width <= safeDeckWidth - boardOffset + 1e-6 &&
      pin.y + pin.length <= safeDeckLength - boardOffset + 1e-6
    if (!inside) {
      result.unplaced.push({
        itemId: pin.itemId,
        name: pin.name,
        width: pin.width,
        length: pin.length,
        reason: 'Закреплённая позиция вне палубы',
      })
      continue
    }
    const overlapsAccepted = acceptedPins.some((ap) =>
      collidesWith(
        { x: pin.x, y: pin.y, width: pin.width, length: pin.length },
        [{ x: ap.x, y: ap.y, width: ap.width, length: ap.length }],
        gap
      )
    )
    if (overlapsAccepted) {
      result.unplaced.push({
        itemId: pin.itemId,
        name: pin.name,
        width: pin.width,
        length: pin.length,
        reason: 'Закреплённая позиция пересекается с другим грузом',
      })
      continue
    }
    const pinCategory = categoryByItemId.get(pin.itemId)
    const violatesSep = violatesSeparation(
      { x: pin.x, y: pin.y, width: pin.width, length: pin.length, category: pinCategory },
      acceptedPins.map((ap) => ({
        x: ap.x,
        y: ap.y,
        width: ap.width,
        length: ap.length,
        category: categoryByItemId.get(ap.itemId),
      })),
      separationRules
    )
    if (violatesSep) {
      result.unplaced.push({
        itemId: pin.itemId,
        name: pin.name,
        width: pin.width,
        length: pin.length,
        reason: 'Закреплённая позиция нарушает сепарацию груза',
      })
      continue
    }
    acceptedPins.push(pin)
    // Subtract accepted pin layers from remaining quantity (only for accepted pins)
    const r = remainingByItem.get(pin.itemId) ?? 0
    remainingByItem.set(pin.itemId, Math.max(0, r - layers))
    // Symmetric gap: reserve cell (pin.x - gap/2, pin.y - gap/2, w+gap, l+gap)
    placeRect(
      {
        x: pin.x - gap / 2,
        y: pin.y - gap / 2,
        width: pin.width + gap,
        height: pin.length + gap,
      },
      freeRects
    )
    result.placed.push({
      itemId: pin.itemId,
      name: pin.name,
      x: pin.x,
      y: pin.y,
      width: pin.width,
      length: pin.length,
      height: heightByItemId.get(pin.itemId) ?? 0,
      layers,
      stackedCount: layers,
      rotated: pin.rotated,
      color: pin.color,
      weight: pin.weight,
      index: index++,
      shape: shapeByItemId.get(pin.itemId),
    })
    result.usedArea += pin.width * pin.length
    result.placedCount += layers
    if (pin.weight) result.totalWeight += pin.weight * layers
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
      case 'length-desc':
        return b.item.length - a.item.length
      case 'quantity-desc': {
        const ra = remainingByItem.get(a.item.id) ?? a.item.quantity
        const rb = remainingByItem.get(b.item.id) ?? b.item.quantity
        return rb - ra
      }
      default:
        return 0
    }
  }
  stacks.sort(stackCmp)

  let stackIdx = 0

  // Track per-item unplaced reasons so we can report multiple causes (e.g. some units
  // are oversized while others run out of space) instead of hiding them behind dedup.
  const unplacedStats = new Map<
    string,
    {
      id: string
      name: string
      width: number
      length: number
      oversized: number
      noSpace: number
      leftover: number
      separation: number
    }
  >()

  for (const { item, unitsInStack } of stacks) {
    if (perItemRemaining.get(item.id)! <= 0) continue

    // Symmetric gap model: each item is surrounded by gap/2 on every side, so the
    // distance between any two neighbouring items is exactly `gap` regardless of
    // which side they touch. The reserved cell is (w+gap) x (l+gap); the item is
    // drawn at cell origin + gap/2.
    const cellW = item.width + gap
    const cellL = item.length + gap
    const cellWRot = item.length + gap
    const cellLRot = item.width + gap

    const fitsNormal = cellW <= uw && cellL <= ul
    const fitsRotated =
      item.allowRotation && cellWRot <= uw && cellLRot <= ul
    if (!fitsNormal && !fitsRotated) {
      const r = perItemRemaining.get(item.id)!
      const stat = unplacedStats.get(item.id) ?? {
        id: item.id,
        name: item.name,
        width: item.width,
        length: item.length,
        oversized: 0,
        noSpace: 0,
        leftover: 0,
        separation: 0,
      }
      stat.oversized += r
      unplacedStats.set(item.id, stat)
      perItemRemaining.set(item.id, 0)
      continue
    }

    const pos = findPosition(freeRects, cellW, cellL, item.allowRotation)
    if (!pos) {
      const r = perItemRemaining.get(item.id)!
      const stat = unplacedStats.get(item.id) ?? {
        id: item.id,
        name: item.name,
        width: item.width,
        length: item.length,
        oversized: 0,
        noSpace: 0,
        leftover: 0,
        separation: 0,
      }
      stat.noSpace += r
      unplacedStats.set(item.id, stat)
      perItemRemaining.set(item.id, 0)
      continue
    }

    const visW = pos.rotated ? item.length : item.width
    const visL = pos.rotated ? item.width : item.length
    // Item position = cell origin + gap/2 (so the gap/2 buffer stays around it)
    const itemX = pos.node.x + gap / 2
    const itemY = pos.node.y + gap / 2

    // Separation is a hard constraint (unlike load density, which is only a
    // soft warning computed at render time): reject this stack's placement
    // rather than let it violate a configured category separation rule. This
    // does not retry an alternate free rectangle for this stack — a v1
    // simplification matching how "no space" also doesn't retry.
    if (
      violatesSeparation(
        { x: itemX, y: itemY, width: visW, length: visL, category: item.category },
        result.placed.map((p) => ({
          x: p.x,
          y: p.y,
          width: p.width,
          length: p.length,
          category: categoryByItemId.get(p.itemId),
        })),
        separationRules
      )
    ) {
      const stat = unplacedStats.get(item.id) ?? {
        id: item.id,
        name: item.name,
        width: item.width,
        length: item.length,
        oversized: 0,
        noSpace: 0,
        leftover: 0,
        separation: 0,
      }
      stat.separation += unitsInStack
      unplacedStats.set(item.id, stat)
      perItemRemaining.set(item.id, perItemRemaining.get(item.id)! - unitsInStack)
      continue
    }

    placeRect(pos.node, freeRects)
    const stackHeight = item.height > 0 ? item.height * unitsInStack : 0
    result.placed.push({
      itemId: item.id,
      name: item.name,
      x: itemX,
      y: itemY,
      width: visW,
      length: visL,
      height: item.height,
      layers: unitsInStack,
      stackedCount: unitsInStack,
      rotated: pos.rotated,
      color: item.color,
      weight: item.weight,
      index: stackIdx++,
      shape: item.shape,
    })
    result.usedArea += visW * visL
    result.placedCount += unitsInStack
    if (item.weight) result.totalWeight += item.weight * unitsInStack
    if (stackHeight > result.maxStackHeight) result.maxStackHeight = stackHeight
    perItemRemaining.set(item.id, perItemRemaining.get(item.id)! - unitsInStack)
  }

  // Any remaining unplaced units (e.g. loop ended before stacks were exhausted)
  for (const item of items) {
    const remaining = perItemRemaining.get(item.id) ?? 0
    if (remaining > 0) {
      const stat = unplacedStats.get(item.id) ?? {
        id: item.id,
        name: item.name,
        width: item.width,
        length: item.length,
        oversized: 0,
        noSpace: 0,
        leftover: 0,
        separation: 0,
      }
      stat.leftover += remaining
      unplacedStats.set(item.id, stat)
    }
  }

  // Build unified unplaced list with all reasons per item
  for (const stat of unplacedStats.values()) {
    const reasons: string[] = []
    if (stat.oversized > 0) reasons.push(`Превышает размеры палубы (${stat.oversized} ед.)`)
    if (stat.noSpace > 0) reasons.push(`Недостаточно свободного места (${stat.noSpace} ед.)`)
    if (stat.separation > 0) reasons.push(`Нарушает сепарацию груза (${stat.separation} ед.)`)
    if (stat.leftover > 0) reasons.push(`Не вместилось (${stat.leftover} ед.)`)
    result.unplaced.push({
      itemId: stat.id,
      name: stat.name,
      width: stat.width,
      length: stat.length,
      reason: reasons.length > 0 ? reasons.join('; ') : 'Не вместилось',
    })
  }

  // Build per-item breakdown
  for (const item of items) {
    const placedForItem = result.placed.filter((p) => p.itemId === item.id)
    const placedUnits = placedForItem.reduce((s, p) => s + p.stackedCount, 0)
    const footprints = placedForItem.length
    const layers = maxLayersFor(item, clearance)
    const area = placedForItem.reduce((s, p) => s + p.width * p.length, 0)
    const unitWeight = item.weight ?? 0
    // Sum each placement's actual weight (not always item.weight): a pinned
    // stack's weight can be overridden independently of its source item, and
    // this must stay consistent with result.totalWeight, which already sums
    // real per-placement weight.
    const weight = placedForItem.reduce(
      (s, p) => s + (p.weight ?? unitWeight) * p.stackedCount,
      0
    )
    result.breakdown.push({
      itemId: item.id,
      name: item.name,
      color: item.color,
      requested: item.quantity,
      placed: placedUnits,
      footprints,
      layers,
      area,
      weight,
      unitWeight,
    })
  }

  result.freeArea = Math.max(0, totalArea - result.usedArea)
  result.utilization = totalArea > 0 ? Math.min(1, result.usedArea / totalArea) : 0
  return result
}

// ---- Variant generation for "Автораспределение" ----

// Mulberry32 — small deterministic PRNG so variants are reproducible from a seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Seeded shuffle (Fisher–Yates) — used to break ties within equal-priority groups.
function seededShuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Signature for deduplication of variants.
function variantSignature(result: PackingResult): string {
  return result.placed
    .map((p) => `${p.itemId}:${p.x.toFixed(4)}:${p.y.toFixed(4)}:${p.width.toFixed(4)}:${p.length.toFixed(4)}:${p.rotated ? 1 : 0}`)
    .sort()
    .join('|')
}

export interface PackVariant {
  result: PackingResult
  label: string
  utilizationPct: number
  placedCount: number
  unplacedCount: number
  /** Internal fine-grained sort key. Do not rely on this in UI. */
  _utilization?: number
}

// Generate up to `count` distinct packing variants. Uses several strategies:
//  1. Different sort strategies (area-desc, width-desc, length-desc)
//  2. Seeded shuffle of equal-priority items to break ties differently
export function packDeckVariants(
  deckWidth: number,
  deckLength: number,
  items: CargoItem[],
  options: PackOptions,
  count = 3,
  seed?: number
): PackVariant[] {
  const baseSeed = seed ?? Date.now()
  const strategies: SortStrategy[] = ['area-desc', 'width-desc', 'length-desc', 'area-asc']
  const variants: PackVariant[] = []
  const seen = new Set<string>()

  // For each strategy, run a few seeded tie-breaks.
  let variantIdx = 0
  for (let s = 0; s < strategies.length && variants.length < count; s++) {
    const strategy = strategies[s]
    for (let t = 0; t < 2 && variants.length < count; t++) {
      const rng = mulberry32(baseSeed + variantIdx * 1013)
      // Shuffle items with a tiny perturbation so equal-priority ones change order
      const shuffled = seededShuffle(items, rng)
      const res = packDeck(deckWidth, deckLength, shuffled, {
        ...options,
        sortStrategy: strategy,
      })
      const sig = variantSignature(res)
      if (seen.has(sig)) {
        variantIdx++
        continue
      }
      seen.add(sig)
      const label =
        s === 0
          ? `Вариант ${variants.length + 1} — по площади`
          : s === 1
            ? `Вариант ${variants.length + 1} — по ширине`
            : s === 2
              ? `Вариант ${variants.length + 1} — по длине`
              : `Вариант ${variants.length + 1} — мелкие сначала`
      variants.push({
        result: res,
        label,
        utilizationPct: Math.round(res.utilization * 100),
        placedCount: res.placedCount,
        unplacedCount: res.unplaced.length,
        _utilization: res.utilization, // fine-grained sort key (not exposed)
      })
      variantIdx++
    }
  }

  // Sort by raw utilization desc (best first). `utilizationPct` is rounded for display
  // only; using the raw value avoids arbitrary ordering within the same integer bucket.
  variants.sort((a, b) => (b._utilization ?? b.utilizationPct) - (a._utilization ?? a.utilizationPct))
  return variants.slice(0, count)
}

// Repeatedly packs a deck, feeding each trip's leftover (`result.unplaced`)
// back in as the next trip's cargo, so an order that doesn't fit in one
// voyage automatically splits across several voyages of the same deck.
// Stops when nothing is left unplaced, `maxTrips` is reached, or a trip
// makes no progress at all (e.g. an item is oversized for this deck and
// would otherwise loop forever re-appearing as "unplaced" every trip).
export function packMultiTrip(
  deckWidth: number,
  deckLength: number,
  items: CargoItem[],
  options: PackOptions | SortStrategy = 'area-desc',
  maxTrips = 10,
  // Per-trip pinned placements (trip index -> pins for that trip). Each trip
  // is a separate deck instance, so a pin only makes sense on the trip it was
  // created on. `options.pinned` (applied to every trip) is only used when
  // `pinnedByTrip` itself is omitted entirely, matching the previous
  // behaviour for callers that don't need per-trip pins — once `pinnedByTrip`
  // IS provided, a trip missing from it means "no pins for this trip" ([]),
  // never a silent fallback to `options.pinned` (which would leak pins meant
  // for one trip onto every other trip).
  pinnedByTrip?: Record<number, PinnedPlacement[]>
): PackingResult[] {
  const trips: PackingResult[] = []
  let remaining = items
  const baseOptions = typeof options === 'string' ? { sortStrategy: options } : options
  for (let trip = 0; trip < maxTrips; trip++) {
    if (remaining.length === 0) break
    const pinned = pinnedByTrip ? (pinnedByTrip[trip] ?? []) : (baseOptions.pinned ?? [])
    const result = packDeck(deckWidth, deckLength, remaining, { ...baseOptions, pinned })
    trips.push(result)
    if (result.unplaced.length === 0) break
    if (result.placedCount === 0) break // no progress — avoid an infinite loop
    // Carry the unplaced remainder into the next trip as fresh CargoItems,
    // preserving each source item's dimensions/category/etc via a lookup,
    // and using the unplaced count as the next trip's quantity.
    const byId = new Map(remaining.map((it) => [it.id, it]))
    remaining = result.unplaced
      .map((u) => {
        const src = byId.get(u.itemId)
        if (!src) return null
        const placedForItem = result.placed
          .filter((p) => p.itemId === u.itemId)
          .reduce((s, p) => s + p.stackedCount, 0)
        const stillNeeded = src.quantity - placedForItem
        if (stillNeeded <= 0) return null
        return { ...src, quantity: stillNeeded }
      })
      .filter((it): it is CargoItem => it !== null)
  }
  // No cargo at all (e.g. every item removed/zeroed) — still return one
  // empty trip so callers can always safely index trips[0].
  if (trips.length === 0) {
    trips.push(packDeck(deckWidth, deckLength, [], baseOptions))
  }
  return trips
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
  const dw = toFinite(deckWidth, 0)
  const dl = toFinite(deckLength, 0)
  const off = toFinite(boardOffset, 0)
  const g = toFinite(gap, 0)
  // Same gap/2 compensation as packDeck, so the free-space overlay matches the
  // actual edge clearance (exactly `boardOffset`) rather than `boardOffset + gap/2`.
  const halfGap = g / 2
  const ux = Math.max(0, off - halfGap)
  const uy = Math.max(0, off - halfGap)
  const uw = Math.max(0, dw - off * 2 + g)
  const ul = Math.max(0, dl - off * 2 + g)
  const free: FreeRect[] = [{ x: ux, y: uy, width: uw, height: ul }]
  for (const p of placed) {
    // Symmetric gap model: cell = (x - gap/2, y - gap/2, w+gap, l+gap)
    const pw = toFinite(p.width, 0)
    const pl = toFinite(p.length, 0)
    if (pw <= 0 || pl <= 0) continue
    placeRect(
      {
        x: p.x - g / 2,
        y: p.y - g / 2,
        width: pw + g,
        height: pl + g,
      },
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
  layers: number // how many tiers stacked on this footprint
  rotated: boolean
  color: string
  weight?: number
}

// Snap-to-grid step for dragging/nudging placements, scaled to the deck's
// own size so a tiny deck doesn't get a coarse 10m step and a huge deck
// doesn't get an imperceptible 0.5m one. Shared by 2D drag-snapping and the
// 3D keyboard nudge, so both move cargo by the same increment.
export function computeGridStep(deckWidth: number, deckLength: number): number {
  const dim = Math.max(deckWidth, deckLength)
  if (dim <= 6) return 0.5
  if (dim <= 20) return 1
  if (dim <= 60) return 5
  return 10
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
  // A tiny epsilon on the boundary comparisons prevents an exact flush-contact
  // position (distance == gap precisely) from being spuriously flagged as a
  // collision due to floating-point noise in the `gap / 2` arithmetic (e.g.
  // gap=0.1 is not exactly representable in binary).
  const eps = 1e-9
  return others.some((o) => {
    const b = {
      x: o.x - gap / 2,
      y: o.y - gap / 2,
      w: o.width + gap,
      h: o.length + gap,
    }
    return !(
      a.x + a.w <= b.x + eps ||
      b.x + b.w <= a.x + eps ||
      a.y + a.h <= b.y + eps ||
      b.y + b.h <= a.y + eps
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
  const dw = toFinite(deckWidth, 0)
  const dl = toFinite(deckLength, 0)
  const pad = toFinite(edgePadding, 0)
  const minX = pad
  const minY = pad
  const maxX = dw - pad - placement.width
  const maxY = dl - pad - placement.length
  return {
    x: Math.max(minX, Math.min(maxX, placement.x)),
    y: Math.max(minY, Math.min(maxY, placement.y)),
    width: placement.width,
    length: placement.length,
  }
}

// Rotate a placement 90deg around its own center, clamp inside the deck, and
// reject it (return null) if it would collide with any other placement. This
// is the single shared rotate+clamp+collision path — used by manual mode,
// pinned single-select rotate, and pinned multi-select rotate — so a margin or
// gap fix only has to be made once.
export function rotatePlacement(
  current: { x: number; y: number; width: number; length: number },
  deckWidth: number,
  deckLength: number,
  edgePadding: number,
  gap: number,
  others: { x: number; y: number; width: number; length: number }[]
): { x: number; y: number; width: number; length: number } | null {
  const newWidth = current.length
  const newLength = current.width
  const cx = current.x + current.width / 2
  const cy = current.y + current.length / 2
  const clamped = clampToDeck(
    { x: cx - newWidth / 2, y: cy - newLength / 2, width: newWidth, length: newLength },
    deckWidth,
    deckLength,
    edgePadding
  )
  if (collidesWith({ ...clamped, width: newWidth, length: newLength }, others, gap)) {
    return null
  }
  return clamped
}

// Tetris-style drag resolution: snaps the dragged rect to the grid, then tries
// to lock it flush (respecting `gap`) against nearby neighbours or the deck
// margin when the raw drag target is close enough ("magnetic" threshold).
// Falls back to a vector-slide + binary search (same as before) when nothing
// is close enough to lock onto, so free positioning in open space still works.
export function resolveSnappedDragPosition(
  targetX: number,
  targetY: number,
  width: number,
  length: number,
  currentX: number,
  currentY: number,
  others: { x: number; y: number; width: number; length: number }[],
  deckWidth: number,
  deckLength: number,
  edgePadding: number,
  gap: number,
  gridStep: number,
  // How far (in deck units) a lock candidate may be from the raw target and
  // still "win" the magnetic phase. Interactive dragging wants this tight, so
  // the item doesn't teleport to a distant valid spot; non-interactive
  // reflows (e.g. re-validating placements after a margin change) should pass
  // Infinity, since there is no drag vector to stay close to — the nearest
  // collision-free spot is always the right answer.
  maxMagnetDistance = Math.max(gridStep, gap + 0.05, 0.3)
): { x: number; y: number } {
  const tryPos = (x: number, y: number): { x: number; y: number } | null => {
    const clamped = clampToDeck({ x, y, width, length }, deckWidth, deckLength, edgePadding)
    if (!collidesWith({ ...clamped, width, length }, others, gap)) {
      return { x: clamped.x, y: clamped.y }
    }
    return null
  }

  const snap = (v: number) => (gridStep > 0 ? Math.round(v / gridStep) * gridStep : v)
  const snappedX = snap(targetX)
  const snappedY = snap(targetY)

  const minX = edgePadding
  const minY = edgePadding
  const maxX = deckWidth - edgePadding - width
  const maxY = deckLength - edgePadding - length

  // Only the fully-open-space candidate snaps to the grid — that's what gives
  // the tetris-like grid lock when nothing is nearby. Edge/neighbour "flush"
  // candidates below use the raw (unsnapped) cursor position: gridStep is
  // typically much coarser than gap (e.g. a 1m grid vs a 0.1m gap), so
  // rounding to it here would either miss a legitimate gap-adjacent spot
  // entirely or land the free axis several grid-steps away from the cursor.
  const candidates: { x: number; y: number }[] = [
    { x: snappedX, y: snappedY },
    { x: minX, y: targetY },
    { x: maxX, y: targetY },
    { x: targetX, y: minY },
    { x: targetX, y: maxY },
  ]

  for (const o of others) {
    // Only snap horizontally to a neighbour if the rects would actually be
    // vertically adjacent (span overlap) — otherwise you'd get a nonsensical
    // snap to a neighbour clear across the deck. Uses the raw target so a
    // small item dragged near a large neighbour is correctly detected as
    // adjacent even when the grid-rounded position would fall outside the
    // neighbour's span.
    const vOverlap = targetY < o.y + o.length && targetY + length > o.y
    if (vOverlap) {
      candidates.push({ x: o.x - gap - width, y: targetY })
      candidates.push({ x: o.x + o.width + gap, y: targetY })
    }
    const hOverlap = targetX < o.x + o.width && targetX + width > o.x
    if (hOverlap) {
      candidates.push({ x: targetX, y: o.y - gap - length })
      candidates.push({ x: targetX, y: o.y + o.length + gap })
    }
  }

  let best: { x: number; y: number } | null = null
  let bestDist = Infinity
  for (const c of candidates) {
    const res = tryPos(c.x, c.y)
    if (!res) continue
    const dist = Math.hypot(res.x - targetX, res.y - targetY)
    if (dist <= maxMagnetDistance && dist < bestDist) {
      best = res
      bestDist = dist
    }
  }
  if (best) return best

  // Fallback: vector-slide (full delta -> X-only -> Y-only) then binary search
  // along the movement vector, same behaviour as before snapping existed.
  const fallbackCandidates: { x: number; y: number }[] = [
    { x: snappedX, y: snappedY },
    { x: snappedX, y: currentY },
    { x: currentX, y: snappedY },
  ]
  for (const c of fallbackCandidates) {
    const res = tryPos(c.x, c.y)
    if (res) return res
  }

  let lo = 0
  let hi = 1
  let bestSlide: { x: number; y: number } | null = null
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2
    const x = currentX + (snappedX - currentX) * mid
    const y = currentY + (snappedY - currentY) * mid
    const res = tryPos(x, y)
    if (res) {
      bestSlide = res
      lo = mid
    } else {
      hi = mid
    }
  }
  if (bestSlide) return bestSlide
  // Last resort: never return a position outside the usable margin, even if
  // it still collides — clampToDeck guarantees at least that much validity.
  const clampedCurrent = clampToDeck({ x: currentX, y: currentY, width, length }, deckWidth, deckLength, edgePadding)
  return { x: clampedCurrent.x, y: clampedCurrent.y }
}

export function packingResultFromManual(
  deckWidth: number,
  deckLength: number,
  placements: ManualPlacement[],
  totalRequested: number,
  items?: CargoItem[],
  clearance?: number
): PackingResult {
  const dw = toFinite(deckWidth, 0)
  const dl = toFinite(deckLength, 0)
  const totalArea = dw * dl
  const totalRequestedSafe = toPositiveInt(totalRequested, 0)
  const layersFor = (p: ManualPlacement) => toLayers(p.layers, 1)
  const usedArea = placements.reduce((s, p) => s + toFinite(p.width, 0) * toFinite(p.length, 0), 0)
  const totalWeight = placements.reduce(
    (s, p) => s + toFinite(p.weight ?? 0, 0) * layersFor(p),
    0
  )
  const placedCount = placements.reduce((s, p) => s + layersFor(p), 0)

  // Build per-item map for requested quantity and max layers — also feeds
  // each placement's own height below (manual placements don't carry their
  // own height, only the source item does; without this every manual
  // placement reports height 0, which is invisible/flat in any 3D view even
  // though the 2D top-down view never needed it).
  const itemMap = new Map<string, { quantity: number; height: number; shape?: 'box' | 'cylinder' }>()
  if (items) {
    for (const it of items) {
      itemMap.set(it.id, { quantity: it.quantity, height: it.height ?? 0, shape: it.shape })
    }
  }

  const placed = placements.map((p, i) => ({
    itemId: p.itemId,
    name: p.name,
    x: p.x,
    y: p.y,
    width: p.width,
    length: p.length,
    height: itemMap.get(p.itemId)?.height ?? 0,
    layers: layersFor(p),
    stackedCount: layersFor(p),
    rotated: p.rotated,
    color: p.color,
    weight: p.weight,
    index: i,
    shape: itemMap.get(p.itemId)?.shape,
  }))

  // Breakdown by itemId
  const map = new Map<string, ItemBreakdown>()
  let maxStackHeight = 0
  for (const p of placed) {
    const itemInfo = itemMap.get(p.itemId)
    const itemHeight = itemInfo?.height ?? 0
    const stackHeight = itemHeight * p.stackedCount
    if (stackHeight > maxStackHeight) maxStackHeight = stackHeight
    const b = map.get(p.itemId) ?? {
      itemId: p.itemId,
      name: p.name,
      color: p.color,
      requested: itemInfo?.quantity ?? 0,
      placed: 0,
      footprints: 0,
      layers: itemInfo ? maxLayersFor({ height: itemInfo.height }, clearance ?? 0) : 1,
      area: 0,
      weight: 0,
      unitWeight: p.weight ?? 0,
    }
    b.placed += p.stackedCount
    b.footprints += 1
    b.area += p.width * p.length
    b.weight += (p.weight ?? 0) * p.stackedCount
    map.set(p.itemId, b)
  }

  return {
    placed,
    unplaced: [],
    breakdown: [...map.values()],
    requestedCount: totalRequestedSafe,
    placedCount,
    totalArea,
    usedArea,
    freeArea: Math.max(0, totalArea - usedArea),
    utilization: totalArea > 0 ? Math.min(1, usedArea / totalArea) : 0,
    totalWeight,
    maxStackHeight,
    deckWidth: dw,
    deckLength: dl,
  }
}
