// Real ship pipe-stowage ("штабель") geometry.
//
// Source: ДВТК/638.362241.023 REV3 "Проект перевозки труб... А. Кузнецов"
// (2024 revision), п. 2.1.2/2.1.3 and Приложение А, лист 9, сечение А-А —
// see each constant/step below for its exact provision.
//
// This is domain arithmetic, not packing/collision logic, so it lives in
// its own file rather than growing packing.ts (already ~2800 lines).
//
// ---- The physical picture, corrected from an earlier draft ----
//
// An earlier version of this file modelled a triangular VALLEY-NESTED pile
// (each tier one pipe narrower than the one below, offset by half a
// diameter — the same shape decomposePipePyramid already uses for a
// free-standing pile of loose pipes). That shape does NOT match how this
// vessel actually stows pipe: the real drawing (ДВТК/638.362241.023,
// лист 9, сечение А-А) shows every tier holding the SAME number of pipes,
// stacked DIRECTLY ABOVE the tier below — a straight rectangular column,
// not a pyramid. The document's own text confirms this is the rule, not
// an exception for that one drawing: п. 2.1.2 — "Трубы укладываются на
// грузовую палубу в 3 штабеля В ДВА ЯРУСА" (always two tiers, never more).
//
// The same drawing also shows the first tier resting on a substantial
// timber CRIB ("Клетка", брус 150×150), dimensioned "1000" (mm) tall —
// not the thin single-board "прокладка" (a separate, thinner timber layer
// drawn ON TOP of the crib, between tiers) an earlier draft assumed. That
// 1.0 m figure is real only for the drawn scheme (Ø813 pipe, 130 mm
// concrete coating, OD ≈ 1.073 m) — the drawing gives no evidence it is
// the crib height for every pipe diameter, so it is NOT treated as a
// universal constant here (see REAL_CRATE_HEIGHT_M_OD1073M below).
//
// Physical picture: the deck's usable width fits `pipesPerRow =
// floor(usableWidthM / OD)` pipes side by side in EVERY tier (same count,
// same horizontal positions, tier after tier), resting on a crib of height
// `crateHeightM`. Total height = crateHeightM + tiers × OD; there is no
// √3/2 nesting pitch, because tiers do not nest — they stack flat.

export interface PipeNestSpec {
  pipeOuterDiameterM: number
  pipeLengthM: number
  pipeWeightKg: number // per pipe
  usableWidthM: number // what pipesPerRow was derived from — detect staleness if the deck width later changes
  pipesPerRow: number
  // One entry per tier, bottom to top — normally all equal to `pipesPerRow`
  // except possibly the LAST tier, which is only partial when the
  // requested pipe count doesn't fill it completely.
  tierCounts: number[]
  pipeCount: number // total pipes actually placed (may be less than requested — see `limited`)
  heightM: number // total stack height above the deck surface, crib included
  vcgAboveDeckM: number // centroid of the (uniform-column) stack, above the deck surface
  crateHeightM: number // the timber crib height used for this nest
  limited: boolean // true if maxStackHeightM cut the nest short of the requested tiers/pipe count
  requestedPipeCount: number
  requestedTiers: number
  sourceNote?: string
}

export interface ComputePipeNestInput {
  pipeOuterDiameterM: number
  pipeLengthM: number
  pipeWeightKg: number
  usableWidthM: number
  // Provide at most one of these — pipeCount implies tiers = ceil(pipeCount
  // / pipesPerRow); tiers implies pipeCount = tiers * pipesPerRow. Neither
  // given defaults to the document's own stated rule: exactly 2 tiers
  // (п. 2.1.2 — "в 3 штабеля в два яруса").
  pipeCount?: number
  tiers?: number
  maxStackHeightM?: number // hard stop — п. 2.1.2's 3.0 m, or any other vessel's own limit
  // Height of the timber crib the first tier rests on. Defaults to
  // DEFAULT_CRATE_HEIGHT_M — an ESTIMATE, not a drawing-sourced figure,
  // since the only real measurement on file (REAL_CRATE_HEIGHT_M_OD1073M)
  // is for one specific pipe diameter. Pass that constant explicitly when
  // modelling that exact scheme; otherwise this is a placeholder pending a
  // real measurement for the diameter in question.
  crateHeightM?: number
  sourceNote?: string
}

// The document's own DEFAULT tier count when neither pipeCount nor tiers
// is specified — п. 2.1.2: every stack on this vessel uses exactly two
// tiers, never a taller pile.
export const DEFAULT_TIERS = 2

// Real — ДВТК/638.362241.023 REV3, лист 9, сечение А-А, dimension "1000"
// against the "Клетка брус 150х150" crib, drawn for the Ø813×30.2 pipe with
// 130 mm concrete coating (OD = 813 + 2×130 = 1073 mm). This is the ONLY
// crib height actually measured on a real drawing in this codebase — do
// not reuse it for other pipe diameters without separate evidence.
export const REAL_CRATE_HEIGHT_M_OD1073M = 1.0

// A generic placeholder crib height for diameters with no drawing
// evidence. Deliberately modest (a single 150 mm timber layer) rather than
// reusing the one real 1.0 m figure, which would silently overstate a
// small pipe's crib and understate a stack's usable height budget just as
// easily as it might understate a large one's. Callers that know the real
// figure for their scheme should pass it explicitly via `crateHeightM`.
export const DEFAULT_CRATE_HEIGHT_M = 0.15

export function pipesPerFullRow(usableWidthM: number, pipeOuterDiameterM: number): number {
  if (!(usableWidthM > 0) || !(pipeOuterDiameterM > 0)) return 0
  return Math.max(0, Math.floor(usableWidthM / pipeOuterDiameterM + 1e-9))
}

// Horizontal offsets (radius units) for a tier of `count` pipes, centred
// within `pipesPerRow` slots — NOT centred on `count` itself, so a partial
// top tier's pipes stay directly above the same-position pipes in the
// tier below (straight stacking), rather than sliding to the middle.
export function pipeNestTierOffsets(pipesPerRow: number, count: number): number[] {
  return Array.from({ length: Math.max(0, Math.min(count, pipesPerRow)) }, (_, j) => (j - (pipesPerRow - 1) / 2) * 2)
}

export function computePipeNest(input: ComputePipeNestInput): PipeNestSpec {
  const OD = input.pipeOuterDiameterM
  const pipesPerRow = pipesPerFullRow(input.usableWidthM, OD)
  const crateHeightM = input.crateHeightM ?? DEFAULT_CRATE_HEIGHT_M

  const requestedTiers =
    input.tiers ?? (input.pipeCount !== undefined && pipesPerRow > 0 ? Math.max(1, Math.ceil(input.pipeCount / pipesPerRow)) : DEFAULT_TIERS)
  const requestedPipeCount = input.pipeCount ?? pipesPerRow * requestedTiers

  const tierCounts: number[] = []
  let placed = 0
  let limited = false

  for (let tierIndex = 0; tierIndex < requestedTiers; tierIndex++) {
    if (pipesPerRow <= 0 || placed >= requestedPipeCount) break
    const proposedHeight = crateHeightM + (tierIndex + 1) * OD
    if (input.maxStackHeightM !== undefined && proposedHeight > input.maxStackHeightM + 1e-9) {
      limited = true
      break
    }
    const count = Math.min(pipesPerRow, requestedPipeCount - placed)
    if (count <= 0) break
    tierCounts.push(count)
    placed += count
  }

  const tiers = tierCounts.length
  const heightM = tiers > 0 ? crateHeightM + tiers * OD : 0
  // Every tier weighs the same (equal pipe count, equal diameter), so the
  // uniform-column centroid — crib height plus half the stacked pipe
  // height — is exact here, not an approximation the way it would be for
  // a tapering pile.
  const vcgAboveDeckM = tiers > 0 ? crateHeightM + (tiers * OD) / 2 : 0

  return {
    pipeOuterDiameterM: OD,
    pipeLengthM: input.pipeLengthM,
    pipeWeightKg: input.pipeWeightKg,
    usableWidthM: input.usableWidthM,
    pipesPerRow,
    tierCounts,
    pipeCount: placed,
    heightM,
    vcgAboveDeckM,
    crateHeightM,
    limited,
    requestedPipeCount,
    requestedTiers,
    sourceNote: input.sourceNote,
  }
}
