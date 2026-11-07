// A self-elevating unit (СПБУ) against its operating manual (spec
// 2026-11-06, 11) — a planning estimate, not the unit's approved loading
// computer, and said so wherever it is shown.
//
// Afloat — a rig move, the legs up — it is a pontoon: the cargo changes the
// draught, and the KG is judged by the manual's allowable KG at the new one:
//   Δ₁ = Δ + P,  KG₁ = (Δ·KG + M) / Δ₁,  T₁ = T + P / (100·TPC).
// Elevated, the hull is out of the water: no stability in a vessel's sense.
// What limits it is the VDL on the legs and the load on each leg. The hull
// is taken as rigid on legs of one stiffness, so a weight w at a point of
// the deck adds w·k_i to leg i, the shares k_i a plane over the legs:
//   k_i = a + b·x_i + c·y_i,  Σk = 1,  Σk·x = x,  Σk·y = y.
// On three legs it is the exact static answer; on four and more, the
// answer with the least sum of squares. The day's leg loads come from the
// unit's report; DeckLoad adds the supply run's static share — wind, waves
// and drilling loads are in the report and in the allowable load, not here.
//
// Cargo leaving and fuel taken aren't subtracted from the leg loads — they
// have no place on the plan — so the loads come out on the safe side. Fuel
// and water brought go where their row says: by a leg, or shared equally at
// the legs' centre; a row that doesn't say leaves the legs unworked — tanks
// by one leg load it far more than an equal share (audit 2026-11-07).
import { kgLimitAt, type SemiSubKgRow, type SemiSubTransfer, type Weight } from './semiSub'
import { fmtNumber } from './utils'

export type JackUpMode = 'afloat' | 'elevated'

export interface JackUpLeg {
  id: string
  name: string
  // From the deck's stern edge and its port edge, m; may lie off the deck.
  fromSternM?: number
  fromPortM?: number
}

export interface JackUpData {
  // Where the unit is for this plan.
  mode: JackUpMode
  afloat: {
    vdlMaxT?: number
    // Tonnes per centimetre of draught.
    tpcTPerCm?: number
    maxDraftM?: number
    // Maximum allowable KG (corrected for free surfaces) by draught.
    kgLimit?: SemiSubKgRow[]
  }
  elevated: {
    vdlMaxT?: number
    vdlStormMaxT?: number
    maxLegLoadT?: number
  }
  legs: JackUpLeg[]
  report: {
    date?: string
    draftM?: number
    displacementT?: number
    kgM?: number
    vdlT?: number
    // By leg id.
    legLoadsT: Record<string, number>
  }
  transfers: SemiSubTransfer[]
}

export const EMPTY_JACK_UP: JackUpData = { mode: 'elevated', afloat: {}, elevated: {}, legs: [], report: { legLoadsT: {} }, transfers: [] }

// A weight at a point of the deck, its centre in deck-local metres.
export interface PlacedWeight extends Weight {
  x: number
  y: number
}

// Each leg's share of a unit load at (x, y): the plane model above, worked
// about the legs' centre so it stays well conditioned. Null when the legs
// can't carry a load determinately — fewer than three, or all on one line.
export function legShares(legs: readonly { x: number; y: number }[], x: number, y: number): number[] | null {
  const n = legs.length
  if (n < 3) return null
  const cx = legs.reduce((s, l) => s + l.x, 0) / n
  const cy = legs.reduce((s, l) => s + l.y, 0) / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const l of legs) {
    const dx = l.x - cx
    const dy = l.y - cy
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  const det = sxx * syy - sxy * sxy
  if (!(sxx > 0 && syy > 0) || det <= 1e-9 * sxx * syy) return null
  const px = x - cx
  const py = y - cy
  const b = (px * syy - py * sxy) / det
  const c = (py * sxx - px * sxy) / det
  return legs.map((l) => 1 / n + b * (l.x - cx) + c * (l.y - cy))
}

// A leg's position on the deck in its own frame: x from the port edge,
// y along the length — from the stern when the bow is at +y.
export function legPoint(leg: JackUpLeg, deck: { lengthM: number; forwardIsPositiveY: boolean }): { x: number; y: number } | null {
  if (leg.fromSternM === undefined || leg.fromPortM === undefined) return null
  return { x: leg.fromPortM, y: deck.forwardIsPositiveY ? leg.fromSternM : deck.lengthM - leg.fromSternM }
}

export type JackUpCheckId = 'jack-vdl' | 'jack-kg' | 'jack-draft' | 'jack-legs'

export interface JackUpCheck {
  id: JackUpCheckId
  title: string
  // As a semi-submersible's (SemiSubCheck).
  status: 'ok' | 'warn' | 'error' | 'none'
  detail: string
}

export interface JackUpLegLoad {
  id: string
  name: string
  reportT?: number
  addedT: number
  afterT?: number
}

export interface JackUpResult {
  mode: JackUpMode
  netT: number
  vdlAfterT?: number
  vdlMaxT?: number
  vdlStormMaxT?: number
  // Afloat.
  draftAfterM?: number
  kgAfterM?: number
  kgMaxM?: number
  maxDraftM?: number
  // Elevated.
  legs?: JackUpLegLoad[]
  maxLegLoadT?: number
  checks: JackUpCheck[]
  // Units arriving with no weight, in none of these figures (the plan's).
  unweighed?: number
}

const t = (v: number) => fmtNumber(Math.round(v))
const m = (v: number) => v.toFixed(2)

export function evaluateJackUp(
  data: JackUpData,
  arriving: readonly PlacedWeight[],
  leaving: readonly Weight[],
  deck: { lengthM: number; forwardIsPositiveY: boolean },
  // The deck's height over the baseline is known (for the KG afloat).
  deckHeightKnown: boolean
): JackUpResult {
  const r = data.report
  const weighed = data.transfers.filter((x) => x.weightT !== undefined && Number.isFinite(x.weightT) && x.weightT !== 0)
  const noHeight = weighed.filter((x) => !(x.vcgM !== undefined && Number.isFinite(x.vcgM)))
  const netT = arriving.reduce((n, w) => n + w.weightT, 0) - leaving.reduce((n, w) => n + w.weightT, 0) + weighed.reduce((n, x) => n + (x.weightT ?? 0), 0)
  const vdlAfterT = r.vdlT !== undefined ? r.vdlT + netT : undefined
  return data.mode === 'afloat'
    ? afloat(data, arriving, leaving, weighed, noHeight, netT, vdlAfterT, deckHeightKnown)
    : elevated(data, arriving, weighed, netT, vdlAfterT, deck)
}

function afloat(
  data: JackUpData,
  arriving: readonly PlacedWeight[],
  leaving: readonly Weight[],
  weighed: readonly SemiSubTransfer[],
  noHeight: readonly SemiSubTransfer[],
  netT: number,
  vdlAfterT: number | undefined,
  deckHeightKnown: boolean
): JackUpResult {
  const r = data.report
  const a = data.afloat
  const momentTm =
    arriving.reduce((n, w) => n + w.weightT * w.vcgM, 0) -
    leaving.reduce((n, w) => n + w.weightT * w.vcgM, 0) +
    weighed.reduce((n, x) => n + (x.weightT ?? 0) * (x.vcgM ?? 0), 0)
  const cargoMoves = arriving.length > 0 || leaving.length > 0

  const vdl: JackUpCheck =
    vdlAfterT === undefined
      ? { id: 'jack-vdl', title: 'VDL', status: 'none', detail: 'Нет VDL из суточного отчёта' }
      : a.vdlMaxT === undefined
        ? { id: 'jack-vdl', title: 'VDL', status: 'none', detail: `${t(vdlAfterT)} т на плаву: предел не задан` }
        : vdlAfterT > a.vdlMaxT + 1e-9
          ? { id: 'jack-vdl', title: 'VDL', status: 'error', detail: `на плаву ${t(vdlAfterT)} т при допустимом ${t(a.vdlMaxT)} т — больше предела` }
          : { id: 'jack-vdl', title: 'VDL', status: 'ok', detail: `на плаву ${t(vdlAfterT)} т при допустимом ${t(a.vdlMaxT)} т` }

  // The new draught: the report's, moved by the run's weight.
  const draftAfterM =
    r.draftM === undefined ? undefined : netT === 0 ? r.draftM : a.tpcTPerCm !== undefined && a.tpcTPerCm > 0 ? r.draftM + netT / (100 * a.tpcTPerCm) : undefined
  const draftMissing = r.draftM === undefined ? 'нет осадки из суточного отчёта' : draftAfterM === undefined ? 'не задан TPC' : undefined

  const delta = r.displacementT ?? 0
  const kgBlocked =
    r.displacementT === undefined || r.kgM === undefined
      ? 'Нет водоизмещения и KG из суточного отчёта'
      : cargoMoves && !deckHeightKnown
        ? 'Не задана высота палубы над основной плоскостью'
        : noHeight.length > 0
          ? `Прочий приход и расход: не задан ЦТ у «${noHeight[0].name || 'строки без названия'}»`
          : undefined
  const after = delta + netT
  const kgAfterM = kgBlocked || !(delta > 0) || !(after > 0) ? undefined : (delta * (r.kgM ?? 0) + momentTm) / after
  const kgMaxM = draftAfterM !== undefined ? kgLimitAt(a.kgLimit, draftAfterM) : undefined
  const kg: JackUpCheck = kgBlocked
    ? { id: 'jack-kg', title: 'KG', status: 'none', detail: kgBlocked }
    : kgAfterM === undefined
      ? { id: 'jack-kg', title: 'KG', status: 'none', detail: 'Водоизмещение после рейса не положительное' }
      : draftMissing
        ? { id: 'jack-kg', title: 'KG', status: 'none', detail: `${m(kgAfterM)} м: ${draftMissing}` }
        : kgMaxM === undefined
          ? { id: 'jack-kg', title: 'KG', status: 'none', detail: `${m(kgAfterM)} м: ${(a.kgLimit ?? []).length === 0 ? 'нет таблицы допустимого KG' : `осадка ${m(draftAfterM!)} м вне таблицы KG`}` }
          : kgAfterM > kgMaxM + 1e-9
            ? { id: 'jack-kg', title: 'KG', status: 'error', detail: `${m(kgAfterM)} м при допустимом ${m(kgMaxM)} м на осадке ${m(draftAfterM!)} м — больше допустимого` }
            : { id: 'jack-kg', title: 'KG', status: 'ok', detail: `${m(kgAfterM)} м при допустимом ${m(kgMaxM)} м на осадке ${m(draftAfterM!)} м` }

  const draft: JackUpCheck =
    draftMissing || draftAfterM === undefined
      ? { id: 'jack-draft', title: 'Осадка', status: 'none', detail: `Не посчитана: ${draftMissing}` }
      : a.maxDraftM === undefined
        ? { id: 'jack-draft', title: 'Осадка', status: 'none', detail: `${m(draftAfterM)} м: наибольшая не задана` }
        : draftAfterM > a.maxDraftM + 1e-9
          ? { id: 'jack-draft', title: 'Осадка', status: 'error', detail: `${m(draftAfterM)} м при наибольшей ${m(a.maxDraftM)} м — больше наибольшей` }
          : { id: 'jack-draft', title: 'Осадка', status: 'ok', detail: `${m(draftAfterM)} м при наибольшей ${m(a.maxDraftM)} м` }

  return {
    mode: 'afloat',
    netT,
    vdlAfterT,
    vdlMaxT: a.vdlMaxT,
    draftAfterM,
    kgAfterM,
    kgMaxM,
    maxDraftM: a.maxDraftM,
    checks: [vdl, kg, draft],
  }
}

function elevated(
  data: JackUpData,
  arriving: readonly PlacedWeight[],
  weighed: readonly SemiSubTransfer[],
  netT: number,
  vdlAfterT: number | undefined,
  deck: { lengthM: number; forwardIsPositiveY: boolean }
): JackUpResult {
  const e = data.elevated
  const r = data.report

  // VDL on the legs, and in a storm when the manual gives its own.
  const vdl: JackUpCheck = (() => {
    const base = { id: 'jack-vdl' as const, title: 'VDL' }
    if (vdlAfterT === undefined) return { ...base, status: 'none', detail: 'Нет VDL из суточного отчёта' }
    if (e.vdlMaxT === undefined) return { ...base, status: 'none', detail: `${t(vdlAfterT)} т на опорах: предел не задан` }
    const parts = [`на опорах ${t(vdlAfterT)} т при допустимом ${t(e.vdlMaxT)} т${vdlAfterT > e.vdlMaxT + 1e-9 ? ' — больше предела' : ''}`]
    if (e.vdlStormMaxT !== undefined)
      parts.push(`в шторм ${t(vdlAfterT)} т при допустимом ${t(e.vdlStormMaxT)} т${vdlAfterT > e.vdlStormMaxT + 1e-9 ? ' — в шторм придётся снимать груз' : ''}`)
    const over = vdlAfterT > e.vdlMaxT + 1e-9 || (e.vdlStormMaxT !== undefined && vdlAfterT > e.vdlStormMaxT + 1e-9)
    return { ...base, status: over ? 'error' : 'ok', detail: parts.join(' · ') }
  })()

  // The legs: where they stand, each one's share of the run's cargo.
  const points = data.legs.map((leg) => legPoint(leg, deck))
  const unplaced = data.legs.find((_, i) => !points[i])
  const shares = (x: number, y: number) => (unplaced ? null : legShares(points as { x: number; y: number }[], x, y))
  const determinate = data.legs.length >= 3 && !unplaced && shares(0, 0) !== null
  const brought = weighed.filter((x) => (x.weightT ?? 0) > 0)
  const legIndex = new Map(data.legs.map((l, i) => [l.id, i]))
  const nowhere = brought.find((x) => x.at !== 'centre' && !(x.at !== undefined && legIndex.has(x.at)))
  const added = data.legs.map(() => 0)
  if (determinate) {
    for (const w of arriving) {
      const k = shares(w.x, w.y)!
      k.forEach((share, i) => (added[i] += w.weightT * share))
    }
    // A row that doesn't say where adds nothing: the legs aren't worked out
    // with it (below), and its share would be a guess.
    for (const x of brought) {
      const i = x.at !== undefined && x.at !== 'centre' ? legIndex.get(x.at) : undefined
      const k = x.at === 'centre' ? data.legs.map(() => 1 / data.legs.length) : i !== undefined ? shares(points[i]!.x, points[i]!.y)! : undefined
      k?.forEach((share, j) => (added[j] += (x.weightT ?? 0) * share))
    }
  }
  const worked = determinate && !nowhere
  const legs: JackUpLegLoad[] = data.legs.map((leg, i) => {
    const reportT = r.legLoadsT[leg.id]
    return { id: leg.id, name: leg.name, reportT, addedT: added[i], afterT: reportT !== undefined && worked ? reportT + added[i] : undefined }
  })
  const legsCheck: JackUpCheck = (() => {
    const base = { id: 'jack-legs' as const, title: 'Нагрузки на опоры' }
    if (data.legs.length === 0) return { ...base, status: 'none', detail: 'Опоры не заданы' }
    if (unplaced) return { ...base, status: 'none', detail: `У опоры «${unplaced.name}» не задано положение` }
    if (!determinate) return { ...base, status: 'none', detail: 'Меньше трёх опор или опоры на одной линии — нагрузки не определить' }
    if (nowhere) return { ...base, status: 'none', detail: `Прочий приход: не указано, где «${nowhere.name || 'строка без названия'}» — у опоры или в центре опор` }
    const noReport = legs.find((l) => l.reportT === undefined)
    if (noReport) return { ...base, status: 'none', detail: `Нет нагрузки на опору «${noReport.name}» из суточного отчёта` }
    const most = legs.reduce((a, b) => ((b.afterT ?? 0) > (a.afterT ?? 0) ? b : a))
    if (e.maxLegLoadT === undefined) return { ...base, status: 'none', detail: `наибольшая — «${most.name}»: ${t(most.afterT!)} т; допустимая не задана` }
    const over = legs.filter((l) => (l.afterT ?? 0) > e.maxLegLoadT! + 1e-9)
    return over.length > 0
      ? { ...base, status: 'error', detail: `${over.map((l) => `«${l.name}» ${t(l.afterT!)} т`).join(', ')} при допустимой ${t(e.maxLegLoadT)} т — больше допустимой` }
      : { ...base, status: 'ok', detail: `наибольшая — «${most.name}»: ${t(most.afterT!)} т при допустимой ${t(e.maxLegLoadT)} т` }
  })()

  return {
    mode: 'elevated',
    netT,
    vdlAfterT,
    vdlMaxT: e.vdlMaxT,
    vdlStormMaxT: e.vdlStormMaxT,
    legs,
    maxLegLoadT: e.maxLegLoadT,
    checks: [vdl, legsCheck],
  }
}
