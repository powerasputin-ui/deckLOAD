// Where each stack's label goes on the deck (spec 6.2). A label is the cargo
// number — «3», «3 ×4» with layers, «3+4 ×16» for a mixed stack — in dark
// ink over the cargo's light tone, never smaller than 11 px on screen. The
// cargo name is added only when it fits whole at 12 px: no ellipsis.
//
// A number "fits" when its frame (text width + 4 px, font size + 2 px) lies
// inside the stack as drawn. «×N» follows the same rule: when the whole
// label doesn't fit, the number alone is written. Where even that doesn't
// fit, it is written once over a group of neighbouring stacks of the same
// cargo — touching, or apart by no more than the deck's gap between cargo —
// if it fits the group. Otherwise it isn't written; the deck shows it on
// hover, on selection and when zoomed in.
//
// Sizes here are screen pixels. The number is as large as the stack allows,
// up to 20 px — a big container gets a big number — and at most 40% of the
// stack's shorter side.
import { edgeDistance } from './packing'

export const NUMBER_FONT_SIZES = [20, 16, 14, 12, 11] as const
export const NAME_FONT_SIZE = 12
// The deck's font (DeckVisualization's <svg>). The PDF draws the deck as an
// image, where Arial stands in for it — narrower, so what fits here fits
// there.
export const LABEL_FONT_FAMILY = "'IBM Plex Sans', Arial, sans-serif"
const NUMBER_WEIGHT = 600
const NAME_WEIGHT = 400

// The sizes a layout works in: the deck's screen pixels by default, the
// PDF's points for the plan on paper (planDrawing.ts).
export interface LabelSizes {
  // Number sizes, largest first; the last one is the smallest written.
  numbers: readonly number[]
  name: number
  // A number's frame: text width + padX, font size + padY.
  padX: number
  padY: number
  // Between the number and the name under it.
  lineGap: number
}
export const SCREEN_LABEL_SIZES: LabelSizes = { numbers: NUMBER_FONT_SIZES, name: NAME_FONT_SIZE, padX: 4, padY: 2, lineGap: 2 }

export interface LabelStack {
  key: string
  // Cargo numbers in the stack, one for a plain stack.
  numbers: number[]
  // Units in the stack.
  layers: number
  // The cargo's name, for a stack of one cargo.
  name?: string
  // As drawn on screen, px.
  rect: { x: number; y: number; w: number; h: number }
  // On the deck, for telling which stacks are neighbours.
  deck: { x: number; y: number; width: number; length: number }
}

// `full` is the whole label, «3 ×4»; `text` what is written on the stack.
export type StackLabelPlan =
  | { kind: 'own'; full: string; text: string; fontSize: number; name?: string }
  // Written over its group (StackGroupLabel), or nowhere.
  | { kind: 'group' | 'none'; full: string }

export interface StackGroupLabel {
  keys: string[]
  text: string
  fontSize: number
  cx: number
  cy: number
}

export function stackLabelText(numbers: readonly number[], layers: number): string {
  return numbersText(numbers) + (layers >= 2 ? ` ×${layers}` : '')
}

const numbersText = (numbers: readonly number[]) => [...new Set(numbers)].sort((a, b) => a - b).join('+')

// IBM Plex Sans, measured: digits, «×» and «+» 0.6 em; a space 0.24; small
// Cyrillic letters about 0.6 and Latin 0.52; capitals up to 0.72 — each
// rounded up here, so an estimate never says a label fits when it doesn't.
export function estimateTextWidth(text: string, fontSize: number): number {
  let em = 0
  for (const ch of text) {
    em +=
      ch === ' '
        ? 0.25
        : /[0-9×+]/.test(ch)
          ? 0.6
          : /[A-ZА-ЯЁ]/.test(ch)
            ? 0.74
            : /[а-яё]/.test(ch)
              ? 0.64
              : /[a-z]/.test(ch)
                ? 0.56
                : 0.42
  }
  return em * fontSize
}

// The real width in the deck's font where a canvas can measure it (the
// browser), the estimate elsewhere (tests).
let measuringContext: CanvasRenderingContext2D | null | undefined
export function measureTextWidth(text: string, fontSize: number, fontWeight: number): number {
  if (measuringContext === undefined) {
    try {
      measuringContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    } catch {
      measuringContext = null
    }
  }
  if (!measuringContext) return estimateTextWidth(text, fontSize)
  measuringContext.font = `${fontWeight} ${fontSize}px ${LABEL_FONT_FAMILY}`
  return measuringContext.measureText(text).width
}

const fitsIn = (textWidth: number, fontSize: number, w: number, h: number, sizes: LabelSizes) =>
  textWidth + sizes.padX <= w && fontSize + sizes.padY <= h

// The largest number size that fits and isn't over 40% of the shorter side
// (never below the smallest size, if that one fits).
function numberSize(text: string, w: number, h: number, measure: Measure, sizes: LabelSizes): number | undefined {
  const cap = Math.max(sizes.numbers[sizes.numbers.length - 1], 0.4 * Math.min(w, h))
  return sizes.numbers.find((size) => size <= cap && fitsIn(measure(text, size, NUMBER_WEIGHT), size, w, h, sizes))
}

type Measure = (text: string, fontSize: number, fontWeight: number) => number

// The frame, in screen px, that a stack's own label takes in its middle —
// the number and, under it, the name when it is shown — so the marks in the
// stack's corners can keep clear of it. 0 × 0 when the label is elsewhere.
export function ownLabelSize(
  plan: StackLabelPlan | undefined,
  withName: boolean,
  measure: Measure = (text, fontSize) => estimateTextWidth(text, fontSize),
  sizes: LabelSizes = SCREEN_LABEL_SIZES
): { w: number; h: number } {
  if (plan?.kind !== 'own' || !plan.text) return { w: 0, h: 0 }
  const numberW = measure(plan.text, plan.fontSize, NUMBER_WEIGHT) + sizes.padX
  if (!withName || !plan.name) return { w: numberW, h: plan.fontSize + sizes.padY }
  return {
    w: Math.max(numberW, measure(plan.name, sizes.name, NAME_WEIGHT) + sizes.padX),
    h: plan.fontSize + sizes.padY + sizes.lineGap + sizes.name + sizes.padY,
  }
}

export function layoutStackLabels(
  stacks: readonly LabelStack[],
  // The deck's gap between cargo, in deck units.
  gap: number,
  measure: Measure = (text, fontSize) => estimateTextWidth(text, fontSize),
  sizes: LabelSizes = SCREEN_LABEL_SIZES
): { plans: Map<string, StackLabelPlan>; groups: StackGroupLabel[] } {
  const plans = new Map<string, StackLabelPlan>()
  const unfit: LabelStack[] = []
  for (const s of stacks) {
    const full = stackLabelText(s.numbers, s.layers)
    const short = numbersText(s.numbers)
    const fullSize = numberSize(full, s.rect.w, s.rect.h, measure, sizes)
    const text = fullSize === undefined ? short : full
    const fontSize = fullSize ?? numberSize(short, s.rect.w, s.rect.h, measure, sizes)
    if (fontSize === undefined) {
      plans.set(s.key, { kind: 'none', full })
      unfit.push(s)
      continue
    }
    const nameFits =
      !!s.name &&
      measure(s.name, sizes.name, NAME_WEIGHT) + sizes.padX <= s.rect.w &&
      fontSize + sizes.padY + sizes.lineGap + sizes.name + sizes.padY <= s.rect.h
    plans.set(s.key, { kind: 'own', full, text, fontSize, name: nameFits ? s.name : undefined })
  }

  // Neighbouring stacks of the same cargo whose numbers don't fit.
  const parent = unfit.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const key = (s: LabelStack) => numbersText(s.numbers)
  for (let i = 0; i < unfit.length; i++) {
    for (let j = i + 1; j < unfit.length; j++) {
      if (key(unfit[i]) !== key(unfit[j])) continue
      if (edgeDistance(unfit[i].deck, unfit[j].deck) <= gap + 1e-6) parent[find(i)] = find(j)
    }
  }
  const members = new Map<number, LabelStack[]>()
  unfit.forEach((s, i) => {
    const root = find(i)
    members.set(root, [...(members.get(root) ?? []), s])
  })

  const groups: StackGroupLabel[] = []
  for (const group of members.values()) {
    if (group.length < 2) continue
    const text = key(group[0])
    const left = Math.min(...group.map((s) => s.rect.x))
    const top = Math.min(...group.map((s) => s.rect.y))
    const right = Math.max(...group.map((s) => s.rect.x + s.rect.w))
    const bottom = Math.max(...group.map((s) => s.rect.y + s.rect.h))
    const fontSize = numberSize(text, right - left, bottom - top, measure, sizes)
    if (fontSize === undefined) continue
    const cx = (left + right) / 2
    const cy = (top + bottom) / 2
    // The number stands on the group's stacks: a group bent into an L has
    // the middle of its bounds over empty deck, where the number would
    // belong to nothing.
    const near = Math.min(...group.map((s) => distanceToRect(cx, cy, s.rect)))
    if (near > fontSize / 2 + sizes.padY) continue
    groups.push({ keys: group.map((s) => s.key), text, fontSize, cx, cy })
    for (const s of group) plans.set(s.key, { kind: 'group', full: stackLabelText(s.numbers, s.layers) })
  }
  return { plans, groups }
}

function distanceToRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w))
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h))
  return Math.hypot(dx, dy)
}
