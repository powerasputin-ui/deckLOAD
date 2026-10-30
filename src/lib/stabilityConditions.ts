// The booklet check (docs/superpowers/specs/2026-10-24-stability-booklet-
// check-design.md): every trip loaded at departure and at arrival — with
// the water trapped in pipe cargo, and ice when the voyage is planned for
// icing — and judged against the vessel's own limit from its approved
// stability booklet. Pure functions over stability.ts; the UI computes none
// of this itself.
//
// The verdict never shows a pass the booklet hasn't given: without a limit,
// GM under the IS Code's general 0.15 m is an error and anything above it a
// warning, not a tick. The KN-curve criteria (checkIMOCriteria) stay an
// estimate shown beside it and never change it.

import { isPipeShape, polygonArea, type CargoItem, type CompositionSegment } from './packing'
import { segmentsOf, stackHeight } from './placementComposition'
import {
  buildCargoWeightMoments,
  cargoMomentArm,
  catalogInMeters,
  checkIMOCriteria,
  computeGZCurve,
  computeLoadingCondition,
  computeStabilityResult,
  G_METACENTRIC_MIN_SAFE,
  knCurvesProblem,
  lightshipMoment,
  placementsInMeters,
  variableWeightsToMoments,
  weightsInState,
  type DeckShipFrame,
  type DeckShipFrameInput,
  type GZCurveResult,
  type LoadingCondition,
  type LoadingState,
  type StabilityCriterion,
  type StabilityLimit,
  type StabilityPlacement,
  type StabilityResult,
  type VesselStabilityData,
  type WeightMoment,
} from './stability'
import { toMeters, type Unit } from './units'

export type StabilityVerdict = 'ok' | 'warn' | 'error'

export interface StabilityReason {
  status: 'warn' | 'error'
  text: string
}

// ---- Water trapped in pipe cargo (IS Code B 2.4) ----

export const SEAWATER_T_PER_M3 = 1.025

// The share of a pipe deck cargo's net volume taken as trapped water: 30 %
// with a freeboard amidships of 0.015 L or less, 10 % at 0.03 L or more,
// linear between. Without a length there is nothing to scale by, and the
// larger share stands.
export function trappedWaterShare(freeboardM: number, lengthM: number): number {
  if (!(lengthM > 0)) return 0.3
  const low = 0.015 * lengthM
  const high = 0.03 * lengthM
  if (freeboardM <= low) return 0.3
  if (freeboardM >= high) return 0.1
  return 0.3 - (0.2 * (freeboardM - low)) / (high - low)
}

// The space between pipes, per pipe, as a share of OD² × length: the square
// round each pipe in flat tiers (a nest — pipeNest.ts stacks tiers flat —
// or one row), the triangle pitch of a pile whose rows sit in the gaps of
// the row below. Voids at the stack's edges aren't counted.
const BETWEEN_FLAT = 1 - Math.PI / 4
const BETWEEN_NESTED = Math.sqrt(3) / 2 - Math.PI / 4

export function isPipeCargo(item: CargoItem): boolean {
  return (item.shape === 'pipe-nest' && !!item.nest) || isPipeShape(item)
}

// The water one stack carries: what the transport project states, plus the
// net volume (inside the pipes and between them) of pipes whose inside
// diameter is known. Pipe cargo with neither is named in `missing`.
export interface StackWater {
  statedKg: number
  netVolumeM3: number
  missing: string[]
}

export function stackWater(
  p: { itemId: string; layers: number; composition?: CompositionSegment[] },
  items: CargoItem[],
  unit: Unit
): StackWater {
  const segs = segmentsOf(p)
  const find = (id: string) => items.find((it) => it.id === id)
  // A pile is nested only when it holds more than one loose pipe — one
  // pipe has nothing beside it.
  const loosePipes = segs.reduce((n, seg) => {
    const it = find(seg.itemId)
    return it && isPipeCargo(it) && it.shape !== 'pipe-nest' ? n + seg.layers : n
  }, 0)
  const water: StackWater = { statedKg: 0, netVolumeM3: 0, missing: [] }
  for (const seg of segs) {
    const it = find(seg.itemId)
    if (!it || !isPipeCargo(it)) continue
    if (it.trappedWaterT !== undefined) {
      water.statedKg += it.trappedWaterT * 1000 * seg.layers
      continue
    }
    if (!it.pipeInnerDiameterMm) {
      if (!water.missing.includes(it.name)) water.missing.push(it.name)
      continue
    }
    const inner = it.pipeInnerDiameterMm / 1000
    const nest = it.shape === 'pipe-nest' ? it.nest : undefined
    const pipes = nest ? nest.pipeCount * seg.layers : seg.layers
    const od = nest ? nest.pipeOuterDiameterM : toMeters(Math.min(it.width, it.length), unit)
    const length = nest ? nest.pipeLengthM : toMeters(Math.max(it.width, it.length), unit)
    const between = nest ? (pipes > 1 ? BETWEEN_FLAT : 0) : loosePipes > 1 ? BETWEEN_NESTED : 0
    water.netVolumeM3 += pipes * length * ((Math.PI / 4) * inner * inner + between * od * od)
  }
  return water
}

// ---- Ice (the 30 and 7.5 kg/m² allowances) ----

export const ICE_DECK_KG_PER_M2 = 30
export const ICE_SIDE_KG_PER_M2 = 7.5
// Rails, booms and rigging: +5 % to the side area, +10 % to its moment.
const ICE_SIDE_AREA_FACTOR = 1.05
const ICE_SIDE_MOMENT_FACTOR = 1.1

export interface IceStack {
  areaM2: number // footprint on the deck
  topM: number // height of its top above the deck
  y0M: number // its extent along the deck
  y1M: number
  tcgM: number
  lcgM: number
}

export interface IceLoad {
  moments: WeightMoment[]
  weightKg: number
  // The vessel's side area or its other exposed decks aren't entered: only
  // the ice on the cargo deck and the cargo is counted.
  missingVesselAreas: boolean
}

export function iceLoad(args: {
  vessel: VesselStabilityData
  shipFrame: DeckShipFrame
  deckForwardIsPositiveY: boolean
  deckAreaM2: number
  deckLengthM: number
  stacks: IceStack[]
  draftM: number
}): IceLoad {
  const { vessel, shipFrame: frame, stacks } = args
  const p = vessel.particulars
  const deckHeight = frame.heightAboveBaselineM
  const moments: WeightMoment[] = []
  const add = (weightKg: number, vcgM: number, tcgM: number, lcgM: number) => {
    if (weightKg > 0) moments.push({ weightKg, vcgM, tcgM, lcgM })
  }
  // Cargo tops carry the deck's ice where they stand; the rest of the
  // cargo deck carries it at deck level.
  for (const s of stacks) add(ICE_DECK_KG_PER_M2 * s.areaM2, deckHeight + s.topM, s.tcgM, s.lcgM)
  const covered = stacks.reduce((sum, s) => sum + s.areaM2, 0)
  add(ICE_DECK_KG_PER_M2 * Math.max(0, args.deckAreaM2 - covered), deckHeight, frame.originOffsetFromCenterlineM, frame.originOffsetFromMidshipsM)

  let missingVesselAreas = false
  if (p.otherExposedDeckAreaM2 === undefined || (p.otherExposedDeckAreaM2 > 0 && p.otherExposedDeckVcgM === undefined)) {
    missingVesselAreas = true
  } else if (p.otherExposedDeckAreaM2 > 0) {
    add(ICE_DECK_KG_PER_M2 * p.otherExposedDeckAreaM2, p.otherExposedDeckVcgM!, 0, p.lightshipLCG)
  }
  // Both sides ice up: the side allowance counts twice, symmetric about the
  // centreline. Its centre's height is given above the waterline.
  const side = (areaM2: number) => 2 * ICE_SIDE_KG_PER_M2 * ICE_SIDE_AREA_FACTOR * areaM2
  const leverFactor = ICE_SIDE_MOMENT_FACTOR / ICE_SIDE_AREA_FACTOR
  if (p.windageAreaM2 === undefined || p.windageLeverM === undefined) missingVesselAreas = true
  else add(side(p.windageAreaM2), args.draftM + p.windageLeverM * leverFactor, 0, p.lightshipLCG)

  // The cargo's own side: its profile along the deck, the tallest stack at
  // each point.
  const profile = cargoProfile(stacks)
  if (profile.areaM2 > 0) {
    const fromMid = profile.centroidYM - args.deckLengthM / 2
    const lcg = frame.originOffsetFromMidshipsM + (args.deckForwardIsPositiveY ? fromMid : -fromMid)
    add(side(profile.areaM2), deckHeight + profile.centroidZM * leverFactor, frame.originOffsetFromCenterlineM, lcg)
  }
  return { moments, weightKg: moments.reduce((sum, m) => sum + m.weightKg, 0), missingVesselAreas }
}

// Area of the cargo's side seen from abeam, and its centre: along the deck,
// the height of the tallest stack covering each stretch.
export function cargoProfile(stacks: { topM: number; y0M: number; y1M: number }[]): { areaM2: number; centroidYM: number; centroidZM: number } {
  const edges = [...new Set(stacks.flatMap((s) => [s.y0M, s.y1M]))].sort((a, b) => a - b)
  let area = 0
  let momentY = 0
  let momentZ = 0
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i]
    const b = edges[i + 1]
    const h = Math.max(0, ...stacks.filter((s) => s.y0M <= a && s.y1M >= b).map((s) => s.topM))
    const strip = h * (b - a)
    area += strip
    momentY += strip * (a + b) / 2
    momentZ += strip * h / 2
  }
  return area > 0 ? { areaM2: area, centroidYM: momentY / area, centroidZM: momentZ / area } : { areaM2: 0, centroidYM: 0, centroidZM: 0 }
}

// ---- Draughts ----

export interface Draughts {
  meanM: number | null // by the hydrostatic table, at LCF
  midM: number | null // amidships: what the load line and freeboard are read at
  foreM: number | null
  aftM: number | null
}

// Fore and aft from the trim (fore minus aft, by the head positive — as
// computeStabilityResult gives it) pivoting on LCF. Without LCF or LBP only
// the table's draught is known.
export function draughtsOf(stability: StabilityResult, vessel: VesselStabilityData): Draughts {
  const mean = stability.draftM
  const lbp = vessel.particulars.lengthBpp
  if (mean === null) return { meanM: null, midM: null, foreM: null, aftM: null }
  if (stability.trimM === null || stability.LCF === undefined || !(lbp > 0)) return { meanM: mean, midM: mean, foreM: null, aftM: null }
  const lcfFromAft = vessel.particulars.longitudinalOrigin === 'aft-perpendicular' ? stability.LCF : lbp / 2 + stability.LCF
  const aft = mean - (stability.trimM * lcfFromAft) / lbp
  const fore = aft + stability.trimM
  return { meanM: mean, midM: (fore + aft) / 2, foreM: fore, aftM: aft }
}

// ---- The booklet's limit ----

export interface LimitAt {
  kind: StabilityLimit['kind']
  // The draught (m) or displacement (kg) the limit is read at, and the
  // table's range of it.
  arg: number
  range: [number, number]
  inRange: boolean
  // The minimum GM it comes to: read off directly, or KM − maximum KG.
  gmMinM: number
}

export function limitAt(limit: StabilityLimit, draftM: number, displacementKg: number, KM: number): LimitAt {
  const rows = [...limit.rows].sort((a, b) => a.arg - b.arg)
  const arg = limit.kind === 'min-gm-by-draft' ? draftM : displacementKg
  const lo = rows[0].arg
  const hi = rows[rows.length - 1].arg
  const eps = 1e-9 * Math.max(1, Math.abs(arg))
  const inRange = arg >= lo - eps && arg <= hi + eps
  let value = arg <= lo ? rows[0].value : rows[rows.length - 1].value
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]
    const b = rows[i + 1]
    if (arg >= a.arg && arg <= b.arg) {
      const span = b.arg - a.arg
      value = span > 0 ? a.value + ((b.value - a.value) * (arg - a.arg)) / span : a.value
      break
    }
  }
  return { kind: limit.kind, arg, range: [lo, hi], inRange, gmMinM: limit.kind === 'min-gm-by-draft' ? value : KM - value }
}

// ---- The deck on the hull ----

// The frame the arithmetic runs on, and what of it wasn't entered. A deck
// off the centreline is rare and 0 the usual, right answer, so an offset
// across left unset is taken as 0 without a word; a height of 0 or less is
// no height at all — older calculations saved 0 for «not entered».
export function resolveShipFrame(frame: DeckShipFrameInput | undefined): { frame: DeckShipFrame; heightMissing: boolean; alongMissing: boolean } {
  const height = frame?.heightAboveBaselineM
  const heightMissing = !(height !== undefined && height > 0)
  return {
    frame: {
      originOffsetFromCenterlineM: frame?.originOffsetFromCenterlineM ?? 0,
      originOffsetFromMidshipsM: frame?.originOffsetFromMidshipsM ?? 0,
      heightAboveBaselineM: heightMissing ? 0 : height,
    },
    heightMissing,
    alongMissing: frame?.originOffsetFromMidshipsM === undefined,
  }
}

export const NO_HYDROSTATICS = 'Нет гидростатики судна'
export const NO_DECK_HEIGHT = 'Не задана высота палубы над килем'

// Why a trip's stability isn't worked out though the vessel's data is
// there, or unset when it is. Without hydrostatics nothing is; without the
// deck's height above the keel nothing lying on the deck is — every tonne
// of cargo or ice would count as lying on the keel, and GM come out metres
// too high (2244 t of pipes on the library vessel: 4.63 m for 1.90 m).
export function stabilityMissing(input: Pick<TripStabilityInput, 'vessel' | 'shipFrame' | 'placements' | 'icing'>): string | undefined {
  if (input.vessel.hydrostatics.points.length === 0) return NO_HYDROSTATICS
  if (resolveShipFrame(input.shipFrame).heightMissing && (input.placements.length > 0 || input.icing)) return NO_DECK_HEIGHT
  return undefined
}

// ---- One state, one trip ----

export interface TripStabilityInput {
  vessel: VesselStabilityData
  shipFrame: DeckShipFrameInput
  deck: { width: number; length: number; unit: Unit; outline?: { x: number; y: number }[] }
  deckForwardIsPositiveY: boolean
  placements: (StabilityPlacement & { itemId: string })[]
  items: CargoItem[]
  icing: boolean
}

export interface StateStability {
  state: LoadingState
  // The vessel with this state's tanks, and the loading it came to — what
  // the KN reference (computeGZCurve) reads.
  vessel: VesselStabilityData
  loading: LoadingCondition
  stability: StabilityResult
  draughts: Draughts
  // The water trapped in pipe cargo and the ice, and the heights of their
  // centres above the keel (unset when there is none).
  waterKg: number
  waterVcgM?: number
  iceKg: number
  iceVcgM?: number
  limit?: LimitAt
  verdict: StabilityVerdict
  reasons: StabilityReason[]
}

const m2 = (v: number) => v.toFixed(2)
const tonnes = (kg: number) => String(Math.round(kg / 1000))

// The height of the centre of a set of weights, when there is any weight.
function vcgOf(moments: WeightMoment[]): number | undefined {
  const weight = moments.reduce((sum, m) => sum + m.weightKg, 0)
  return weight > 0 ? moments.reduce((sum, m) => sum + m.weightKg * m.vcgM, 0) / weight : undefined
}

// Units on the deck the stability arithmetic can't weigh: a stack whose
// weight isn't given, or the layers of a composed stack whose cargo has none.
export function weightlessUnits(placements: TripStabilityInput['placements'], items: CargoItem[]): number {
  return placements.reduce((n, p) => {
    if (!p.composition) return n + ((p.weight ?? 0) > 0 ? 0 : p.layers)
    return n + p.composition.filter((seg) => !((items.find((it) => it.id === seg.itemId)?.weight ?? 0) > 0)).reduce((sum, seg) => sum + seg.layers, 0)
  }, 0)
}

function evaluateState(input: TripStabilityInput, state: LoadingState): StateStability | null {
  const vessel: VesselStabilityData = { ...input.vessel, variableWeights: weightsInState(input.vessel, state) }
  const { frame, alongMissing } = resolveShipFrame(input.shipFrame)
  const fwd = input.deckForwardIsPositiveY
  const unit = input.deck.unit
  const deckW = toMeters(input.deck.width, unit)
  const deckL = toMeters(input.deck.length, unit)
  const placementsM = placementsInMeters(input.placements, unit)
  const itemsM = catalogInMeters(input.items, unit)
  const lightship = lightshipMoment(vessel)
  const variable = variableWeightsToMoments(vessel.variableWeights)
  const cargo = buildCargoWeightMoments(placementsM, deckW, deckL, frame, fwd, itemsM)
  let loading: LoadingCondition = computeLoadingCondition(lightship, [...variable, ...cargo])
  const load = (extra: WeightMoment[]) => {
    loading = computeLoadingCondition(lightship, [...variable, ...cargo, ...extra])
    return computeStabilityResult(vessel, loading)
  }

  const stacks = input.placements.map((p, i) => {
    const pm = placementsM[i]
    const arm = cargoMomentArm(pm, deckW, deckL, frame, fwd, itemsM)
    return {
      water: stackWater(p, input.items, unit),
      arm,
      ice: {
        areaM2: pm.outline && pm.outline.length >= 3 ? polygonArea(pm.outline) : pm.width * pm.length,
        topM: stackHeight(segmentsOf(pm as { itemId: string; layers: number; composition?: CompositionSegment[] }), itemsM),
        y0M: pm.y,
        y1M: pm.y + pm.length,
        tcgM: arm.tcgM,
        lcgM: arm.lcgM,
      } satisfies IceStack,
    }
  })
  const outlineM = input.deck.outline && input.deck.outline.length >= 3 ? input.deck.outline.map((pt) => ({ x: toMeters(pt.x, unit), y: toMeters(pt.y, unit) })) : undefined
  const deckAreaM2 = outlineM ? polygonArea(outlineM) : deckW * deckL
  const length = vessel.particulars.loadLineLengthM ?? vessel.particulars.lengthBpp
  const withIce = state === 'arrival' && input.icing

  // The water's share hangs on the freeboard, and the water itself sinks
  // the ship: repeat until its weight settles.
  let stability = load([])
  if (!stability) return null
  let waterKg = 0
  let iceKg = 0
  let ice: IceLoad | null = null
  let waterMoments: WeightMoment[] = []
  for (let pass = 0; pass < 10; pass++) {
    const draft = draughtsOf(stability, vessel).midM ?? 0
    const share = trappedWaterShare(frame.heightAboveBaselineM - draft, length)
    const water = stacks
      .map((s) => ({ weightKg: s.water.statedKg + s.water.netVolumeM3 * share * SEAWATER_T_PER_M3 * 1000, ...s.arm }))
      .filter((w) => w.weightKg > 0)
    ice = withIce
      ? iceLoad({ vessel, shipFrame: frame, deckForwardIsPositiveY: fwd, deckAreaM2, deckLengthM: deckL, stacks: stacks.map((s) => s.ice), draftM: draft })
      : null
    const nextWater = water.reduce((sum, w) => sum + w.weightKg, 0)
    const nextIce = ice?.weightKg ?? 0
    const next = load([...water, ...(ice?.moments ?? [])])
    if (!next) return null
    stability = next
    waterMoments = water
    const settled = Math.abs(nextWater - waterKg) < 100 && Math.abs(nextIce - iceKg) < 100
    waterKg = nextWater
    iceKg = nextIce
    if (settled) break
  }

  const draughts = draughtsOf(stability, vessel)
  const draftAt = draughts.midM ?? draughts.meanM ?? 0
  const gm = stability.GM_fluid
  const errors: string[] = []
  const warnings: string[] = []
  if (gm < G_METACENTRIC_MIN_SAFE) errors.push(`GM ${m2(gm)} м ниже общего минимума ${G_METACENTRIC_MIN_SAFE} м`)
  // A table emptied while it's being edited is no limit yet.
  const limit = vessel.limit && vessel.limit.rows.length > 0 ? limitAt(vessel.limit, draftAt, stability.displacementKg, stability.KM) : undefined
  if (!limit) warnings.push('Предел по формуляру не задан')
  else if (!limit.inRange)
    warnings.push(
      limit.kind === 'min-gm-by-draft'
        ? `Осадка ${m2(limit.arg)} м вне таблицы предела (${m2(limit.range[0])}–${m2(limit.range[1])} м)`
        : `Водоизмещение ${tonnes(limit.arg)} т вне таблицы предела (${tonnes(limit.range[0])}–${tonnes(limit.range[1])} т)`
    )
  else if (gm < limit.gmMinM)
    errors.push(
      `GM ${m2(gm)} м ниже предела ${m2(limit.gmMinM)} м при ${limit.kind === 'min-gm-by-draft' ? `осадке ${m2(limit.arg)} м` : `водоизмещении ${tonnes(limit.arg)} т`}`
    )
  const maxDraft = vessel.particulars.maxDraftM
  if (maxDraft !== undefined) {
    // Past the table's heaviest row the draught is that row's own, so a
    // table ending at the mark never showed a draught over it, however
    // heavy the ship: judged by displacement there instead.
    const top = vessel.hydrostatics.points.reduce((a, b) => (b.displacementKg > a.displacementKg ? b : a))
    if (stability.displacementKg > top.displacementKg) {
      if (top.draftM >= maxDraft - 1e-9)
        errors.push(`Водоизмещение ${tonnes(stability.displacementKg)} т больше, чем при осадке по грузовой марке ${m2(maxDraft)} м`)
      else
        warnings.push(`Осадку по грузовой марке не проверить: таблица гидростатики кончается на осадке ${m2(top.draftM)} м, марка — ${m2(maxDraft)} м`)
    } else if (draughts.midM !== null && draughts.midM > maxDraft + 1e-9)
      errors.push(`Осадка ${m2(draughts.midM)} м больше предельной ${m2(maxDraft)} м по грузовой марке`)
  }
  if (stability.extrapolated) warnings.push(`Водоизмещение ${tonnes(stability.displacementKg)} т вне таблицы гидростатики — числа оценочные`)
  // Where the deck stands along the hull only moves the cargo's LCG — the
  // trim, and the draughts at the ends. «0 from midships» is a real place,
  // so only an offset never entered is said.
  if (alongMissing && input.placements.length > 0 && stability.trimM !== null)
    warnings.push('Положение палубы по длине судна не задано — дифферент и осадки носом и кормой неточны')
  if (input.vessel.variableWeights.length === 0 && (input.vessel.arrivalWeights ?? []).length === 0) warnings.push('Танки и запасы не заданы')
  // An empty free-surface moment means a pressed-full or empty tank, but a
  // state with none on any tank is most likely one where they weren't
  // entered — and every slack tank lowers GM. A 0 on one tank says it was.
  if (vessel.variableWeights.length > 0 && vessel.variableWeights.every((w) => w.freeSurfaceMomentTm === undefined))
    warnings.push('Ни у одного танка не задан момент свободной поверхности — GM может быть завышена')
  const weightless = weightlessUnits(input.placements, input.items)
  if (weightless > 0) warnings.push(`Груз без веса не учтён: ${weightless} ед.`)
  const missing = [...new Set(stacks.flatMap((s) => s.water.missing))]
  for (const name of missing) warnings.push(`Вода в трубах «${name}» не учтена: нет внутреннего диаметра`)
  if (vessel.particulars.loadLineLengthM === undefined && stacks.some((s) => s.water.netVolumeM3 > 0))
    warnings.push('Длина L по грузовой марке не задана — для воды в трубах взята LBP')
  if (ice?.missingVesselAreas) warnings.push('Для обледенения не заданы боковая площадь судна или площадь прочих открытых палуб')

  const reasons: StabilityReason[] = [
    ...errors.map((text) => ({ status: 'error' as const, text })),
    ...warnings.map((text) => ({ status: 'warn' as const, text })),
  ]
  return {
    state,
    vessel,
    loading,
    stability,
    draughts,
    waterKg,
    waterVcgM: vcgOf(waterMoments),
    iceKg,
    iceVcgM: vcgOf(ice?.moments ?? []),
    limit,
    verdict: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'ok',
    reasons,
  }
}

export interface TripStabilityResult {
  departure: StateStability
  arrival: StateStability
  verdict: StabilityVerdict
  // The state the trip is judged by: the worse verdict, then the smaller
  // margin of GM over its limit.
  worst: StateStability
  // Every reason once, with the states that have it.
  reasons: (StabilityReason & { states: LoadingState[] })[]
  // Arrival has no tanks of its own and no ice: it is departure again.
  arrivalSameAsDeparture: boolean
}

const RANK: Record<StabilityVerdict, number> = { ok: 0, warn: 1, error: 2 }

// GM over what it's judged against: the booklet's minimum where the table
// covers the draught, the general 0.15 m otherwise.
export function gmMargin(s: StateStability): number {
  return s.stability.GM_fluid - (s.limit?.inRange ? s.limit.gmMinM : G_METACENTRIC_MIN_SAFE)
}

export function evaluateTripStability(input: TripStabilityInput): TripStabilityResult | undefined {
  if (stabilityMissing(input)) return undefined
  const departure = evaluateState(input, 'departure')
  const arrival = evaluateState(input, 'arrival')
  if (!departure || !arrival) return undefined
  const worst =
    RANK[arrival.verdict] > RANK[departure.verdict] ||
    (RANK[arrival.verdict] === RANK[departure.verdict] && gmMargin(arrival) < gmMargin(departure))
      ? arrival
      : departure
  const reasons: TripStabilityResult['reasons'] = []
  for (const s of [departure, arrival]) {
    for (const r of s.reasons) {
      const same = reasons.find((x) => x.status === r.status && x.text === r.text)
      if (same) same.states.push(s.state)
      else reasons.push({ ...r, states: [s.state] })
    }
  }
  reasons.sort((a, b) => RANK[b.status] - RANK[a.status])
  return {
    departure,
    arrival,
    verdict: worst.verdict,
    worst,
    reasons,
    arrivalSameAsDeparture: !input.vessel.arrivalWeights && !input.icing,
  }
}

// The KN-curve reference of one state: its GZ curve, and the criteria of the
// set the vessel names. An estimate shown beside the verdict, never part of
// it. Unset without usable KN curves.
export function knReference(s: StateStability): { gz: GZCurveResult; criteria: StabilityCriterion[] } | null {
  const kn = s.vessel.knCurves
  if (!kn || knCurvesProblem(kn) !== null) return null
  const gz = computeGZCurve(s.vessel, s.loading)
  if (!gz) return null
  const { downfloodingAngleDeg, criteriaSet } = s.vessel.particulars
  return { gz, criteria: checkIMOCriteria(gz, s.stability, downfloodingAngleDeg, criteriaSet) }
}

export const STATE_LABEL: Record<LoadingState, string> = { departure: 'Отход', arrival: 'Приход' }

// Said beside every result, in the workspace and in the PDF (spec 6.1, 7).
export const STABILITY_DISCLAIMER = 'Оценка по введённым данным. Не заменяет одобренную Информацию об остойчивости и прибор загрузки судна.'

// What the check doesn't cover (spec section 9).
export const NOT_CHECKED = [
  'критерий погоды и, для судов снабжения, альтернативные критерии администрации — учтены, только если учтены в введённом пределе',
  'аварийная остойчивость',
  'общая прочность корпуса',
  'плотность забортной воды, отличная от 1,025 т/м³',
  'пределы по нескольким дифферентам — вводится один столбец',
  'угол заливания по осадке — вводится одно число',
]

// A reason after what it's about — «Приход: …», «Рейс 2, приход: …». Its
// first word goes lower case unless it's an abbreviation (GM).
export function prefixedReason(prefix: string, text: string): string {
  if (!prefix) return text
  const abbreviation = text.length > 1 && text[1] !== text[1].toLowerCase()
  return `${prefix}: ${abbreviation ? text : text[0].toLowerCase() + text.slice(1)}`
}

// A reason as one line: «Приход: …» when only one state has it.
export function reasonText(r: { text: string; states: LoadingState[] }): string {
  return prefixedReason(r.states.length === 1 ? STATE_LABEL[r.states[0]] : '', r.text)
}
