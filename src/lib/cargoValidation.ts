// Shared CargoItem field validation rules, used by BOTH the persistence
// layer (src/store/projects.ts's normalizeProject) and the live store
// (src/store/calculator.ts's updateItem). Before this file existed, the
// same rules were duplicated in both places by hand — easy for the two to
// silently drift apart. This file is the single source of truth for what
// counts as a valid width/length/height/quantity/weight/maxLayers/
// maxStackHeightM; neither caller should re-derive these rules itself.
//
// Deliberately self-contained (imports nothing from projects.ts or
// calculator.ts) so it can be imported by both without creating a cycle —
// projects.ts already imports from calculator.ts, so a shared module can
// only safely sit below both, not inside either.

export function sanitizeCargoWidth(value: unknown, fallback = 1): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function sanitizeCargoLength(value: unknown, fallback = 1): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function sanitizeCargoHeight(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

// NOT rejecting 0 the way a plain "positive int" helper would — 0 is a
// legitimate "none of this cargo left" (e.g. after deleting the last
// placed unit), not corrupted input. Only genuinely invalid input
// (NaN/undefined/negative) falls back.
export function sanitizeCargoQuantity(value: unknown, fallback: number): number {
  const v = typeof value === 'number' ? value : fallback
  if (!Number.isFinite(v) || v < 0) return fallback
  return Math.round(v)
}

// weight/maxLayers/maxStackHeightM are all optional CargoItem fields where
// undefined has its own meaning ("not set" / "no override") distinct from
// any numeric fallback — so an invalid input becomes undefined, never a
// substituted number.
export function sanitizeCargoWeight(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function sanitizeCargoMaxLayers(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

export function sanitizeCargoMaxStackHeightM(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
