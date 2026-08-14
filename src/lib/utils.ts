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
