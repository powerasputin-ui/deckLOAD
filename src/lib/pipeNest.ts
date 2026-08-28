// Real ship pipe-stowage ("штабель") geometry — a nest of round pipes
// stowed between the inner bulwark walls, sized by the deck's REAL usable
// width rather than by the minimal footprint-saving base
// `decomposePipePyramid` (packing.ts) uses for a free-standing pile.
// Source: ДВТК/638.362241.034 REV3 "Проект перевозки труб... А. Кузнецов",
// п. 2.1.2, 2.1.3, 2.1.6, 2.1.7 — see each constant/step below for its
// exact provision.
//
// This is domain arithmetic, not packing/collision logic, so it lives in
// its own file rather than growing packing.ts (already ~2800 lines).
//
// Physical picture: the deck's usable width fits `n = floor(usableWidthM /
// OD)` pipes side by side in the BASE row, resting flat on the bearers.
// Each row above nests in the valleys of the row below it, so it holds
// exactly one fewer pipe than the row beneath — n, n-1, n-2, ... — the same
// decreasing-by-one taper `decomposePipePyramid` (packing.ts) uses, but
// seeded from the deck's real usable width instead of a minimal
// footprint-saving base. This is NOT an alternating n/n-1/n/n-1 full-width
// stack: going back UP to a wider row after a narrower one is not
// physically valid nesting — a row wider than the one directly below it has
// no valleys for its outer pipes to rest in, they would hang unsupported.
// The only documented real example (ДВТК Таблица 3 / operator spreadsheet:
// 33 pipes of Ø813 НУБП-72 on a 16.9 m deck) is exactly two rows, 17+16 —
// consistent with either model, but only the taper is physically valid
// for a third row and beyond.

export interface PipeNestRow {
  rowIndex: number // 0 = base row, resting on the bearers
  count: number
  // Horizontal offsets in units of ONE RADIUS, centred on the row's own
  // "natural" (untruncated) count — same contract and same reasoning as
  // packing.ts's PipeRow/decomposePipePyramid: a row short of its natural
  // count (only possible on the LAST row, when pipeCount runs out midway)
  // must still centre on what a full row at that height would hold, or its
  // units stop resting in real valleys of the row below.
  offsets: number[]
  zM: number // this row's centre height above the DECK surface (not above the bearers)
  onDunnage: boolean // true if this row rests flat on an inserted dunnage layer, not nested in valleys
}

export interface DunnageSpec {
  bearerThicknessM: number // п. 2.1.3 — 150×150 mm bearers under the first tier
  bearerCount: number // п. 2.1.3 — "в количестве 6 шт."
  interTierThicknessM: number // п. 2.1.6 — "не менее 80 мм"
  maxTierSpacingM: number // п. 2.1.6 — "не более 0,7 м"
}

// ДВТК п. 2.1.3 / 2.1.6 defaults — real figures from the document, used
// only as defaults a caller can override, never invented for a vessel that
// doesn't specify them.
export const DEFAULT_DUNNAGE: DunnageSpec = {
  bearerThicknessM: 0.15,
  bearerCount: 6,
  interTierThicknessM: 0.08,
  maxTierSpacingM: 0.7,
}

export interface PipeNestSpec {
  pipeOuterDiameterM: number
  pipeLengthM: number
  pipeWeightKg: number // per pipe
  usableWidthM: number // what rowCounts were derived from — detect staleness if the deck width later changes
  rowCounts: number[]
  pipeCount: number // total pipes actually placed (may be less than requested — see `limited`)
  heightM: number // total stack height above the deck surface, bearers included
  vcgAboveDeckM: number // weight-weighted centroid of the nest, above the deck surface
  dunnage?: DunnageSpec
  interTierLayers: number // how many dunnage layers were actually inserted
  limited: boolean // true if maxStackHeightM cut the nest short of the requested pipe count
  requestedPipeCount: number
  sourceNote?: string
}

export interface ComputePipeNestInput {
  pipeOuterDiameterM: number
  pipeLengthM: number
  pipeWeightKg: number
  usableWidthM: number
  // Exactly one of these selects how many pipes to place.
  pipeCount?: number
  rows?: number
  maxStackHeightM?: number // hard stop — п. 2.1.2's 3.0 m, or any other vessel's own limit
  dunnage?: Partial<DunnageSpec>
  // п. 2.1.6 applies to mixed-diameter stacks, or single-diameter stacks
  // where the diameter is ≤280 mm AND stack height exceeds 0.7 m — a
  // real-world judgement call about what's actually being loaded together
  // that this function cannot make on its own. Always a caller decision,
  // never inferred.
  requiresInterTierDunnage?: boolean
  sourceNote?: string
}

const SQRT3_OVER_2 = Math.sqrt(3) / 2

export function pipesPerFullRow(usableWidthM: number, pipeOuterDiameterM: number): number {
  if (!(usableWidthM > 0) || !(pipeOuterDiameterM > 0)) return 0
  return Math.max(0, Math.floor(usableWidthM / pipeOuterDiameterM + 1e-9))
}

export function computePipeNest(input: ComputePipeNestInput): PipeNestSpec {
  const OD = input.pipeOuterDiameterM
  const fullRowCount = pipesPerFullRow(input.usableWidthM, OD)
  const dunnage: DunnageSpec = { ...DEFAULT_DUNNAGE, ...input.dunnage }
  const requestedPipeCount =
    input.pipeCount ?? (input.rows !== undefined ? rowsToPipeCount(input.rows, fullRowCount) : 0)

  const rows: PipeNestRow[] = []
  let placed = 0
  let heightSinceLastDunnage = 0
  let interTierLayers = 0
  let rowIndex = 0
  let limited = false

  while (true) {
    const naturalCount = fullRowCount - rowIndex
    if (naturalCount <= 0) break // usable width too narrow for even one pipe, or the taper has run out
    if (input.rows !== undefined && rowIndex >= input.rows) break
    if (input.rows === undefined && placed >= requestedPipeCount) break

    const remaining = requestedPipeCount - placed
    const count = input.rows !== undefined ? naturalCount : Math.max(0, Math.min(naturalCount, remaining))
    if (count <= 0) break

    let onDunnage = false
    // п. 2.1.6: insert a dunnage layer BEFORE this row if nesting it
    // normally would put the vertical distance since the last dunnage
    // layer (or the bearers) over the 0.7 m limit.
    const nestedPitch = rowIndex === 0 ? OD : OD * SQRT3_OVER_2
    if (input.requiresInterTierDunnage && rowIndex > 0 && heightSinceLastDunnage + nestedPitch > dunnage.maxTierSpacingM) {
      onDunnage = true
      interTierLayers++
      heightSinceLastDunnage = 0
    }

    const pitch = onDunnage ? dunnage.interTierThicknessM + OD : nestedPitch
    const zM = rowIndex === 0 ? dunnage.bearerThicknessM + OD / 2 : rows[rows.length - 1].zM + pitch

    const proposedHeight = zM + OD / 2
    if (input.maxStackHeightM !== undefined && proposedHeight > input.maxStackHeightM + 1e-9) {
      limited = requestedPipeCount > placed || (input.rows !== undefined && rowIndex < input.rows)
      break
    }

    const offsets = Array.from({ length: count }, (_, j) => (j - (naturalCount - 1) / 2) * 2)
    rows.push({ rowIndex, count, offsets, zM, onDunnage })
    placed += count
    heightSinceLastDunnage += rowIndex === 0 ? 0 : nestedPitch
    rowIndex++
  }

  const heightM = rows.length > 0 ? rows[rows.length - 1].zM + OD / 2 : 0
  const totalPipes = rows.reduce((s, r) => s + r.count, 0)
  const vcgAboveDeckM = totalPipes > 0 ? rows.reduce((s, r) => s + r.count * r.zM, 0) / totalPipes : 0

  return {
    pipeOuterDiameterM: OD,
    pipeLengthM: input.pipeLengthM,
    pipeWeightKg: input.pipeWeightKg,
    usableWidthM: input.usableWidthM,
    rowCounts: rows.map((r) => r.count),
    pipeCount: totalPipes,
    heightM,
    vcgAboveDeckM,
    dunnage: input.requiresInterTierDunnage ? dunnage : undefined,
    interTierLayers,
    limited,
    requestedPipeCount,
    sourceNote: input.sourceNote,
  }
}

function rowsToPipeCount(rows: number, fullRowCount: number): number {
  let total = 0
  for (let i = 0; i < rows; i++) total += Math.max(0, fullRowCount - i)
  return total
}
