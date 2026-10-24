// Why a stack can't be put on the deck at a point (spec 7.1): the click and
// the shadow under the cursor ask this one function, so the shadow turns red
// for exactly the reason a click would be refused. Kept out of the deck view
// so it can be tested on its own.

import {
  collidesPrecisely,
  collidesWithClearance,
  edgeDistance,
  lashingPointExclusionRects,
  rectInsidePolygon,
  restrictionZoneExclusions,
  type ClearanceMargin,
  type CargoShape,
  type RestrictionZone,
  type SeparationRule,
} from './packing'
import { fmtNumber } from './utils'

type Point = { x: number; y: number }

// The stack about to be put down, where it would stand.
export interface PlacementTarget {
  x: number
  y: number
  width: number
  length: number
  rotated?: boolean
  outline?: Point[]
  category?: string
}

// A stack already on the deck.
export interface PlacementNeighbour {
  x: number
  y: number
  width: number
  length: number
  rotated?: boolean
  outline?: Point[]
  clearanceMargin?: ClearanceMargin
  shape?: CargoShape
  height?: number
  stackedCount?: number
  category?: string
}

export interface PlacementSurroundings {
  others: PlacementNeighbour[]
  // Spacing between stacks, in the deck's unit.
  gap: number
  // The deck's own outline less the board offset, when it isn't a rectangle.
  usableOutline?: Point[]
  lashingPoints?: Point[]
  restrictionZones?: RestrictionZone[]
  // Minimum distances in the deck's unit.
  separationRules?: SeparationRule[]
  unitLabel: string
}

// The reason, starting with a small letter — «Здесь нельзя — …» in a
// toast, capitalised next to the shadow — or null when the stack can go
// there. Checked in the order the click always checked them.
export function placementProblem(target: PlacementTarget, around: PlacementSurroundings): string | null {
  const { others, gap } = around
  if (collidesPrecisely(target, others, gap)) return 'место занято другим грузом'
  if (around.usableOutline && !rectInsidePolygon(target, around.usableOutline)) return 'груз выходит за пределы палубы'
  if (collidesWithClearance(target, others, gap)) return 'зона отступа другого груза'
  if (around.lashingPoints?.length && collidesPrecisely(target, lashingPointExclusionRects(around.lashingPoints, gap), gap)) {
    return 'рядом точка крепления'
  }
  if (around.restrictionZones?.length) {
    const zone = restrictionZoneExclusions(around.restrictionZones).find((z) => collidesPrecisely(target, [z], gap))
    if (zone) return `препятствие «${zone.name}»`
  }
  const separation = separationProblem(target, others, around.separationRules, around.unitLabel)
  if (separation) return separation
  return null
}

// The first rule the stack would break, named with its categories and
// distance.
function separationProblem(
  target: PlacementTarget,
  others: PlacementNeighbour[],
  rules: SeparationRule[] | undefined,
  unitLabel: string
): string | null {
  if (!rules?.length || !target.category) return null
  const eps = 1e-9
  for (const other of others) {
    if (!other.category) continue
    const rule = rules.find(
      (r) =>
        (r.categoryA === target.category && r.categoryB === other.category) ||
        (r.categoryB === target.category && r.categoryA === other.category)
    )
    if (rule && edgeDistance(target, other) < rule.minDistance - eps) {
      return `нарушена сепарация груза: «${target.category}» и «${other.category}» ближе ${fmtNumber(rule.minDistance)} ${unitLabel}`
    }
  }
  return null
}

// The reason as it stands on its own, next to the shadow.
export function capitalised(reason: string): string {
  return reason.charAt(0).toLocaleUpperCase('ru') + reason.slice(1)
}
