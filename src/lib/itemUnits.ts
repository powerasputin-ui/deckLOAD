// A cargo's own figures in another unit of length: its sides, its drawn
// outline and its stability override, the figures stored in the deck's
// unit. Its weight (kg), stack height cap (m), pipe nest (m, mm) and pipe
// bore (mm) don't change with it. Shared by the unit switch and by cargo
// taken over from another calculation, so the two can't drift apart.
import type { CargoItem, StabilityOverride } from './packing'

// stabilityOverride.vcgAboveDeckM/tcgOffsetM/lcgOffsetM are stored in the
// deck's display unit, same as every other length here (see stability.ts's
// buildLoadingConditionFromPlacements, which converts them via toMeters the
// same way it converts placement x/y/width/length) — setUnit used to leave
// them unconverted, silently corrupting a VCG/TCG/LCG override by whatever
// factor separates the old and new units the next time it was used.
export function convStabilityOverride(o: StabilityOverride | undefined, conv: (v: number) => number): StabilityOverride | undefined {
  if (!o) return undefined
  return {
    vcgAboveDeckM: o.vcgAboveDeckM === undefined ? undefined : conv(o.vcgAboveDeckM),
    tcgOffsetM: o.tcgOffsetM === undefined ? undefined : conv(o.tcgOffsetM),
    lcgOffsetM: o.lcgOffsetM === undefined ? undefined : conv(o.lcgOffsetM),
  }
}

export function itemWithConv<I extends CargoItem>(it: I, conv: (v: number) => number): I {
  return {
    ...it,
    width: conv(it.width),
    length: conv(it.length),
    height: conv(it.height),
    outline: it.outline?.map((p) => ({ x: conv(p.x), y: conv(p.y) })),
    stabilityOverride: convStabilityOverride(it.stabilityOverride, conv),
  }
}
