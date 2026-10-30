// The deck plan on paper (spec 11): the PDF's scheme, and the same drawing
// in the «Отчёт» preview and on the start screen. Built from the
// calculation's data, not from the screen: it doesn't depend on the zoom,
// the selection or the 2D/3D view. Everything is in points (1/72 in), the
// PDF's own unit; planToPdf.ts and PlanDrawingSvg.tsx only draw what this
// returns.
//
// It draws what the deck shows (spec 6.1–6.3) as a drawing: the deck and
// its usable area, obstacles, load zones, the stacks in their cargo's tone
// with their numbers by the rules of 6.2 — the number at 7 pt or more — and
// the marks of 6.3 that matter on paper; around it the hull's sides, the
// deck's dimensions and a scale bar. The lock of a pinned stack is the
// calculation's own business and stays off the paper; the grid too.
import { CARGO_INK, cargoToneForNumber } from './cargoPalette'
import { deckDrawnTransposed, HULL_SIDE_LABEL, hullSideEdges, scaleBarSteps, type DrawingEdge, type HullSide } from './deckDrawing'
import {
  estimateTextWidth,
  layoutStackLabels,
  ownLabelSize,
  type LabelSizes,
  type StackGroupLabel,
  type StackLabelPlan,
} from './labelLayout'
import {
  computeGridStep,
  decomposePipePyramid,
  erodePolygon,
  pipePyramidSpreadMargin,
  restrictionZonePolygon,
  rotateOutline90,
  zoneIdsOverlapping,
  type LoadZone,
  type PlacedItem,
  type RestrictionZone,
  type ZoneLoadCheck,
} from './packing'
import { segmentsOf } from './placementComposition'
import { autoPlacementKey } from './stackSelection'
import { cornerMarksFit } from './stackMarks'
import { UNIT_LABEL, type Unit } from './units'
import { fmtNumber } from './utils'

export type Pt = { x: number; y: number }
export interface Stroke {
  color: string
  width: number
  dash?: number[]
}

// `text` is centred on y; `vertical` turns it to read bottom to top.
export type PlanShape =
  | { kind: 'poly'; points: Pt[]; fill?: string; stroke?: Stroke }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r?: number; fill?: string; stroke?: Stroke }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: Stroke }
  | { kind: 'line'; from: Pt; to: Pt; stroke: Stroke }
  | {
      kind: 'text'
      x: number
      y: number
      text: string
      size: number
      bold?: boolean
      color: string
      anchor: 'start' | 'middle' | 'end'
      vertical?: boolean
      // Extra space between letters, pt.
      spacing?: number
    }

export interface PlanDrawing {
  shapes: PlanShape[]
  // The deck's bounding box on the sheet, and points per deck unit.
  deck: { x: number; y: number; w: number; h: number }
  scale: number
  // What each stack's label became (by autoPlacementKey), the numbers
  // written over groups, and the stacks numbered beside themselves — what
  // the tests read.
  labels: Map<string, StackLabelPlan>
  groups: StackGroupLabel[]
  callouts: Set<string>
}

export interface PlanDeck {
  width: number
  length: number
  unit: Unit
  gap: number
  boardOffset: number
  outline?: Pt[]
  restrictionZones?: RestrictionZone[]
  loadZones?: LoadZone[]
  deckForwardIsPositiveY?: boolean
}

export interface PlanDrawingInput {
  deck: PlanDeck
  // The trip's stacks. Quarantined records aren't among them.
  placed: readonly PlacedItem[]
  // Cargo id → its number in the list.
  numbers: ReadonlyMap<string, number>
  // The load zones as checked for this trip.
  zoneLoads?: readonly ZoneLoadCheck[]
  // Stacks short of lashing, and stacks of unknown make-up, by autoPlacementKey.
  lashingShort?: ReadonlySet<string>
  unknownMakeup?: ReadonlySet<string>
  // The box on the sheet the drawing fits into, centred.
  frame: { x: number; y: number; w: number; h: number }
}

// Paper's colours: the deck light enough to print, the rest from the
// screen's light theme (theme.ts) and marks (deckMarks.tsx).
const INK = '#10243A'
const INK_2 = '#4B5D70'
const LINE_STRONG = '#7D8EA0'
const DECK_FILL = '#F1F4F7'
const OBSTACLE_FILL = '#E3E8ED'
const PROBLEM = '#DC2626'
const PROBLEM_LIGHT = '#F4B4AE'
const LASHING_BADGE = '#B45309'
const WHITE = '#FFFFFF'

// Labels on paper (spec 11): the number from 12 down to 7 pt, the name at
// 7 pt. The frame and the gaps scale with them.
export const PAPER_LABEL_SIZES: LabelSizes = { numbers: [12, 10, 9, 8, 7], name: 7, padX: 2, padY: 1, lineGap: 1 }
// The corner marks at half their screen size: a 14 px badge is 7 pt.
const MARK_SCALE = 0.5

// The rows around the deck, as on screen (DeckDrawingFrame.tsx): the
// dimension next to the top and left edges, the side's name beyond it;
// along the bottom the name, then the scale bar.
const FRAME_FONT = 8
const GAP = 4
const ROW = 11
const rowCenter = (row: 1 | 2) => GAP + (row - 1) * ROW + FRAME_FONT / 2
const MARGIN = { top: GAP + ROW + FRAME_FONT + 3, right: GAP + FRAME_FONT + 3, bottom: GAP + ROW + FRAME_FONT + 3, left: GAP + ROW + FRAME_FONT + 3 }

export function buildPlanDrawing(input: PlanDrawingInput): PlanDrawing {
  const { deck, frame } = input
  const shapes: PlanShape[] = []
  const transposed = deckDrawnTransposed(deck.width, deck.length)
  const drawnW = transposed ? deck.length : deck.width
  const drawnH = transposed ? deck.width : deck.length
  const roomW = Math.max(1, frame.w - MARGIN.left - MARGIN.right)
  const roomH = Math.max(1, frame.h - MARGIN.top - MARGIN.bottom)
  const k = drawnW > 0 && drawnH > 0 ? Math.min(roomW / drawnW, roomH / drawnH) : 1
  const box = {
    x: frame.x + MARGIN.left + (roomW - drawnW * k) / 2,
    y: frame.y + MARGIN.top + (roomH - drawnH * k) / 2,
    w: drawnW * k,
    h: drawnH * k,
  }
  // Deck x runs left → right (top → bottom when transposed), deck y top →
  // bottom (left → right when transposed) — DeckVisualization's deckToScreen.
  const at = (x: number, y: number): Pt => (transposed ? { x: box.x + y * k, y: box.y + x * k } : { x: box.x + x * k, y: box.y + y * k })
  const span = (width: number, length: number) => (transposed ? { w: length * k, h: width * k } : { w: width * k, h: length * k })
  const rectOf = (r: { x: number; y: number; width: number; length: number }) => ({ ...at(r.x, r.y), ...span(r.width, r.length) })

  // The deck and the area inside the board offset.
  const outline = deck.outline && deck.outline.length >= 3 ? deck.outline : undefined
  if (outline) shapes.push({ kind: 'poly', points: outline.map((p) => at(p.x, p.y)), fill: DECK_FILL, stroke: { color: INK, width: 1 } })
  else shapes.push({ kind: 'rect', ...box, fill: DECK_FILL, stroke: { color: INK, width: 1 } })
  if (deck.boardOffset > 0) {
    const dashed: Stroke = { color: LINE_STRONG, width: 0.5, dash: [2, 2] }
    if (outline) shapes.push({ kind: 'poly', points: erodePolygon(outline, deck.boardOffset).map((p) => at(p.x, p.y)), stroke: dashed })
    else {
      const o = deck.boardOffset
      if (deck.width > 2 * o && deck.length > 2 * o) shapes.push({ kind: 'rect', ...rectOf({ x: o, y: o, width: deck.width - 2 * o, length: deck.length - 2 * o }), stroke: dashed })
    }
  }

  // Load zones under the cargo: dashed, hatched red when over their limit.
  const zones = deck.loadZones ?? []
  const loadOf = (id: string) => input.zoneLoads?.find((z) => z.zoneId === id)
  for (const z of zones) {
    const r = rectOf(z)
    const over = !!loadOf(z.id)?.exceeded
    if (over) shapes.push(...hatch(rectPoints(r), PROBLEM_LIGHT, 0.75, 4, -45))
    shapes.push({ kind: 'rect', ...r, stroke: over ? { color: PROBLEM, width: 1 } : { color: INK_2, width: 0.75, dash: [4, 2] } })
  }

  // Obstacles: grey, hatched, outlined.
  for (const zone of deck.restrictionZones ?? []) {
    const points = restrictionZonePolygon(zone).map((p) => at(p.x, p.y))
    shapes.push({ kind: 'poly', points, fill: OBSTACLE_FILL })
    shapes.push(...hatch(points, LINE_STRONG, 0.5, 4, 45))
    shapes.push({ kind: 'poly', points, stroke: { color: INK_2, width: 0.75 } })
  }

  // The stacks: where each is drawn, and its label.
  const exceeded = new Map(zones.filter((z) => loadOf(z.id)?.exceeded).map((z) => [z.id, z]))
  const stacks = input.placed.map((p) => {
    const spread = pipePyramidSpreadMargin(p, p.stackedCount)
    const deckRect = { x: p.x - spread.onWidth, y: p.y - spread.onLength, width: p.width + spread.onWidth * 2, length: p.length + spread.onLength * 2 }
    const numbers = segmentsOf(p)
      .map((seg) => input.numbers.get(seg.itemId))
      .filter((n): n is number => n !== undefined)
    return { p, key: autoPlacementKey(p), deckRect, rect: rectOf(deckRect), numbers }
  })
  const { plans, groups } = layoutStackLabels(
    stacks
      .filter((s) => s.numbers.length > 0)
      .map((s) => ({
        key: s.key,
        numbers: s.numbers,
        layers: s.p.stackedCount,
        name: new Set(s.numbers).size === 1 ? s.p.name : undefined,
        rect: s.rect,
        deck: s.deckRect,
      })),
    deck.gap,
    undefined,
    PAPER_LABEL_SIZES
  )

  const toneOf = (p: PlacedItem) => {
    const n = input.numbers.get(p.itemId)
    return n ? cargoToneForNumber(n) : p.color
  }
  // Where labels already stand, for the numbers written beside their stacks.
  const taken: Box[] = stacks.map((s) => s.rect)
  for (const zone of deck.restrictionZones ?? []) taken.push(boundsOf(restrictionZonePolygon(zone).map((p) => at(p.x, p.y))))

  for (const s of stacks) {
    const { p, rect } = s
    const tone = toneOf(p)
    const overload = exceeded.size > 0 && zoneIdsOverlapping({ x: p.x, y: p.y, width: p.width, length: p.length }, zones).some((id) => exceeded.has(id))
    const problem = overload || !!p.conflict
    const stroke: Stroke = problem ? { color: PROBLEM, width: 1.2 } : { color: CARGO_INK, width: 0.6 }
    const pile = footprint(p, rect, k, transposed, tone, stroke)
    shapes.push(...pile.shapes)
    if (p.conflict) shapes.push(...hatch(rectPoints(rect), PROBLEM, 1, 3, 45))

    const plan = plans.get(s.key)
    if (plan?.kind === 'own' && plan.text) {
      const label = ownLabel(plan, rect, tone, pile.divided)
      shapes.push(...label.shapes)
      taken.push(label.box)
    }

    // The marks, where they leave the number clear (spec 6.2).
    const label = ownLabelSize(plan, true, undefined, PAPER_LABEL_SIZES)
    const fit = cornerMarksFit(rect.w / MARK_SCALE, rect.h / MARK_SCALE, label.w / MARK_SCALE, label.h / MARK_SCALE)
    if (overload && fit.overload) shapes.push(...overloadMark(rect.x + 1, rect.y + 1))
    const lashingShort = !!input.lashingShort?.has(s.key)
    const unknown = !!input.unknownMakeup?.has(s.key)
    if (lashingShort && fit.badge) shapes.push(...lashingMark(rect.x + 1, rect.y + rect.h - 8))
    if (unknown && (lashingShort ? fit.secondBadge : fit.badge)) shapes.push(...unknownMark(rect.x + 1 + (lashingShort ? 8 : 0), rect.y + rect.h - 8))
  }
  // A group's number on a patch of its tone, clear of the lines between
  // the stacks under it.
  for (const g of groups) {
    const first = stacks.find((s) => s.key === g.keys[0])
    const w = estimateTextWidth(g.text, g.fontSize) + 2
    const box = { x: g.cx - w / 2, y: g.cy - g.fontSize / 2, w, h: g.fontSize }
    if (first) shapes.push({ kind: 'rect', ...box, fill: toneOf(first.p) })
    shapes.push(numberText(g.text, g.cx, g.cy, g.fontSize))
    taken.push(box)
  }

  // Paper has no hover: a number that fits neither its stack nor a group is
  // written beside the stack, with a short leader, where there is room on
  // the deck.
  const callouts = new Set<string>()
  for (const s of stacks) {
    const plan = plans.get(s.key)
    if (plan?.kind !== 'none') continue
    const placed = callout(plan.full, s.rect, box, taken)
    if (!placed) continue
    shapes.push(...placed.shapes)
    taken.push(placed.box)
    callouts.add(s.key)
  }

  // Zone and obstacle names over the cargo, on a white ground, where they fit.
  zones.forEach((z, i) => {
    const r = rectOf(z)
    const load = loadOf(z.id)
    const text = `Зона ${i + 1} · ${load?.exceeded ? `${short(load.densityTPerM2)} из ` : ''}${short(z.maxLoadPerArea)} т/м²`
    shapes.push(...tag(text, r, load?.exceeded ? PROBLEM : INK_2))
  })
  for (const zone of deck.restrictionZones ?? []) {
    if (!zone.name) continue
    const r = boundsOf(restrictionZonePolygon(zone).map((p) => at(p.x, p.y)))
    const w = estimateTextWidth(zone.name, 7) + 4
    if (w <= r.w && 9 <= r.h) {
      shapes.push({ kind: 'rect', x: r.x + (r.w - w) / 2, y: r.y + r.h / 2 - 4.5, w, h: 9, fill: WHITE })
      shapes.push({ kind: 'text', x: r.x + r.w / 2, y: r.y + r.h / 2, text: zone.name, size: 7, color: INK, anchor: 'middle' })
    }
  }

  shapes.push(...drawingFrame(deck, box, k, transposed))
  return { shapes, deck: box, scale: k, labels: plans, groups, callouts }
}

type Box = { x: number; y: number; w: number; h: number }

const boundsOf = (points: Pt[]): Box => {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

// A number beside its stack: right of it, left, above or below — the first
// place inside the deck clear of every stack and label — joined to the
// stack by a short line.
function callout(text: string, r: Box, deckBox: Box, taken: Box[]): { shapes: PlanShape[]; box: Box } | null {
  const size = PAPER_LABEL_SIZES.numbers[PAPER_LABEL_SIZES.numbers.length - 1]
  const w = estimateTextWidth(text, size) + PAPER_LABEL_SIZES.padX
  const h = size + PAPER_LABEL_SIZES.padY
  const off = 4
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const candidates: { box: Box; from: Pt; to: Pt }[] = [
    { box: { x: r.x + r.w + off, y: cy - h / 2, w, h }, from: { x: r.x + r.w, y: cy }, to: { x: r.x + r.w + off, y: cy } },
    { box: { x: r.x - off - w, y: cy - h / 2, w, h }, from: { x: r.x, y: cy }, to: { x: r.x - off, y: cy } },
    { box: { x: cx - w / 2, y: r.y - off - h, w, h }, from: { x: cx, y: r.y }, to: { x: cx, y: r.y - off } },
    { box: { x: cx - w / 2, y: r.y + r.h + off, w, h }, from: { x: cx, y: r.y + r.h }, to: { x: cx, y: r.y + r.h + off } },
  ]
  const inside = (b: Box) => b.x >= deckBox.x && b.y >= deckBox.y && b.x + b.w <= deckBox.x + deckBox.w && b.y + b.h <= deckBox.y + deckBox.h
  const free = candidates.find((c) => inside(c.box) && !taken.some((t) => overlaps(c.box, t)))
  if (!free) return null
  return {
    box: free.box,
    shapes: [
      { kind: 'line', from: free.from, to: free.to, stroke: { color: CARGO_INK, width: 0.5 } },
      numberText(text, free.box.x + free.box.w / 2, free.box.y + free.box.h / 2, size),
    ],
  }
}

// A stack's own label: the number, and the name under it when it fits.
// Over a pile of pipes the number sits on a patch of the tone, clear of the
// lines between them, and the name — which no patch would keep legible
// there — is left to the table.
function ownLabel(plan: Extract<StackLabelPlan, { kind: 'own' }>, r: Box, tone: string, divided: boolean): { shapes: PlanShape[]; box: Box } {
  const out: PlanShape[] = []
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const size = plan.fontSize
  const nameSize = PAPER_LABEL_SIZES.name
  const gap = PAPER_LABEL_SIZES.lineGap
  const name = divided ? undefined : plan.name
  const numberY = name ? cy - (size + gap + nameSize) / 2 + size / 2 : cy
  const numberW = estimateTextWidth(plan.text, size) + 2
  if (divided) out.push({ kind: 'rect', x: cx - numberW / 2, y: numberY - size / 2, w: numberW, h: size, fill: tone })
  out.push(numberText(plan.text, cx, numberY, size))
  if (name) out.push({ kind: 'text', x: cx, y: numberY + size / 2 + gap + nameSize / 2, text: name, size: nameSize, color: CARGO_INK, anchor: 'middle' })
  const w = Math.max(numberW, name ? estimateTextWidth(name, nameSize) + 2 : 0)
  const h = name ? size + gap + nameSize : size
  return { shapes: out, box: { x: cx - w / 2, y: cy - h / 2, w, h } }
}

// Zone figures as the deck writes them: up to two decimals, no trailing zeros.
const short = (v: number) => String(Math.round(v * 100) / 100)

const numberText = (text: string, x: number, y: number, size: number): PlanShape => ({ kind: 'text', x, y, text, size, bold: true, color: CARGO_INK, anchor: 'middle' })

// A label on a white ground in a box's top left corner, when it fits.
function tag(text: string, r: Box, color: string): PlanShape[] {
  const size = 6.5
  const w = estimateTextWidth(text, size) + 4
  const h = size + 2.5
  if (w + 2 > r.w || h + 2 > r.h) return []
  return [
    { kind: 'rect', x: r.x + 1, y: r.y + 1, w, h, fill: WHITE },
    { kind: 'text', x: r.x + 3, y: r.y + 1 + h / 2, text, size, color, anchor: 'start' },
  ]
}

// A stack's silhouette, as DeckVisualization's FootprintShape draws it, in
// points: `r` is its box on the sheet, `k` points per deck unit.
function footprint(
  p: PlacedItem,
  r: Box,
  k: number,
  transposed: boolean,
  fill: string,
  stroke: Stroke
): { shapes: PlanShape[]; divided: boolean } {
  const { x, y, w, h } = r
  const shape = p.shape
  if (shape === 'cylinder' || shape === 'pipe-nest') {
    // A pile of pipes reads as several pipes side by side: the widened axis
    // divided into the base row's count (PlacedRect's pipeSpread/nestSpread).
    let count = 1
    let axis: 'w' | 'h' = 'w'
    if (shape === 'cylinder' && p.stackedCount > 1) {
      const margin = pipePyramidSpreadMargin(p, p.stackedCount)
      if (margin.onWidth > 0 || margin.onLength > 0) {
        count = Math.max(1, decomposePipePyramid(p.stackedCount)[0]?.offsets.length ?? 1)
        axis = margin.onWidth > 0 ? (transposed ? 'h' : 'w') : transposed ? 'w' : 'h'
      }
    } else if (shape === 'pipe-nest' && p.nest) {
      count = Math.max(1, p.nest.pipesPerRow)
      axis = transposed ? 'h' : 'w'
    }
    if (count <= 1) return { shapes: [{ kind: 'rect', x, y, w, h, r: Math.min(w, h) / 2, fill, stroke }], divided: false }
    const along = axis === 'w' ? w : h
    const across = axis === 'w' ? h : w
    const gap = Math.max(0.25, Math.min(1, (along / count) * 0.06))
    const seg = (along - gap * (count - 1)) / count
    const radius = Math.min(seg, across) / 2
    return {
      shapes: Array.from({ length: count }, (_, i) => {
        const offset = i * (seg + gap)
        return axis === 'w'
          ? { kind: 'rect' as const, x: x + offset, y, w: seg, h, r: radius, fill, stroke }
          : { kind: 'rect' as const, x, y: y + offset, w, h: seg, r: radius, fill, stroke }
      }),
      divided: true,
    }
  }
  if (shape === 'custom' && p.outline && p.outline.length >= 3) {
    const origWidth = p.rotated ? h / k : w / k
    const origLength = p.rotated ? w / k : h / k
    const local = p.rotated ? rotateOutline90(p.outline, origWidth, origLength) : p.outline
    return { shapes: [{ kind: 'poly', points: local.map((q) => ({ x: x + q.x * k, y: y + q.y * k })), fill, stroke }], divided: false }
  }
  if (shape === 'circle' || shape === 'oval') return { shapes: [{ kind: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, fill, stroke }], divided: false }
  if (shape === 'triangle') {
    const origW = p.rotated ? h : w
    const origL = p.rotated ? w : h
    const local = [
      { x: origW / 2, y: 0 },
      { x: 0, y: origL },
      { x: origW, y: origL },
    ]
    const pts = p.rotated ? rotateOutline90(local, origW, origL) : local
    return { shapes: [{ kind: 'poly', points: pts.map((q) => ({ x: x + q.x, y: y + q.y })), fill, stroke }], divided: false }
  }
  if (shape === 'diamond') {
    const points = [
      { x: x + w / 2, y },
      { x: x + w, y: y + h / 2 },
      { x: x + w / 2, y: y + h },
      { x, y: y + h / 2 },
    ]
    return { shapes: [{ kind: 'poly', points, fill, stroke }], divided: false }
  }
  return { shapes: [{ kind: 'rect', x, y, w, h, r: 0.5, fill, stroke }], divided: false }
}

// The marks of 6.3 at half their screen size (deckMarks.tsx), from the
// corner (x, y) of their own box.
function overloadMark(x: number, y: number): PlanShape[] {
  return [
    { kind: 'poly', points: [{ x: x + 4, y }, { x: x + 8, y: y + 7 }, { x, y: y + 7 }], fill: PROBLEM, stroke: { color: WHITE, width: 0.5 } },
    { kind: 'text', x: x + 4, y: y + 4.6, text: '!', size: 5.5, bold: true, color: WHITE, anchor: 'middle' },
  ]
}

function lashingMark(x: number, y: number): PlanShape[] {
  const ring: Stroke = { color: WHITE, width: 0.7 }
  return [
    { kind: 'rect', x, y, w: 7, h: 7, r: 1.5, fill: LASHING_BADGE },
    { kind: 'ellipse', cx: x + 2.7, cy: y + 4.3, rx: 1.5, ry: 1.5, stroke: ring },
    { kind: 'ellipse', cx: x + 4.3, cy: y + 2.7, rx: 1.5, ry: 1.5, stroke: ring },
  ]
}

function unknownMark(x: number, y: number): PlanShape[] {
  return [
    { kind: 'rect', x, y, w: 7, h: 7, r: 1.5, fill: CARGO_INK },
    { kind: 'text', x: x + 3.5, y: y + 3.6, text: '?', size: 6, bold: true, color: WHITE, anchor: 'middle' },
  ]
}

// Around the deck: the dimensions along the top and left edges, the hull's
// sides on their edges (the bow with an arrow out of the drawing) and the
// scale bar under the deck.
function drawingFrame(deck: PlanDeck, box: Box, k: number, transposed: boolean): PlanShape[] {
  const out: PlanShape[] = []
  const unit = UNIT_LABEL[deck.unit]
  const at = (edge: DrawingEdge, row: 1 | 2): Pt => {
    const d = rowCenter(row)
    switch (edge) {
      case 'top':
        return { x: box.x + box.w / 2, y: box.y - d }
      case 'bottom':
        return { x: box.x + box.w / 2, y: box.y + box.h + d }
      case 'left':
        return { x: box.x - d, y: box.y + box.h / 2 }
      case 'right':
        return { x: box.x + box.w + d, y: box.y + box.h / 2 }
    }
  }
  out.push(...dimension(`${fmtNumber(transposed ? deck.length : deck.width)} ${unit}`, box.x, box.x + box.w, box.y - rowCenter(1), true))
  out.push(...dimension(`${fmtNumber(transposed ? deck.width : deck.length)} ${unit}`, box.y, box.y + box.h, box.x - rowCenter(1), false))

  const sides = hullSideEdges(deck.width, deck.length, deck.deckForwardIsPositiveY ?? true)
  for (const side of Object.keys(sides) as HullSide[]) {
    const edge = sides[side]
    const { x, y } = at(edge, edge === 'top' || edge === 'left' ? 2 : 1)
    const vertical = edge === 'left' || edge === 'right'
    const text = HULL_SIDE_LABEL[side]
    out.push({ kind: 'text', x, y, text, size: FRAME_FONT, bold: true, color: INK, anchor: 'middle', vertical, spacing: 0.6 })
    if (side !== 'bow') continue
    // The arrow, before the name as it reads, pointing out of the drawing.
    const half = (estimateTextWidth(text, FRAME_FONT) + 0.6 * text.length) / 2 + 6
    const a = 3
    const tip = (cx: number, cy: number, dx: number, dy: number): PlanShape => ({
      kind: 'poly',
      points: [
        { x: cx + dx * a, y: cy + dy * a },
        { x: cx - dx * a + dy * a, y: cy - dy * a + dx * a },
        { x: cx - dx * a - dy * a, y: cy - dy * a - dx * a },
      ],
      fill: INK,
    })
    if (edge === 'top') out.push(tip(x - half, y, 0, -1))
    else if (edge === 'bottom') out.push(tip(x - half, y, 0, 1))
    else if (edge === 'left') out.push(tip(x, y + half, -1, 0))
    else out.push(tip(x, y + half, 1, 0))
  }

  // The scale bar: whole grid steps, about 50 pt long.
  const step = computeGridStep(deck.width, deck.length, deck.unit)
  const stepPt = step * k
  if (stepPt > 0) {
    const steps = scaleBarSteps(stepPt, 50)
    const y = box.y + box.h + rowCenter(2)
    const x0 = box.x
    for (let i = 0; i < steps; i++) {
      out.push({ kind: 'rect', x: x0 + i * stepPt, y: y - 1.5, w: stepPt, h: 3, fill: i % 2 === 0 ? INK_2 : undefined, stroke: { color: INK_2, width: 0.5 } })
    }
    out.push({ kind: 'text', x: x0 + steps * stepPt + 4, y, text: `${fmtNumber(steps * step)} ${unit}`, size: 7, color: INK_2, anchor: 'start' })
  }
  return out
}

// An overall dimension: a line along the edge with ticks at the ends,
// broken in the middle for the figure.
function dimension(text: string, from: number, to: number, at: number, horizontal: boolean): PlanShape[] {
  const size = 7.5
  const mid = (from + to) / 2
  const half = estimateTextWidth(text, size) / 2 + 3
  const tick = 3
  const stroke: Stroke = { color: INK_2, width: 0.5 }
  const out: PlanShape[] = []
  if (to - from > half * 2 + 6) {
    const seg = (a: number, b: number): PlanShape =>
      horizontal ? { kind: 'line', from: { x: a, y: at }, to: { x: b, y: at }, stroke } : { kind: 'line', from: { x: at, y: a }, to: { x: at, y: b }, stroke }
    const tickAt = (v: number): PlanShape =>
      horizontal ? { kind: 'line', from: { x: v, y: at - tick }, to: { x: v, y: at + tick }, stroke } : { kind: 'line', from: { x: at - tick, y: v }, to: { x: at + tick, y: v }, stroke }
    out.push(seg(from, mid - half), seg(mid + half, to), tickAt(from), tickAt(to))
  }
  out.push({ kind: 'text', x: horizontal ? mid : at, y: horizontal ? at : mid, text, size, color: INK_2, anchor: 'middle', vertical: !horizontal })
  return out
}

const rectPoints = (r: Box): Pt[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
]

// Hatching inside a polygon: parallel lines `step` apart at `angle`
// degrees, cut to the polygon (even-odd), so both outputs draw plain lines.
export function hatch(polygon: readonly Pt[], color: string, width: number, step: number, angle: number): PlanShape[] {
  if (polygon.length < 3 || !(step > 0)) return []
  const t = (angle * Math.PI) / 180
  // Lines run along d; n is across them.
  const d = { x: Math.cos(t), y: Math.sin(t) }
  const n = { x: -d.y, y: d.x }
  const across = polygon.map((p) => p.x * n.x + p.y * n.y)
  const lo = Math.min(...across)
  const hi = Math.max(...across)
  const out: PlanShape[] = []
  const stroke: Stroke = { color, width }
  for (let c = lo + step / 2; c < hi; c += step) {
    // Where the line n·p = c crosses each edge, as positions along d.
    const hits: number[] = []
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]
      const b = polygon[(i + 1) % polygon.length]
      const ca = a.x * n.x + a.y * n.y
      const cb = b.x * n.x + b.y * n.y
      if ((ca <= c && cb > c) || (cb <= c && ca > c)) {
        const s = (c - ca) / (cb - ca)
        const px = a.x + (b.x - a.x) * s
        const py = a.y + (b.y - a.y) * s
        hits.push(px * d.x + py * d.y)
      }
    }
    hits.sort((u, v) => u - v)
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const point = (s: number): Pt => ({ x: n.x * c + d.x * s, y: n.y * c + d.y * s })
      out.push({ kind: 'line', from: point(hits[i]), to: point(hits[i + 1]), stroke })
    }
  }
  return out
}
