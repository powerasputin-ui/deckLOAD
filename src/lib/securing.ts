// A stack's securing by the balance of forces of the CSS Code, annex 13
// (IMO, rewritten by MSC.1/Circ.1623, 2020). Decided 2026-11-07: the check
// it replaces took 0.2–0.5 g across the ship (0.68–0.75 g in the annex
// before its corrections), counted every lashing for both sides at once,
// kept the full friction along the ship under a vertical acceleration and
// left out wind, sea and tipping — a 24 t box passed with 8.4 t needed
// against 11 t held, where the annex needs about 331 kN against 119 kN.
//
// What the annex asks, and how it is taken here:
// - Accelerations: its basic data (table 2: L = 100 m, 15 kn, B/GM ≥ 13,
//   unrestricted service), corrected for length and speed (table 3, by the
//   formula the table is made from) and, across the ship only, for B/GM
//   (table 4). Every stack on deck is taken «on deck, high»: that row was
//   checked against two copies of the annex, the «on deck, low» one wasn't,
//   and «high» is the larger — on the safe side. Between the table's
//   columns (0.1 L … 0.9 L from aft) the larger neighbour is taken, between
//   its B/GM columns the factor of the smaller B/GM.
// - Range (2020): 50 ≤ L ≤ 200 m, 9 ≤ v ≤ 24 kn, B/GM ≥ 3. Outside it the
//   tables don't hold, and the accelerations are the user's own (from the
//   vessel's cargo securing manual or the transport's motion study).
// - Forces: Fx = m·ax + Fwx + Fsx, Fy = m·ay + Fwy + Fsy, Fz = m·az, with
//   wind 1 kN/m² on the stack's side and sea sloshing 1 kN/m² on its side
//   up to 2 m above the deck.
// - Balances, each way apart — a lashing holds only while it is pulled:
//     sliding across   Fy ≤ μ·m·g + Σ CS·fy,
//     sliding along    Fx ≤ μ·(m·g − Fz) + Σ CS·fx,
//     tipping across   Fy·a ≤ b·m·g + 0.9·Σ CS·c,
//   CS = MSL / 1.5, fy = μ·sin α + cos α·cos β, fx = μ·sin α + cos α·sin β
//   (α the lashing's angle to the deck, β its angle off the transverse).
//   A lashing steeper than 60° is left out of sliding; one under 45° to the
//   deck and more than 45° off the transverse, out of tipping.
// - Tipping's moment is taken part by part: the inertia at the stack's
//   centre of gravity, the wind at the middle of its side, the sloshing at
//   the middle of its lower 2 m. The lever of a lashing about the edge the
//   stack would tip over: its pull down at its corner's distance from that
//   edge, its pull across at its height on the stack (the corner's
//   distance to the deck anchor times tan α, no higher than the stack).
//
// Sources: MSC/Circ.1026 (sliding and tipping balances, the 0.9, CS =
// MSL/1.5, the length-and-speed formula), TIS-GDV and IUMI commentaries
// (μ·(m·g − Fz), wind and sloshing 1 kN/m², sloshing to 2 m), table 2
// «on deck, high» by CCC 5/INF.10 and the Dutch NeRF copy, table 4 by the
// TIS-GDV copy of the 2020 annex and the Marfag copy (B/GM 7–13). The 2020
// text itself could not be read from here: what it changed beyond table 4
// and the range isn't taken into account.

export const CSS_G = 9.81

// Table 2, «on deck, high», m/s²: across at 0.1 L … 0.9 L from aft, along.
export const CSS_AY_ON_DECK_HIGH = [7.1, 6.9, 6.8, 6.7, 6.7, 6.8, 6.9, 7.1, 7.4] as const
export const CSS_AX_ON_DECK_HIGH = 3.8
// Table 2, vertical, without the static weight, at 0.1 L … 0.9 L from aft.
export const CSS_AZ = [7.6, 6.2, 5.0, 4.3, 4.3, 5.0, 6.2, 7.6, 9.2] as const
// Table 4 (2020), «on deck, high»: B/GM 3 … 12, 1.00 from 13 up.
export const CSS_BGM_FACTOR_ON_DECK_HIGH: readonly (readonly [number, number])[] = [
  [3, 2.64],
  [4, 2.28],
  [5, 1.98],
  [6, 1.74],
  [7, 1.56],
  [8, 1.4],
  [9, 1.27],
  [10, 1.19],
  [11, 1.11],
  [12, 1.05],
  [13, 1.0],
]

export const CSS_RANGE = { lengthM: [50, 200], speedKn: [9, 24], minBOverGM: 3 } as const

export const WIND_PRESSURE_KN_M2 = 1
export const SLOSHING_PRESSURE_KN_M2 = 1
export const SLOSHING_HEIGHT_M = 2
export const CSS_SAFETY_FACTOR = 1.5
export const TIPPING_LASHING_FACTOR = 0.9

// Table 3 as the formula it is made from: 1.00 at 100 m and 15 kn.
export function lengthSpeedFactor(lengthM: number, speedKn: number): number {
  return (0.345 * speedKn) / Math.sqrt(lengthM) + (58.62 * lengthM - 1034.5) / (lengthM * lengthM)
}

// Table 4: the factor of the smaller B/GM between two columns.
export function bOverGmFactor(bOverGm: number): number {
  let factor = CSS_BGM_FACTOR_ON_DECK_HIGH[0][1]
  for (const [ratio, f] of CSS_BGM_FACTOR_ON_DECK_HIGH) if (bOverGm >= ratio) factor = f
  return factor
}

// A table-2 row at a place along the ship (0 aft … 1 forward): the larger of
// the two columns around it; the end columns beyond 0.1 L and 0.9 L. No
// place known — the row's largest.
export function rowAt(row: readonly number[], fraction: number | undefined): number {
  if (fraction === undefined || !Number.isFinite(fraction)) return Math.max(...row)
  const at = Math.min(Math.max(fraction, 0.1), 0.9) * 10 - 1
  const low = Math.floor(at + 1e-9)
  const high = Math.ceil(at - 1e-9)
  return Math.max(row[Math.max(0, low)], row[Math.min(row.length - 1, high)])
}

export interface CssShip {
  lengthM?: number
  breadthM?: number
  speedKn?: number
  gmM?: number
}

// Accelerations in m/s² — the annex's, or the user's own.
export interface Accelerations {
  ax: number
  ay: number
  az: number
}

export type CssAccelerationResult =
  | { status: 'ok'; accelerations: Accelerations; lengthSpeed: number; bOverGm: number; bOverGmFactor: number }
  // What the annex needs and isn't given, in words.
  | { status: 'missing'; missing: string[] }
  // Where the annex's tables don't reach.
  | { status: 'outside'; reason: string }

// The annex's accelerations for a stack at `fraction` of the length from
// aft (undefined — the worst place).
export function cssAccelerations(ship: CssShip, fraction: number | undefined): CssAccelerationResult {
  const missing: string[] = []
  const L = ship.lengthM
  const B = ship.breadthM
  const v = ship.speedKn
  const gm = ship.gmM
  if (!(L !== undefined && L > 0)) missing.push('длина судна')
  if (!(B !== undefined && B > 0)) missing.push('ширина судна')
  if (!(v !== undefined && v > 0)) missing.push('скорость')
  if (!(gm !== undefined && gm > 0)) missing.push('GM')
  if (missing.length > 0) return { status: 'missing', missing }
  const [lMin, lMax] = CSS_RANGE.lengthM
  const [vMin, vMax] = CSS_RANGE.speedKn
  if (L! < lMin || L! > lMax) return { status: 'outside', reason: `длина ${round(L!)} м вне ${lMin}–${lMax} м` }
  if (v! < vMin || v! > vMax) return { status: 'outside', reason: `скорость ${round(v!)} уз вне ${vMin}–${vMax} уз` }
  const bOverGm = B! / gm!
  if (bOverGm < CSS_RANGE.minBOverGM) return { status: 'outside', reason: `B/GM ${round(bOverGm)} меньше ${CSS_RANGE.minBOverGM}` }
  const lengthSpeed = lengthSpeedFactor(L!, v!)
  const factor = bOverGmFactor(bOverGm)
  return {
    status: 'ok',
    accelerations: {
      ax: CSS_AX_ON_DECK_HIGH * lengthSpeed,
      ay: rowAt(CSS_AY_ON_DECK_HIGH, fraction) * lengthSpeed * factor,
      az: rowAt(CSS_AZ, fraction) * lengthSpeed,
    },
    lengthSpeed,
    bOverGm,
    bOverGmFactor: factor,
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}

// One lashing as the balance sees it, in metres on the deck: the stack's
// corner it is made fast to, the deck point it runs to, its MSL and angle.
export interface SecuringLashing {
  cornerX: number
  cornerY: number
  anchorX: number
  anchorY: number
  mslKg: number
  verticalAngleDeg: number
}

export interface SecuringStack {
  massKg: number
  // The footprint, in metres on the deck: x across (port → starboard), y along.
  x: number
  y: number
  width: number
  length: number
  heightM: number
  // The centre of gravity's height above the deck.
  cgHeightM: number
}

// Which way a force pushes the stack: across toward +x (starboard) or −x
// (port), along toward +y or −y.
export type PushDirection = '+x' | '-x' | '+y' | '-y'

export interface Balance {
  kind: 'sliding' | 'tipping'
  toward: PushDirection
  // kN for sliding, kN·m for tipping.
  demand: number
  capacity: number
  ok: boolean
}

export interface SecuringResult {
  forces: { fx: number; fy: number; fz: number }
  balances: Balance[]
  ok: boolean
  // The balance with the least to spare (capacity / demand).
  worst: Balance
}

const DEG = Math.PI / 180

// The six balances of one stack: sliding and tipping to each side, sliding
// to each end.
export function securingBalance(
  stack: SecuringStack,
  lashings: readonly SecuringLashing[],
  a: Accelerations,
  friction: number
): SecuringResult {
  const m = Math.max(0, stack.massKg) / 1000 // t
  const mu = Math.max(0, friction)
  const H = Math.max(0, stack.heightM)
  const sloshH = Math.min(H, SLOSHING_HEIGHT_M)
  // A side across the ship is the stack's length; one along it, its width.
  const windY = WIND_PRESSURE_KN_M2 * stack.length * H
  const slashY = SLOSHING_PRESSURE_KN_M2 * stack.length * sloshH
  const windX = WIND_PRESSURE_KN_M2 * stack.width * H
  const slashX = SLOSHING_PRESSURE_KN_M2 * stack.width * sloshH
  const fy = m * a.ay + windY + slashY
  const fx = m * a.ax + windX + slashX
  const fz = m * a.az
  const weight = m * CSS_G

  const parts = lashings.flatMap((l) => {
    const dx = l.anchorX - l.cornerX
    const dy = l.anchorY - l.cornerY
    const d = Math.hypot(dx, dy)
    if (!(d > 1e-9) || !(l.mslKg > 0)) return []
    const alpha = Math.min(90, Math.max(0, l.verticalAngleDeg)) * DEG
    const cs = (l.mslKg * CSS_G) / 1000 / CSS_SAFETY_FACTOR // kN
    // Its pull in the deck's plane, from the stack toward the anchor.
    const ux = dx / d
    const uy = dy / d
    const heightOnStack = Math.min(H, d * Math.tan(alpha))
    return [{ cs, alpha, ux, uy, heightOnStack, cornerX: l.cornerX }]
  })

  // Sliding: the lashings pulling against the push.
  const sliding = (toward: PushDirection): Balance => {
    const across = toward === '+x' || toward === '-x'
    const sign = toward[0] === '+' ? 1 : -1
    let held = across ? mu * weight : mu * Math.max(0, weight - fz)
    for (const p of parts) {
      const pull = (across ? p.ux : p.uy) * sign
      if (pull >= 0 || p.alpha > 60 * DEG + 1e-12) continue
      held += p.cs * (mu * Math.sin(p.alpha) + Math.cos(p.alpha) * -pull)
    }
    const demand = across ? fy : fx
    return { kind: 'sliding', toward, demand, capacity: held, ok: held >= demand - 1e-9 }
  }

  // Tipping across, over the edge on the side it's pushed to.
  const tipping = (toward: '+x' | '-x'): Balance => {
    const sign = toward === '+x' ? 1 : -1
    const edgeX = toward === '+x' ? stack.x + stack.width : stack.x
    const demand = m * a.ay * stack.cgHeightM + windY * (H / 2) + slashY * (sloshH / 2)
    let held = (stack.width / 2) * weight
    let byLashings = 0
    for (const p of parts) {
      const pull = p.ux * sign
      if (pull >= 0) continue
      // Under 45° to the deck and more than 45° off the transverse: out.
      if (p.alpha < 45 * DEG - 1e-12 && -pull < Math.cos(45 * DEG) - 1e-12) continue
      const fromEdge = Math.abs(edgeX - p.cornerX)
      byLashings += p.cs * (fromEdge * Math.sin(p.alpha) + p.heightOnStack * Math.cos(p.alpha) * -pull)
    }
    held += TIPPING_LASHING_FACTOR * byLashings
    return { kind: 'tipping', toward, demand, capacity: held, ok: held >= demand - 1e-9 }
  }

  const balances = [sliding('+x'), sliding('-x'), tipping('+x'), tipping('-x'), sliding('+y'), sliding('-y')]
  const spare = (b: Balance) => (b.demand > 0 ? b.capacity / b.demand : Infinity)
  const worst = balances.reduce((w, b) => (spare(b) < spare(w) ? b : w))
  return { forces: { fx, fy, fz }, balances, ok: balances.every((b) => b.ok), worst }
}
