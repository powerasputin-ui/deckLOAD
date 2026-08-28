// Shared length-unit conversion. Deliberately dependency-free so it can be
// imported by store/calculator.ts (the UI's unit-of-display source of
// truth), packing.ts (zone-load area) and stability.ts (moment-arm
// geometry) without any of THEM importing each other — calculator.ts
// already imports from both packing.ts and stability.ts, so either of
// those importing calculator.ts back would be circular.
export type Unit = 'm' | 'cm' | 'ft'

export const UNIT_LABEL: Record<Unit, string> = {
  m: 'м',
  cm: 'см',
  ft: 'фт',
}

// Conversion factors: how many units per meter. ft uses the exact reciprocal
// of the international foot definition (1 ft = 0.3048 m) to avoid drift on
// repeated unit switches.
const UNIT_PER_METER: Record<Unit, number> = {
  m: 1,
  cm: 100,
  ft: 1 / 0.3048,
}

export function convertLength(value: number, from: Unit, to: Unit): number {
  if (from === to) return value
  // value is in `from` units; convert to meters then to `to` units
  const meters = value / UNIT_PER_METER[from]
  const result = meters * UNIT_PER_METER[to]
  if (result === 0 || !Number.isFinite(result)) return result
  // Round to 12 significant figures — fine enough (well under 1e-9 relative
  // error for any realistic deck/cargo size) to stay far below the 1e-6
  // absolute epsilons packing.ts's geometry checks (rectInsidePolygon,
  // boardOffset boundary tests, etc.) use, so this never turns a legitimate
  // boundary-touching placement into a false "doesn't fit" — while still
  // capping the unbounded drift a bare `meters * UNIT_PER_METER[to]` would
  // accumulate over many repeated unit switches. This intentionally does
  // NOT try to produce "clean" round numbers like 2000 instead of
  // 1999.999999998 — that's a display concern, handled separately by
  // roundForDisplay() at the UI input layer, not by degrading the value
  // every downstream geometric calculation actually uses.
  return Number(result.toPrecision(12))
}

// Shorthand for the one direction stability.ts/packing.ts actually need:
// whatever the deck's display unit is, into real metres for physics.
export function toMeters(value: number, from: Unit): number {
  return convertLength(value, from, 'm')
}
