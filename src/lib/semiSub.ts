// A semi-submersible drilling unit (ППБУ) against its operating manual
// (spec 2026-11-06, 7) — a planning estimate, not the unit's approved
// loading computer, and said so wherever it is shown.
//
// What the manual gives, per mode (operating, survival): the draught, the
// displacement at it, the variable deck load (VDL) allowed, and the maximum
// allowable KG — corrected for free surfaces — by draught: the curves the
// MODU Code's criteria (wind from any direction, 70 kn operating, 100 kn
// survival, damage at 50 kn) were worked into. What the day gives: the
// unit's daily report — draught, displacement, KG, VDL, ballast on board.
//
// The draught is held by ballast: what the supply run brings, the unit
// pumps out as ballast from its pontoons, and what it takes away is
// ballasted in. The displacement stays; the KG moves by the cargo's height
// over the ballast's:
//   KG₁ = (Δ·KG + M − P·z_b) / Δ,  VDL₁ = VDL + P,
// P the net weight (arriving − leaving), M its moment over the baseline, z_b
// the ballast's height. Going to the survival draught pumps out Δ − Δшт more
// at the same height — the cargo stays where it is, as the rules want:
//   KGшт = (Δ·KG₁ − (Δ − Δшт)·z_b) / Δшт.
//
// Simplified on purpose (spec 7.4): free surfaces as in the report, ballast
// from one height, no riser or mooring change on the way to survival, list
// and trim left to the ballast.
import { fmtNumber } from './utils'

export interface SemiSubKgRow {
  draftM: number
  kgMaxM: number
}

export interface SemiSubMode {
  draftM?: number
  displacementT?: number
  vdlMaxT?: number
  // Maximum allowable KG (corrected for free surfaces) by draught.
  kgLimit?: SemiSubKgRow[]
}

export interface SemiSubReport {
  // ISO date of the report.
  date?: string
  draftM?: number
  displacementT?: number
  // Corrected for free surfaces, as the unit's computer gives it.
  kgM?: number
  vdlT?: number
  ballastT?: number
}

// Fuel, water, bulk brought or taken by the supply run: + arriving, − leaving.
// A row just added has neither figure: nothing is assumed for it.
export interface SemiSubTransfer {
  id: string
  name: string
  weightT?: number
  vcgM?: number
  // A jack-up's only (jackUp.ts): where what's brought stands — by a leg (its
  // id), or 'centre' of the legs, shared equally. Unset — not said, and its
  // legs aren't worked out.
  at?: string
}

export interface SemiSubData {
  operating: SemiSubMode
  survival: SemiSubMode
  // Height over the baseline of the ballast pumped out or in.
  ballastVcgM?: number
  report: SemiSubReport
  transfers: SemiSubTransfer[]
}

export const EMPTY_SEMI_SUB: SemiSubData = { operating: {}, survival: {}, report: {}, transfers: [] }

// A weight and its centre's height over the baseline.
export interface Weight {
  weightT: number
  vcgM: number
}

// A report's draught is rounded: a row of the table counts for draughts
// this close to it, and the table's ends reach this far out.
const DRAFT_TOLERANCE_M = 0.05

// The allowable KG at a draught: linear between rows; outside the table —
// no limit to judge by (undefined), never an extrapolation.
export function kgLimitAt(rows: readonly SemiSubKgRow[] | undefined, draftM: number): number | undefined {
  const sorted = (rows ?? []).filter((r) => Number.isFinite(r.draftM) && Number.isFinite(r.kgMaxM)).sort((a, b) => a.draftM - b.draftM)
  if (sorted.length === 0 || !Number.isFinite(draftM)) return undefined
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (draftM < first.draftM - DRAFT_TOLERANCE_M || draftM > last.draftM + DRAFT_TOLERANCE_M) return undefined
  if (draftM <= first.draftM) return first.kgMaxM
  if (draftM >= last.draftM) return last.kgMaxM
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]
    const b = sorted[i]
    if (draftM <= b.draftM) return a.kgMaxM + ((draftM - a.draftM) / (b.draftM - a.draftM)) * (b.kgMaxM - a.kgMaxM)
  }
  return undefined
}

export type SemiSubCheckId = 'semi-vdl' | 'semi-kg' | 'semi-ballast'

export interface SemiSubCheck {
  id: SemiSubCheckId
  title: string
  // ✓ only when both modes are judged; ✕ when either is over; «—» else; ⚠
  // when judged without some arriving cargo, which has no weight.
  status: 'ok' | 'warn' | 'error' | 'none'
  detail: string
}

export interface SemiSubResult {
  // Net weight of the supply run, t (arriving − leaving), and its moment
  // over the baseline, t·m.
  netT: number
  momentTm: number
  vdlAfterT?: number
  vdlMaxOperatingT?: number
  vdlMaxSurvivalT?: number
  kgOperatingM?: number
  kgOperatingMaxM?: number
  kgSurvivalM?: number
  kgSurvivalMaxM?: number
  // Ballast left after the run's compensation, and after going to survival.
  ballastAfterT?: number
  ballastSurvivalT?: number
  checks: SemiSubCheck[]
  // Units arriving with no weight, in none of these figures (the plan's).
  unweighed?: number
}

const t = (v: number) => fmtNumber(Math.round(v))
const m = (v: number) => v.toFixed(2)

export function evaluateSemiSub(
  data: SemiSubData,
  arriving: readonly Weight[],
  leaving: readonly Weight[],
  // The deck's height over the baseline is known: without it the cargo's
  // heights are not, and neither is the KG it moves.
  deckHeightKnown: boolean
): SemiSubResult {
  const r = data.report
  // A transfer counts in the VDL by its weight; in the KG it needs its
  // height too, and without one the KG isn't worked out.
  const weighed = data.transfers.filter((x) => x.weightT !== undefined && Number.isFinite(x.weightT) && x.weightT !== 0)
  const noHeight = weighed.filter((x) => !(x.vcgM !== undefined && Number.isFinite(x.vcgM)))
  const netT =
    arriving.reduce((n, w) => n + w.weightT, 0) - leaving.reduce((n, w) => n + w.weightT, 0) + weighed.reduce((n, x) => n + (x.weightT ?? 0), 0)
  const momentTm =
    arriving.reduce((n, w) => n + w.weightT * w.vcgM, 0) -
    leaving.reduce((n, w) => n + w.weightT * w.vcgM, 0) +
    weighed.reduce((n, x) => n + (x.weightT ?? 0) * (x.vcgM ?? 0), 0)
  const cargoMoves = arriving.length > 0 || leaving.length > 0
  const zb = data.ballastVcgM

  // VDL.
  const vdlAfterT = r.vdlT !== undefined ? r.vdlT + netT : undefined
  const vdl = judge(
    'semi-vdl',
    'VDL',
    vdlAfterT === undefined ? 'Нет VDL из суточного отчёта' : undefined,
    [
      { mode: 'в работе', value: vdlAfterT, limit: data.operating.vdlMaxT, missing: 'предел в работе не задан', over: 'больше предела в работе' },
      { mode: 'в шторм', value: vdlAfterT, limit: data.survival.vdlMaxT, missing: 'предел в шторм не задан', over: 'в шторм придётся снимать груз' },
    ],
    (v) => `${t(v)} т`,
    (v) => `${t(v)} т`
  )

  // KG in operation, the draught held.
  const kgBlocked =
    r.displacementT === undefined || r.kgM === undefined
      ? 'Нет водоизмещения и KG из суточного отчёта'
      : cargoMoves && !deckHeightKnown
        ? 'Не задана высота палубы над основной плоскостью'
        : noHeight.length > 0
          ? `Прочий приход и расход: не задан ЦТ у «${noHeight[0].name || 'строки без названия'}»`
          : netT !== 0 && zb === undefined
            ? 'Не задана высота откачиваемого балласта'
            : undefined
  const delta = r.displacementT ?? 0
  const kgOperatingM = kgBlocked || !(delta > 0) ? undefined : (delta * (r.kgM ?? 0) + momentTm - netT * (zb ?? 0)) / delta
  const draftNow = r.draftM ?? data.operating.draftM
  const kgOperatingMaxM = draftNow !== undefined ? kgLimitAt(data.operating.kgLimit, draftNow) : undefined
  // KG at the survival draught.
  const survivalDelta = data.survival.displacementT
  const pumped = survivalDelta !== undefined ? delta - survivalDelta : undefined
  const kgSurvivalM =
    kgOperatingM !== undefined && survivalDelta !== undefined && survivalDelta > 0 && zb !== undefined
      ? (delta * kgOperatingM - (pumped ?? 0) * zb) / survivalDelta
      : undefined
  const kgSurvivalMaxM = data.survival.draftM !== undefined ? kgLimitAt(data.survival.kgLimit, data.survival.draftM) : undefined
  const kg = judge(
    'semi-kg',
    'KG',
    kgBlocked,
    [
      {
        mode: 'в работе',
        value: kgOperatingM,
        limit: kgOperatingMaxM,
        missing: draftNow === undefined ? 'нет осадки' : (data.operating.kgLimit ?? []).length === 0 ? 'нет таблицы допустимого KG в работе' : 'осадка вне таблицы KG',
        over: 'больше допустимого в работе',
      },
      {
        mode: 'в шторм',
        value: kgSurvivalM,
        limit: kgSurvivalMaxM,
        missing:
          survivalDelta === undefined || data.survival.draftM === undefined
            ? 'нет осадки и водоизмещения в шторм'
            : zb === undefined
              ? 'не задана высота балласта'
              : (data.survival.kgLimit ?? []).length === 0
                ? 'нет таблицы допустимого KG в шторм'
                : 'штормовая осадка вне таблицы KG',
        over: 'больше допустимого при уходе в шторм',
      },
    ],
    (v) => `${m(v)} м`,
    (v) => `${m(v)} м`
  )

  // Ballast: enough to pump out for the run, and for the survival draught.
  const ballastAfterT = r.ballastT !== undefined ? r.ballastT - netT : undefined
  const ballastSurvivalT = ballastAfterT !== undefined && pumped !== undefined ? ballastAfterT - pumped : undefined
  const ballast: SemiSubCheck = (() => {
    const base = { id: 'semi-ballast' as const, title: 'Балласт' }
    if (ballastAfterT === undefined) return { ...base, status: 'none', detail: 'Балласт на борту не указан' }
    if (ballastAfterT < 0) return { ...base, status: 'error', detail: `Не хватает на компенсацию: ещё ${t(-ballastAfterT)} т` }
    if (ballastSurvivalT === undefined) return { ...base, status: 'none', detail: `После рейса ${t(ballastAfterT)} т · уход в шторм не проверен: нет водоизмещения в шторм` }
    if (ballastSurvivalT < 0) return { ...base, status: 'error', detail: `Для ухода в шторм не хватает ${t(-ballastSurvivalT)} т` }
    return { ...base, status: 'ok', detail: `После рейса ${t(ballastAfterT)} т · в шторм ${t(ballastSurvivalT)} т` }
  })()

  return {
    netT,
    momentTm,
    vdlAfterT,
    vdlMaxOperatingT: data.operating.vdlMaxT,
    vdlMaxSurvivalT: data.survival.vdlMaxT,
    kgOperatingM,
    kgOperatingMaxM,
    kgSurvivalM,
    kgSurvivalMaxM,
    ballastAfterT,
    ballastSurvivalT,
    checks: [vdl, kg, ballast],
  }
}

interface ModePart {
  mode: string
  value: number | undefined
  limit: number | undefined
  // Why it isn't judged, when the value or the limit is missing.
  missing: string
  over: string
}

// A check of the two modes: ✕ if either is over its limit, ✓ only when both
// are judged and within, «—» otherwise — no green without the data.
function judge(
  id: SemiSubCheckId,
  title: string,
  blocked: string | undefined,
  parts: ModePart[],
  value: (v: number) => string,
  limit: (v: number) => string
): SemiSubCheck {
  if (blocked) return { id, title, status: 'none', detail: blocked }
  const words = parts.map((p) => {
    if (p.value === undefined || p.limit === undefined) return { state: 'none' as const, text: `${p.mode}: ${p.missing}` }
    const over = p.value > p.limit + 1e-9
    return { state: over ? ('error' as const) : ('ok' as const), text: `${p.mode} ${value(p.value)} при допустимом ${limit(p.limit)}${over ? ` — ${p.over}` : ''}` }
  })
  const status = words.some((w) => w.state === 'error') ? 'error' : words.every((w) => w.state === 'ok') ? 'ok' : 'none'
  return { id, title, status, detail: words.map((w) => w.text).join(' · ') }
}
