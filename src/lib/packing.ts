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

// 2D/3D render hint (DeckVisualization, Deck3DView) — defaults to 'box'.
// Footprint/packing math is unaffected by any of these: every shape still
// packs, collides and clamps by its rectangular bounding box, exactly like a
// box. Only what gets *drawn* inside that bounding box differs — EXCEPT
// 'custom' (see `outline` below), whose precise silhouette also feeds
// collidesPrecisely() for direct manual placement/drag/rotate, while the
// auto-packer still only ever reserves its bounding box, same as every
// other shape.
export type CargoShape = 'box' | 'cylinder' | 'circle' | 'oval' | 'triangle' | 'diamond' | 'custom'

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
  shape?: CargoShape
  // Hand-drawn silhouette for shape: 'custom' — vertices in the item's own
  // local, UNROTATED frame, same units as width/length, spanning exactly
  // [0,width] x [0,length]. width/length remain the authoritative bounding
  // box every packing/collision function already trusts; this is purely
  // additive precision data. Rotated on the fly via rotateOutline90() —
  // never stored pre-rotated, so there's only ever one source of truth.
  outline?: { x: number; y: number }[]
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

export interface ZoneLoadCheck {
  zoneId: string
  totalWeightKg: number
  areaM2: number
  densityTPerM2: number
  limitTPerM2: number
}

function overlapsZone(f: { x: number; y: number; width: number; length: number }, z: LoadZone): boolean {
  return f.x < z.x + z.width && f.x + f.width > z.x && f.y < z.y + z.length && f.y + f.length > z.y
}

// Sutherland-Hodgman: clips `poly` (subject, may be concave — the deck
// outline) against the 4 half-planes of an axis-aligned rectangle (clip
// window, always convex — a load zone). Concave-subject/convex-clip is
// exactly what this algorithm supports, so a cut-corner deck outline works
// with no extra handling.
function clipPolygonToRect(
  poly: { x: number; y: number }[],
  rect: { x: number; y: number; width: number; length: number }
): { x: number; y: number }[] {
  const x0 = rect.x
  const x1 = rect.x + rect.width
  const y0 = rect.y
  const y1 = rect.y + rect.length
  const edges: {
    inside: (p: { x: number; y: number }) => boolean
    intersect: (a: { x: number; y: number }, b: { x: number; y: number }) => { x: number; y: number }
  }[] = [
    { inside: (p) => p.x >= x0, intersect: (a, b) => ({ x: x0, y: a.y + ((b.y - a.y) * (x0 - a.x)) / (b.x - a.x) }) },
    { inside: (p) => p.x <= x1, intersect: (a, b) => ({ x: x1, y: a.y + ((b.y - a.y) * (x1 - a.x)) / (b.x - a.x) }) },
    { inside: (p) => p.y >= y0, intersect: (a, b) => ({ y: y0, x: a.x + ((b.x - a.x) * (y0 - a.y)) / (b.y - a.y) }) },
    { inside: (p) => p.y <= y1, intersect: (a, b) => ({ y: y1, x: a.x + ((b.x - a.x) * (y1 - a.y)) / (b.y - a.y) }) },
  ]
  let output = poly
  for (const edge of edges) {
    const input = output
    output = []
    if (input.length === 0) break
    for (let i = 0; i < input.length; i++) {
      const curr = input[i]
      const prev = input[(i - 1 + input.length) % input.length]
      const currIn = edge.inside(curr)
      const prevIn = edge.inside(prev)
      if (currIn) {
        if (!prevIn) output.push(edge.intersect(prev, curr))
        output.push(curr)
      } else if (prevIn) {
        output.push(edge.intersect(prev, curr))
      }
    }
  }
  return output
}

// A zone's real usable area for load-density purposes: the part of its
// rectangle that actually lies within the deck's real outline, not the
// bare width*length. Without this, a zone straddling a cut corner would
// have its density diluted by "area" that isn't real deck at all —
// understating the true load on the real portion, which is the wrong
// direction for a structural safety check. No outline (rectangular deck,
// the default) -> unchanged bare rectangle area.
export function zoneAreaWithinOutline(
  zone: { x: number; y: number; width: number; length: number },
  outline: { x: number; y: number }[] | undefined
): number {
  const rectArea = zone.width * zone.length
  if (!outline || outline.length < 3) return rectArea
  const clipped = clipPolygonToRect(outline, zone)
  if (clipped.length < 3) return 0
  return Math.min(rectArea, polygonArea(clipped))
}

// Aggregates the full weight of every placement that overlaps a zone at all
// (no proration by overlap area — a conservative, physically-safe
// approximation: a box straddling a zone edge counts fully toward it) and
// divides by the ZONE's REAL area (clipped to the deck outline when one is
// set — see zoneAreaWithinOutline). This is what a load zone's t/m² limit
// actually means (structural capacity of that patch of deck) — not any
// single item's own footprint density, and not the zone's bare rectangle
// if part of it overhangs a cut corner. A placement overlapping two zones
// contributes its full weight to both independently. Returns only zones
// that exceed their limit.
export function checkZoneLoads(
  placements: { x: number; y: number; width: number; length: number; totalWeightKg: number }[],
  zones: LoadZone[] | undefined,
  deckOutline?: { x: number; y: number }[]
): ZoneLoadCheck[] {
  if (!zones || zones.length === 0) return []
  const results: ZoneLoadCheck[] = []
  const eps = 1e-9
  for (const z of zones) {
    const areaM2 = zoneAreaWithinOutline(z, deckOutline)
    if (areaM2 <= 0) continue
    let totalWeightKg = 0
    for (const p of placements) {
      if (overlapsZone(p, z)) totalWeightKg += p.totalWeightKg
    }
    const densityTPerM2 = totalWeightKg / 1000 / areaM2
    if (densityTPerM2 > z.maxLoadPerArea + eps) {
      results.push({ zoneId: z.id, totalWeightKg, areaM2, densityTPerM2, limitTPerM2: z.maxLoadPerArea })
    }
  }
  return results
}

// Every zone id a single footprint overlaps — used to look up whether an
// individual placed item sits inside a zone that checkZoneLoads flagged.
export function zoneIdsOverlapping(
  footprint: { x: number; y: number; width: number; length: number },
  zones: LoadZone[] | undefined
): string[] {
  if (!zones || zones.length === 0) return []
  return zones.filter((z) => overlapsZone(footprint, z)).map((z) => z.id)
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

// A purely visual marker showing where a deck electrical outlet is (so the
// user can see where a reefer container could be plugged in). Deliberately
// carries no collision/exclusion behavior — never affects placement.
export interface PowerSocket {
  id: string
  x: number
  y: number
  label?: string
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
// checkZoneLoads: pure function, returns a descriptive struct, never
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
  shape?: CargoShape
  outline?: { x: number; y: number }[] // see CargoItem.outline — same local/unrotated convention
  clearanceMargin?: ClearanceMargin // see PinnedPlacement.clearanceMargin — only pinned/manual placements ever carry one
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


// Decomposes "inside the [0,width]×[0,length] bounding box but OUTSIDE the
// deck outline polygon" into a set of axis-aligned rectangles, so the
// existing rectangle-only free-space machinery (placeRect, already used to
// reserve pinned-stack cells) can treat a non-rectangular deck exactly like
// a bunch of pre-occupied cells — the bin-packer itself never learns about
// polygons at all.
//
// Vertical scanline decomposition: slice the bounding box into vertical
// strips at each distinct outline-vertex X (deduped within EPS), then for
// each strip cast a ray at its horizontal midpoint against every polygon
// edge, collect the Y crossings, sort them, and pair them up even/odd
// (standard scanline-fill rule) to get the polygon's inside-Y span(s) in
// that strip. Everything above the first span and below the last (plus any
// gaps between multiple spans, for a shape that's concave top-to-bottom) is
// excluded. Correct for any simple polygon, convex or concave — O(n²)
// worst case (n = vertex count), trivial for hand-drawn outlines.
const SCANLINE_EPS = 1e-6
export function deckOutlineExclusionRects(
  outline: { x: number; y: number }[],
  width: number,
  length: number
): Rect[] {
  if (outline.length < 3) return []
  const xs = Array.from(new Set(outline.map((p) => p.x))).sort((a, b) => a - b)
  const dedupedXs: number[] = []
  for (const x of xs) {
    if (dedupedXs.length === 0 || x - dedupedXs[dedupedXs.length - 1] > SCANLINE_EPS) dedupedXs.push(x)
  }
  // Clip the strip range to the bounding box — a hand-drawn outline is
  // already meant to stay within it, but this keeps the result well-formed
  // even if a point sits exactly on/past the edge due to float drift.
  const clampedXs = [0, ...dedupedXs.filter((x) => x > 0 && x < width), width]

  // A strip between two adjacent vertex X's is sampled at ONE midpoint — for
  // a near-vertical edge that's a fine approximation, but a wide strip with
  // a shallow-sloped edge (e.g. a hand-drawn diagonal spanning many meters)
  // gets badly misrepresented as a single flat-topped rect, potentially
  // excluding real deck area at one end of the strip while leaving too much
  // at the other. Subdivide each strip into narrower sub-strips so the
  // staircase actually hugs the real edge; capped so a huge/degenerate
  // outline can't blow this up.
  const maxSubWidth = Math.max(width, length, SCANLINE_EPS) / 100
  const MAX_SUBSTRIPS_PER_STRIP = 64

  const out: Rect[] = []
  for (let i = 0; i < clampedXs.length - 1; i++) {
    const stripLo = clampedXs[i]
    const stripHi = clampedXs[i + 1]
    if (stripHi - stripLo <= SCANLINE_EPS) continue
    const subCount = Math.min(
      MAX_SUBSTRIPS_PER_STRIP,
      Math.max(1, Math.ceil((stripHi - stripLo) / maxSubWidth))
    )
    const subWidth = (stripHi - stripLo) / subCount
    for (let s = 0; s < subCount; s++) {
      const xLo = stripLo + s * subWidth
      const xHi = s === subCount - 1 ? stripHi : xLo + subWidth
      const xMid = (xLo + xHi) / 2

      const ys: number[] = []
      for (let j = 0; j < outline.length; j++) {
        const p1 = outline[j]
        const p2 = outline[(j + 1) % outline.length]
        if ((p1.x <= xMid && p2.x > xMid) || (p2.x <= xMid && p1.x > xMid)) {
          const t = (xMid - p1.x) / (p2.x - p1.x)
          ys.push(p1.y + t * (p2.y - p1.y))
        }
      }
      ys.sort((a, b) => a - b)

      let prevY = 0
      for (let k = 0; k < ys.length; k += 2) {
        const yLo = ys[k]
        const yHi = ys[k + 1] ?? length
        if (yLo - prevY > SCANLINE_EPS) {
          out.push({ x: xLo, y: prevY, width: xHi - xLo, height: yLo - prevY })
        }
        prevY = yHi
      }
      if (length - prevY > SCANLINE_EPS) {
        out.push({ x: xLo, y: prevY, width: xHi - xLo, height: length - prevY })
      }
    }
  }
  return out
}

export interface PackOptions {
  sortStrategy?: SortStrategy
  gap?: number // spacing between items
  boardOffset?: number // margin from the ship's board (deck edge)
  clearance?: number // max stack height above deck (0 = single tier)
  pinned?: PinnedPlacement[] // user-pinned stacks that must keep their positions
  separationRules?: SeparationRule[] // category-pair minimum-distance rules
  outline?: { x: number; y: number }[] // non-rectangular deck silhouette, see deckOutlineExclusionRects
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
  // Hard-blocking exclusion margin (deck units, e.g. meters) around this
  // placement — an alternative to individual lashing points, not a
  // combination of both (see clearLashingPointsFor in calculator.ts).
  // Other cargo cannot be placed, dragged, or auto-packed into this margin.
  clearanceMargin?: ClearanceMargin
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
  const outline = typeof options === 'string' ? undefined : options.outline

  // Sanitize deck dimensions and spacing so NaN/Infinity can't poison the result.
  const safeDeckWidth = toFinite(deckWidth, 0)
  const safeDeckLength = toFinite(deckLength, 0)
  // The bounding-box rectangle stays authoritative for every other
  // computation below (clamping, free-rect splitting, collision) — only the
  // reported total area needs the polygon's true (smaller) size.
  const totalArea = outline && outline.length >= 3 ? polygonArea(outline) : safeDeckWidth * safeDeckLength

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
  const outlineByItemId = new Map(items.map((it) => [it.id, it.outline]))
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

  const hasOutline = !!outline && outline.length >= 3
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

  // Non-rectangular deck: board offset is an inset along the real contour
  // (erodePolygon), not the bounding box — otherwise a cut/diagonal edge
  // would get zero clearance while the deck's straight sides got the normal
  // margin.
  //
  // Two earlier versions of this fix both proved insufficient on real user
  // data: (1) seeding the outline exclusion from a permissive
  // `boardOffset - gap/2` erosion (so the flat "+gap/2" per-cell shift
  // below compensates back to exactly `boardOffset`, mirroring the
  // rectangular-deck seed rect) left a gap that scaled with an item's own
  // width along a slanted edge — fine for a 1.5m box, not for a 6.06m
  // container on the very same edge; (2) switching to a strict, full
  // `boardOffset` erosion for the exclusion rects shrank that gap but
  // didn't eliminate it, because `deckOutlineExclusionRects`'s own
  // rectangular-slab approximation of a continuously sloped edge and
  // `rectInsidePolygon`'s exact polygon-corner-containment test are two
  // DIFFERENT geometric methods that will never perfectly agree, no matter
  // how strict either one's erosion amount is.
  //
  // The actual fix: stop comparing against a second, independently-computed
  // method at all. A pin is valid here iff it does not overlap any of the
  // SAME exclusion rects the free-cell search itself is built from — the
  // literal computation that already determines what the packer considers
  // placeable. Since a pin the packer's own free-rect search would offer
  // can, by construction, never overlap those rects, this can no longer
  // disagree with the packer's own placement decisions, for cargo of any
  // size or any outline shape.
  const usableOutline = hasOutline ? erodePolygon(outline!, boardOffset) : undefined
  const outlineExclusionRects = hasOutline
    ? deckOutlineExclusionRects(usableOutline!, safeDeckWidth, safeDeckLength)
    : undefined
  const freeRects: FreeRect[] = hasOutline
    ? [{ x: 0, y: 0, width: safeDeckWidth, height: safeDeckLength }]
    : [{ x: ux, y: uy, width: uw, height: ul }]

  // Reserve the area outside a non-rectangular deck outline as pre-occupied
  // cells, BEFORE pinned stacks — exclusions are structural (part of the
  // deck's real shape), pins are dynamic reservations on top of that. The
  // bin-packer itself never learns about the polygon; it only ever sees one
  // more rectangle to route around, via the exact same placeRect mechanism
  // already used for pins below.
  if (hasOutline) {
    for (const rect of outlineExclusionRects!) {
      placeRect(rect, freeRects)
    }
  }

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
    const inside = hasOutline
      ? !outlineExclusionRects!.some((ex) => intersects({ x: pin.x, y: pin.y, width: pin.width, height: pin.length }, ex))
      : pin.x >= boardOffset - 1e-6 &&
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
    // Precise (not just bbox) so a pin dropped into another pin's custom-
    // shape notch — already accepted by the same collidesPrecisely check at
    // click-time in DeckVisualization — doesn't turn around and get flagged
    // "intersects" here, which would otherwise silently move it to
    // `unplaced` right after the UI told the user it was placed.
    const pinWithOutline = { x: pin.x, y: pin.y, width: pin.width, length: pin.length, rotated: pin.rotated, outline: outlineByItemId.get(pin.itemId) }
    const overlapsAccepted = acceptedPins.some((ap) => {
      const apWithOutline = { x: ap.x, y: ap.y, width: ap.width, length: ap.length, rotated: ap.rotated, outline: outlineByItemId.get(ap.itemId) }
      return (
        collidesPrecisely(pinWithOutline, [withClearanceFootprint(apWithOutline)], gap) ||
        collidesPrecisely(withClearanceFootprint(pinWithOutline), [apWithOutline], gap)
      )
    })
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
    // Symmetric gap: reserve cell (pin.x - gap/2, pin.y - gap/2, w+gap, l+gap).
    // A clearanceMargin (hard-blocking exclusion zone) reserves the further-
    // inflated cell instead, so the free-rect splitter never offers that
    // space to algorithmically-placed (non-pinned) cargo either.
    const cm = pin.clearanceMargin
    placeRect(
      {
        x: pin.x - gap / 2 - (cm?.left ?? 0),
        y: pin.y - gap / 2 - (cm?.top ?? 0),
        width: pin.width + gap + (cm?.left ?? 0) + (cm?.right ?? 0),
        height: pin.length + gap + (cm?.top ?? 0) + (cm?.bottom ?? 0),
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
      outline: outlineByItemId.get(pin.itemId),
      clearanceMargin: pin.clearanceMargin,
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
      outline: item.outline,
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
  boardOffset = 0,
  outline?: { x: number; y: number }[]
): Rect[] {
  const dw = toFinite(deckWidth, 0)
  const dl = toFinite(deckLength, 0)
  const off = toFinite(boardOffset, 0)
  const g = toFinite(gap, 0)
  const hasOutline = !!outline && outline.length >= 3
  // Same gap/2 compensation as packDeck, so the free-space overlay matches the
  // actual edge clearance (exactly `boardOffset`) rather than `boardOffset + gap/2`.
  const halfGap = g / 2
  const ux = Math.max(0, off - halfGap)
  const uy = Math.max(0, off - halfGap)
  const uw = Math.max(0, dw - off * 2 + g)
  const ul = Math.max(0, dl - off * 2 + g)
  // Non-rectangular deck: same contour-following board-offset inset as
  // packDeck (erodePolygon), not a bounding-box inset — and, like packDeck,
  // the FULL strict boardOffset erosion (not the gap/2-permissive one used
  // for the rectangular seed rect above) — see packDeck for why: a flat
  // "+gap/2" compensation only correctly cancels a permissive erosion along
  // an axis-aligned edge, not a slanted outline edge, so this overlay
  // stayed strict to match what's actually placeable.
  const free: FreeRect[] = hasOutline
    ? [{ x: 0, y: 0, width: dw, height: dl }]
    : [{ x: ux, y: uy, width: uw, height: ul }]
  if (hasOutline) {
    const usableOutline = erodePolygon(outline!, off)
    for (const rect of deckOutlineExclusionRects(usableOutline, dw, dl)) {
      placeRect(rect, free)
    }
  }
  for (const p of placed) {
    // Symmetric gap model: cell = (x - gap/2, y - gap/2, w+gap, l+gap) —
    // further inflated by clearanceMargin if set, matching packDeck's own
    // pin-reservation formula, so this overlay agrees with what the packer
    // actually treats as occupied instead of showing a zoned-off area as free.
    const pw = toFinite(p.width, 0)
    const pl = toFinite(p.length, 0)
    if (pw <= 0 || pl <= 0) continue
    const cm = p.clearanceMargin
    placeRect(
      {
        x: p.x - g / 2 - (cm?.left ?? 0),
        y: p.y - g / 2 - (cm?.top ?? 0),
        width: pw + g + (cm?.left ?? 0) + (cm?.right ?? 0),
        height: pl + g + (cm?.top ?? 0) + (cm?.bottom ?? 0),
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
  // See PinnedPlacement.clearanceMargin above — same meaning here.
  clearanceMargin?: ClearanceMargin
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

// Independent hard-block margin per side of a placement's footprint —
// lets the exclusion zone be wider on, say, the side a rigger needs to work
// from, rather than a single symmetric radius.
export interface ClearanceMargin {
  top: number
  right: number
  bottom: number
  left: number
}

// Inflates a placement's own footprint by its clearanceMargin (if any) —
// used when OTHER items test collision against this one, so its hard-block
// exclusion zone actually excludes them. Never applied to the placement's
// own clamp-to-deck-edge or self-collision checks — only when it appears in
// someone else's `others` array.
export function withClearanceFootprint<
  T extends { x: number; y: number; width: number; length: number; clearanceMargin?: ClearanceMargin }
>(p: T): { x: number; y: number; width: number; length: number } {
  const m = p.clearanceMargin
  if (!m) return p
  return {
    x: p.x - m.left,
    y: p.y - m.top,
    width: p.width + m.left + m.right,
    length: p.length + m.top + m.bottom,
  }
}

// A lashing point's anchor needs clear room for rigging access (tensioning,
// inspecting, releasing the device) — cargo shouldn't be placeable directly
// on top of it. The exclusion square is sized to track the deck's own gap
// setting (never smaller than a sensible minimum), so widening the general
// cargo-to-cargo spacing also pushes cargo further from lashing points, not
// just from other cargo — the same "gap" the user configures everywhere
// else, applied here too instead of a second, disconnected setting.
const LASHING_POINT_MIN_EXCLUSION = 0.15
export function lashingPointExclusionRects(
  points: { x: number; y: number }[],
  gap: number
): { x: number; y: number; width: number; length: number }[] {
  const r = Math.max(LASHING_POINT_MIN_EXCLUSION, gap)
  return points.map((p) => ({ x: p.x - r, y: p.y - r, width: r * 2, length: r * 2 }))
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

// Rotates a local outline 90° CW to match rotatePlacement's width/length
// swap: the unrotated box is [0,width]×[0,length]; the rotated box is
// [0,length]×[0,width]. `width`/`length` here are the box the INPUT points
// are defined against (i.e. the un-rotated source box), not the rotated
// result.
export function rotateOutline90(
  points: { x: number; y: number }[],
  width: number,
  length: number
): { x: number; y: number }[] {
  return points.map((p) => ({ x: length - p.y, y: p.x }))
}

// Converts a placement's local outline into a world-space polygon — rotated
// (if needed) then translated by the placement's own x/y. Placements without
// a custom outline fall back to their plain bounding-box rectangle, so this
// is safe to call unconditionally. Shared by 2D/3D render and
// collidesPrecisely so there's exactly one rotation implementation (the
// duplication that caused an earlier bug — shape being hand-copied and
// silently dropped in one of several places — is exactly what this avoids).
export function worldPolygon(p: {
  x: number
  y: number
  width: number
  length: number
  rotated?: boolean
  outline?: { x: number; y: number }[]
}): { x: number; y: number }[] {
  if (!p.outline || p.outline.length < 3) {
    return [
      { x: p.x, y: p.y },
      { x: p.x + p.width, y: p.y },
      { x: p.x + p.width, y: p.y + p.length },
      { x: p.x, y: p.y + p.length },
    ]
  }
  // p.width/p.length already reflect the ROTATED bbox (rotatePlacement
  // swaps them) — the stored outline is always in the UNROTATED frame, so
  // recover the pre-rotation box size to rotate the points correctly.
  const unrotatedWidth = p.rotated ? p.length : p.width
  const unrotatedLength = p.rotated ? p.width : p.length
  const local = p.rotated ? rotateOutline90(p.outline, unrotatedWidth, unrotatedLength) : p.outline
  return local.map((pt) => ({ x: p.x + pt.x, y: p.y + pt.y }))
}

function segmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number }
): boolean {
  const d = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = d(p3, p4, p1)
  const d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3)
  const d4 = d(p1, p2, p4)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function pointInPolygon(pt: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// True if two simple polygons (convex or concave) overlap — edge-crossing
// test plus a containment check (needed for the case where one polygon is
// entirely inside the other with no edge crossings at all). No library
// needed; three.js's own earcut handles concave triangulation separately
// for 3D extrusion.
export function polygonsOverlap(
  polyA: { x: number; y: number }[],
  polyB: { x: number; y: number }[]
): boolean {
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i]
    const a2 = polyA[(i + 1) % polyA.length]
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j]
      const b2 = polyB[(j + 1) % polyB.length]
      if (segmentsIntersect(a1, a2, b1, b2)) return true
    }
  }
  return pointInPolygon(polyA[0], polyB) || pointInPolygon(polyB[0], polyA)
}

// Standard shoelace formula — used for the deck's true area when it has a
// non-rectangular outline (replaces width*length).
export function polygonArea(poly: { x: number; y: number }[]): number {
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

// True iff `rect` is fully contained in `poly` — all 4 corners inside AND no
// rect edge crosses a polygon edge (the same "corners-in AND no-crossing"
// shape as polygonsOverlap, just testing containment instead of overlap).
// Used to gate interactive cargo placement against a non-rectangular deck
// outline — reuses pointInPolygon/segmentsIntersect directly, no new
// geometry primitives.
export function rectInsidePolygon(
  rect: { x: number; y: number; width: number; length: number },
  poly: { x: number; y: number }[]
): boolean {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.length },
    { x: rect.x, y: rect.y + rect.length },
  ]
  for (const c of corners) {
    if (!pointInPolygon(c, poly)) return false
  }
  for (let i = 0; i < corners.length; i++) {
    const a1 = corners[i]
    const a2 = corners[(i + 1) % corners.length]
    for (let j = 0; j < poly.length; j++) {
      const b1 = poly[j]
      const b2 = poly[(j + 1) % poly.length]
      if (segmentsIntersect(a1, a2, b1, b2)) return false
    }
  }
  return true
}

// Removes consecutive near-duplicate vertices — cheap insurance against a
// hand-drawn or dragged point landing right on top of (or a couple
// centimeters from) a neighbor, which would otherwise leave a near-zero-
// length edge in the outline. Most polygon math here (area, point-in-
// polygon, exclusion rects) tolerates a tiny edge fine, but erodePolygon's
// per-edge normal offset is numerically unstable around one — a stray
// duplicate vertex can send that corner's erosion wildly off and corrupt
// the whole shape (confirmed: a real drag interaction occasionally drops an
// extra point within a few cm of the one being moved). The threshold is
// relative to the polygon's own bounding-box diagonal, not a fixed
// distance, so it behaves the same regardless of the deck's display unit
// (m/cm/ft) or size.
export function dedupePolygonVertices(
  poly: { x: number; y: number }[]
): { x: number; y: number }[] {
  if (poly.length < 3) return poly
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  // 1% of the polygon's own diagonal — generous enough to catch a stray
  // vertex a drag interaction drops a few cm from its neighbor on a
  // multi-meter deck (the real case this exists for), while still being far
  // below any deliberately-drawn feature on a deck-scale outline.
  const eps = Math.max(1e-9, diag * 0.01)
  const out: { x: number; y: number }[] = []
  for (const p of poly) {
    const prev = out[out.length - 1]
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > eps) out.push(p)
  }
  if (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.hypot(last.x - first.x, last.y - first.y) <= eps) out.pop()
  }
  return out.length >= 3 ? out : poly
}

// Shrinks a simple polygon inward by `margin` along its real contour — used
// so "board offset" (margin from the ship's board) applies to a
// non-rectangular deck the same way it already applies to a rectangular one,
// instead of only insetting the bounding box and leaving zero clearance
// along a cut/diagonal edge. Each edge is shifted inward along its own
// normal (found via pointInPolygon, so it's correct regardless of winding
// direction), then each new vertex is the intersection of its two adjacent
// shifted edges (as infinite lines, not segments). Falls back to the
// original polygon if erosion would produce a degenerate result (parallel
// edges with no intersection, or a shrunken shape that didn't actually
// shrink) — better to give too little inset than a broken shape.
export function erodePolygon(
  rawPoly: { x: number; y: number }[],
  margin: number
): { x: number; y: number }[] {
  if (margin <= 0 || rawPoly.length < 3) return rawPoly
  const poly = dedupePolygonVertices(rawPoly)
  const n = poly.length
  const offsetLines: { p: { x: number; y: number }; d: { x: number; y: number } }[] = []
  for (let i = 0; i < n; i++) {
    const p1 = poly[i]
    const p2 = poly[(i + 1) % n]
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) return poly // degenerate (repeated point) — bail out
    const ux = dx / len
    const uy = dy / len
    let nx = -uy
    let ny = ux
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    const probe = { x: mid.x + nx * 1e-3, y: mid.y + ny * 1e-3 }
    if (!pointInPolygon(probe, poly)) {
      nx = -nx
      ny = -ny
    }
    offsetLines.push({ p: { x: p1.x + nx * margin, y: p1.y + ny * margin }, d: { x: ux, y: uy } })
  }
  const result: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const a = offsetLines[(i - 1 + n) % n]
    const b = offsetLines[i]
    const denom = a.d.x * b.d.y - a.d.y * b.d.x
    if (Math.abs(denom) < 1e-9) return poly // parallel adjacent edges — bail out
    const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / denom
    result.push({ x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t })
  }
  const erodedArea = polygonArea(result)
  if (erodedArea < 1e-6 || erodedArea >= polygonArea(poly)) return poly
  return result
}

// Bbox pre-check first (cheap, already what every caller does) — only
// escalates to precise polygon math when the bbox says "maybe" AND at least
// one side has real outline data. Boxes/circles/pipes/etc. (no outline)
// behave EXACTLY as collidesWith does today — zero behavior change for
// every shape except the new hand-drawn 'custom' one. `gap` is only applied
// during the bbox pre-check (a Minkowski-expanded gap around an arbitrary
// polygon isn't worth the complexity here) — a custom shape's own true
// boundary is treated as touching-is-colliding.
export function collidesPrecisely(
  a: { x: number; y: number; width: number; length: number; rotated?: boolean; outline?: { x: number; y: number }[] },
  others: { x: number; y: number; width: number; length: number; rotated?: boolean; outline?: { x: number; y: number }[] }[],
  gap = 0
): boolean {
  for (const b of others) {
    if (!collidesWith(a, [b], gap)) continue
    if (!a.outline && !b.outline) return true
    if (polygonsOverlap(worldPolygon(a), worldPolygon(b))) return true
  }
  return false
}

// Every interactive site (click-place, drag, rotate, nudge) that enforces
// a clearance zone does so by inflating the OTHER placements in `others` via
// withClearanceFootprint before testing `target` against them — which makes
// a zoned placement repel its neighbours, but never stops the zoned
// placement ITSELF from being moved right up against a neighbour that has
// no zone of its own (nothing ever inflated `target` by its own margin).
// Checks both directions — same bidirectional pattern packDeck's own
// pin-vs-pin validation already uses — so a hard-block zone excludes other
// cargo no matter which of the two placements is the one actually moving.
type ClearanceCollisionCandidate = {
  x: number
  y: number
  width: number
  length: number
  rotated?: boolean
  outline?: { x: number; y: number }[]
  clearanceMargin?: ClearanceMargin
}
export function collidesWithClearance(
  target: ClearanceCollisionCandidate,
  others: ClearanceCollisionCandidate[],
  gap = 0
): boolean {
  if (collidesPrecisely(target, others.map(withClearanceFootprint), gap)) return true
  if (target.clearanceMargin && collidesPrecisely(withClearanceFootprint(target), others, gap)) return true
  return false
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
  // clampToDeck only pulls a placement's position back inside the deck — it
  // never shrinks width/length, so a rotated footprint that's simply too
  // big for the deck in one axis (e.g. a long pipe rotated on a deck
  // shorter than it) would silently clamp to the edge and still poke out
  // the opposite side instead of being rejected. Guard for that explicitly
  // before clamping.
  if (newWidth > deckWidth - 2 * edgePadding + 1e-9 || newLength > deckLength - 2 * edgePadding + 1e-9) {
    return null
  }
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
  maxMagnetDistance = Math.max(gridStep, gap + 0.05, 0.3),
  // The dragged item's own clearance zone, if it has one. `others` above is
  // already inflated by each NEIGHBOUR's own margin (by the caller), but
  // without this, the search below has no idea the item being dragged also
  // needs its own margin kept clear — it could settle on a spot that looks
  // fine here but then fails collidesWithClearance's self-inflated check at
  // the caller's final gate, which is a silent no-op there (nothing commits
  // that frame) and reads as the drag randomly freezing. Inflating the
  // candidate here too is provably safe: raw ⊆ inflated on both sides, so a
  // doubly-inflated non-collision guarantees both of that gate's branches
  // already pass — this can only ever return a position the gate accepts.
  selfMargin?: ClearanceMargin
): { x: number; y: number } {
  const tryPos = (x: number, y: number): { x: number; y: number } | null => {
    const clamped = clampToDeck({ x, y, width, length }, deckWidth, deckLength, edgePadding)
    const testRect = selfMargin
      ? withClearanceFootprint({ x: clamped.x, y: clamped.y, width, length, clearanceMargin: selfMargin })
      : { ...clamped, width, length }
    if (!collidesWith(testRect, others, gap)) {
      return { x: clamped.x, y: clamped.y }
    }
    return null
  }

  const minX = edgePadding
  const minY = edgePadding
  const maxX = deckWidth - edgePadding - width
  const maxY = deckLength - edgePadding - length

  // A margin's magnet zone reaches maxMagnetDistance from EACH edge — fine
  // for a normal item with plenty of free-slide room, but when the item's
  // own size leaves only a small usable range on an axis (e.g. a 6m
  // container's length on an 8m deck, leaving ~1.5m of room), both edges'
  // zones can cover that entire range at once. Every drag target then falls
  // within range of at least one edge, so the item can only ever be
  // released flush against a margin — never anywhere in between, no matter
  // where the cursor is. Capping each margin candidate's own radius to at
  // most a third of that axis's free-slide room guarantees a real free
  // (cursor-tracking) zone always survives in the middle; neighbour-flush
  // candidates below are unaffected, since two placed items being nearly as
  // large as the whole deck isn't the scenario this is guarding against.
  const xRoom = Math.max(0, maxX - minX)
  const yRoom = Math.max(0, maxY - minY)
  const marginMagnetX = Math.min(maxMagnetDistance, xRoom / 3)
  const marginMagnetY = Math.min(maxMagnetDistance, yRoom / 3)

  // Lock candidates: flush against the deck margin or a neighbour. These
  // compete only against each other for "closest to the cursor, within
  // maxDist" — the raw cursor position itself is deliberately NOT one of
  // these candidates (see below), since it would trivially win every time
  // (distance 0) and the neighbour/edge magnet would never fire.
  const lockCandidates: { x: number; y: number; maxDist: number }[] = [
    { x: minX, y: targetY, maxDist: marginMagnetX },
    { x: maxX, y: targetY, maxDist: marginMagnetX },
    { x: targetX, y: minY, maxDist: marginMagnetY },
    { x: targetX, y: maxY, maxDist: marginMagnetY },
  ]

  for (const o of others) {
    // Only snap horizontally to a neighbour if the rects would actually be
    // vertically adjacent (span overlap) — otherwise you'd get a nonsensical
    // snap to a neighbour clear across the deck. Uses the raw target so a
    // small item dragged near a large neighbour is correctly detected as
    // adjacent even when a grid-rounded position would have fallen outside
    // the neighbour's span.
    const vOverlap = targetY < o.y + o.length && targetY + length > o.y
    if (vOverlap) {
      lockCandidates.push({ x: o.x - gap - width, y: targetY, maxDist: maxMagnetDistance })
      lockCandidates.push({ x: o.x + o.width + gap, y: targetY, maxDist: maxMagnetDistance })
    }
    const hOverlap = targetX < o.x + o.width && targetX + width > o.x
    if (hOverlap) {
      lockCandidates.push({ x: targetX, y: o.y - gap - length, maxDist: maxMagnetDistance })
      lockCandidates.push({ x: targetX, y: o.y + o.length + gap, maxDist: maxMagnetDistance })
    }
  }

  let best: { x: number; y: number } | null = null
  let bestDist = Infinity
  for (const c of lockCandidates) {
    const res = tryPos(c.x, c.y)
    if (!res) continue
    const dist = Math.hypot(res.x - targetX, res.y - targetY)
    if (dist <= c.maxDist && dist < bestDist) {
      best = res
      bestDist = dist
    }
  }
  if (best) return best

  // Nothing to lock onto nearby — track the cursor exactly. Dragging over
  // open deck space should feel 100% free, not teleport between grid cells.
  const free = tryPos(targetX, targetY)
  if (free) return free

  // Fallback: X-only / Y-only, then binary search along the movement vector
  // toward the raw cursor target (not a grid-rounded point), same behaviour
  // as before snapping existed — a blocked drag eases up to exactly where
  // the cursor is once the path clears rather than resting on a grid line
  // short of it. (The exact target itself was already tried above as `free`.)
  const fallbackCandidates: { x: number; y: number }[] = [
    { x: targetX, y: currentY },
    { x: currentX, y: targetY },
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
    const x = currentX + (targetX - currentX) * mid
    const y = currentY + (targetY - currentY) * mid
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
  clearance?: number,
  outline?: { x: number; y: number }[]
): PackingResult {
  const dw = toFinite(deckWidth, 0)
  const dl = toFinite(deckLength, 0)
  const totalArea = outline && outline.length >= 3 ? polygonArea(outline) : dw * dl
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
  const itemMap = new Map<string, { quantity: number; height: number; shape?: CargoShape; outline?: { x: number; y: number }[] }>()
  if (items) {
    for (const it of items) {
      itemMap.set(it.id, { quantity: it.quantity, height: it.height ?? 0, shape: it.shape, outline: it.outline })
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
    outline: itemMap.get(p.itemId)?.outline,
    clearanceMargin: p.clearanceMargin,
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

  // Manual mode never had this populated — nothing is "rejected" by an
  // algorithm here, the user just hasn't clicked yet. But from the user's
  // point of view "some of my declared cargo isn't on the deck" is the same
  // fact either way, and the top unplaced-cargo banner (and the "Не влезло"
  // stat) stayed permanently blind to it in manual mode as a result. Report
  // each item's own shortfall (declared quantity minus what's actually
  // placed), worded as "not yet placed" rather than auto mode's "didn't
  // fit" — this is a to-do, not a packing failure.
  const unplaced: UnplacedItem[] = []
  if (items) {
    for (const it of items) {
      const placedForItem = map.get(it.id)?.placed ?? 0
      const remaining = Math.max(0, toPositiveInt(it.quantity, 0) - placedForItem)
      if (remaining > 0) {
        unplaced.push({
          itemId: it.id,
          name: it.name,
          width: toFinite(it.width, 0),
          length: toFinite(it.length, 0),
          reason: `Не размещено вручную (${remaining} ед.)`,
        })
      }
    }
  }

  return {
    placed,
    unplaced,
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
