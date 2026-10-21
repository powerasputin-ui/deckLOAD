// Pure helpers behind NumberField (src/components/calculator/NumberField.tsx)
// — no React in here so the parsing rules can be tested on their own.
//
// Why a draft-based field exists at all: the numeric inputs used to be
// controlled `type="number"` elements that pushed EVERY keystroke into the
// store, snapping to the minimum on anything that wasn't a finished number.
// Besides the visible glitch (Backspace on "20" → "0.1", typing "24" → "0.124")
// that is destructive here, because setDeck()/updateItem() reflow, resize and
// clamp placements that are already on the deck — a transient "2" on the way
// to "24" would shove cargo around (or discard stacked layers) and the
// intermediate damage doesn't undo itself once the final value arrives.

export interface NumberInputBounds {
  min?: number
  max?: number
  /** Round the committed value to a whole number (the typed text may still contain a separator). */
  integer?: boolean
}

export type ParsedNumberInput =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | {
      kind: 'ok'
      /** What gets committed: rounded (integer) and clamped to [min, max]. */
      value: number
      /** What the user actually typed (rounded for `integer`, but NOT clamped). */
      typed: number
      /** Which bound the typed value was pulled back to, if any. */
      clamped?: 'min' | 'max'
    }

function round6(v: number): number {
  const r = Math.round(v * 1e6) / 1e6
  return r === 0 ? 0 : r
}

/** Formats a stored number for display in the field; '' when there is no value. */
export function formatNumberInput(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return ''
  return String(round6(value))
}

/** Strips whitespace (incl. NBSP / narrow NBSP), so a pasted "1 200,5" is accepted. */
export function cleanNumberInput(raw: string): string {
  return raw.replace(/[\s  ]/g, '')
}

/**
 * Whether `raw` is an acceptable state while typing: digits with at most one
 * "." or "," and — only when negatives are legal — a leading "-". Half-typed
 * values ("", "-", "0,", ".5") pass here; they just aren't committable yet
 * (parseNumberInput reports them as 'invalid'/'empty').
 */
export function isAllowedNumberInput(raw: string, bounds: NumberInputBounds = {}): boolean {
  const allowNegative = bounds.min === undefined || bounds.min < 0
  return (allowNegative ? /^-?\d*[.,]?\d*$/ : /^\d*[.,]?\d*$/).test(raw)
}

/**
 * Turns the field's text into a committable number. Accepts "," or "." as the
 * decimal separator (Russian convention — the app is Russian-language, and a
 * `type="number"` input rejects the comma outright in most locales).
 */
export function parseNumberInput(raw: string, bounds: NumberInputBounds = {}): ParsedNumberInput {
  const text = cleanNumberInput(raw)
  if (text === '') return { kind: 'empty' }
  if (!/^-?(\d+[.,]?\d*|[.,]\d+)$/.test(text)) return { kind: 'invalid' }
  let typed = Number(text.replace(',', '.'))
  if (!Number.isFinite(typed)) return { kind: 'invalid' }
  if (bounds.integer) typed = Math.round(typed)
  let value = typed
  let clamped: 'min' | 'max' | undefined
  if (bounds.min !== undefined && value < bounds.min) {
    value = bounds.min
    clamped = 'min'
  } else if (bounds.max !== undefined && value > bounds.max) {
    value = bounds.max
    clamped = 'max'
  }
  return clamped
    ? { kind: 'ok', value: round6(value), typed: round6(typed), clamped }
    : { kind: 'ok', value: round6(value), typed: round6(typed) }
}

/** ArrowUp/ArrowDown step: float-noise free (0.1 + 0.2 → 0.3) and clamped to the bounds. */
export function stepNumberInput(
  base: number,
  direction: 1 | -1,
  step: number,
  bounds: NumberInputBounds = {}
): number {
  let next = round6(base + direction * step)
  if (bounds.integer) next = Math.round(next)
  if (bounds.min !== undefined && next < bounds.min) next = bounds.min
  if (bounds.max !== undefined && next > bounds.max) next = bounds.max
  return round6(next)
}
