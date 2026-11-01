import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a number for display with up to 2 decimal places.
 * Handles NaN, Infinity and -0 gracefully.
 */
export function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  // Normalize -0 to 0 so it doesn't render as "-0"
  const v = value === 0 ? 0 : value
  const r = Math.round(v * 100) / 100
  const rounded = r === 0 ? 0 : r
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(2)
}

/**
 * Russian plural form for a count: `one` for 1, 21, 101…; `few` for 2–4,
 * 22–24…; `many` for 0, 5–20, 25–30… and every fraction-free remainder.
 */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n))
  const mod100 = abs % 100
  const mod10 = abs % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

/**
 * A weight given in kilograms, as tonnes to one decimal without a trailing
 * «.0»: 16 600 → «16.6», 2 550 000 → «2550».
 */
export function fmtTonnes(kg: number): string {
  // As fmtNumber: no «NaN» or «Infinity» on screen or in the PDF.
  if (!Number.isFinite(kg)) return '—'
  const t = Math.round(kg / 100) / 10
  return Number.isInteger(t) ? `${t}` : t.toFixed(1)
}
