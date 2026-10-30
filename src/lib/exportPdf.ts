import jsPDF from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { CargoItem, ManualPlacement, PackingResult, PinnedPlacement } from './packing'
import { assessLashingRequirement, computeZoneLoads, DEFAULT_WIRE_ROPE_TYPE, WIRE_ROPE_SPECS, type WireRopeType } from './packing'
import type { DeckConfig } from '@/store/calculator'
import { UNIT_LABEL } from './units'
import { fmtNumber, fmtTonnes, pluralRu } from './utils'
import { G_METACENTRIC_MIN_SAFE, type VesselStabilityData } from './stability'
import {
  NO_DECK_HEIGHT,
  NOT_CHECKED,
  prefixedReason,
  STABILITY_DISCLAIMER,
  STATE_LABEL,
  type StabilityVerdict,
  type StateStability,
  type TripStabilityResult,
} from './stabilityConditions'
import { cargoToneForNumber, sortByCargoNumber } from './cargoPalette'
import { segmentLashingInputs, type ComposablePlacement, type LashingCatalogItem } from './placementComposition'
import { buildChecks, type Check, type CheckStatus, type PlanFacts } from './checks'
import { deckStabilityMissing, evaluateDeckTripStability } from './planFacts'
import { buildPlanDrawing, type PlanDrawing } from './planDrawing'
import { drawPlanOnPdf } from './planToPdf'
import { appliedVessel } from './vesselLibrary'

// The plan for the vessel (spec 11): A4 landscape, a sheet per trip — the
// header, the deck drawn from the calculation, the trip's cargo, its summary
// with the checks and stability, its lashing, the signatures — and a last
// sheet with the operation's totals. What goes on the sheets is worked out
// first (buildPlanPdf, pure and tested), then laid out with jsPDF.

// The screen's light theme (theme.ts): dark ink, light rules and heads, so
// it prints legibly in black and white.
const INK = '#10243A'
const INK_2 = '#4B5D70'
const LINE = '#D6DEE6'
const HEAD_BG = '#E9EEF3'
const OK = '#1E7B4F'
const WARN = '#8F5300'
const DANGER = '#B42318'

const FONT_FAMILY = 'PTSans'

// A4 landscape in points, and where things go on a sheet.
export const PAGE = { w: 841.89, h: 595.28 }
const MARGIN = 28
const CONTENT_W = PAGE.w - 2 * MARGIN
// Under the header on every sheet.
const CONTENT_TOP = 66
// Above the footer.
const CONTENT_BOTTOM = PAGE.h - 34
// The deck drawing: the full width between the margins, down to about 60%
// of the sheet.
export const SCHEME_FRAME = { x: MARGIN, y: CONTENT_TOP, w: CONTENT_W, h: 292 }
// «Составил», «Проверил», «Дата» with room above them.
const SIGNATURES_HEIGHT = 44

// jsPDF's built-in fonts (helvetica/times/courier) only cover WinAnsi/Latin
// glyphs — any Cyrillic text renders as garbage. PT Sans is a Cyrillic-native
// open-source font (SIL OFL, see public/fonts/PTSans-OFL.txt) embedded as a
// real TTF so Russian labels/table content render correctly. The font bytes
// are fetched lazily (only when a PDF is actually requested) and cached —
// but registration itself (addFileToVFS/addFont) is per-jsPDF-instance, so
// it must be redone for every new document, just from the cached bytes.
let fontBytesPromise: Promise<{ regular: string; bold: string }> | null = null

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Не удалось загрузить шрифт: ${url}`)
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function registerFonts(pdf: jsPDF): Promise<void> {
  if (!fontBytesPromise) {
    fontBytesPromise = Promise.all([
      fetchAsBase64('/fonts/PTSans-Regular.ttf'),
      fetchAsBase64('/fonts/PTSans-Bold.ttf'),
    ]).then(([regular, bold]) => ({ regular, bold }))
  }
  const { regular, bold } = await fontBytesPromise
  pdf.addFileToVFS('PTSans-Regular.ttf', regular)
  pdf.addFont('PTSans-Regular.ttf', FONT_FAMILY, 'normal')
  pdf.addFileToVFS('PTSans-Bold.ttf', bold)
  pdf.addFont('PTSans-Bold.ttf', FONT_FAMILY, 'bold')
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  )
}

// One row per placement that carries a computed РД 31.11.21.23-96 п. 2.2.3
// lashing requirement (n = 0,3·P/BL) — built by the caller from manual +
// pinned placements, since exportPdf itself has no store access.
export interface LashingRequirementRow {
  name: string
  requiredCount: number
  attachedCount: number
  wireLabel: string
  justification?: string
  category?: string
  // 'metal-rd' rows are the real, cited РД 31.11.21.23-96 figure;
  // 'general' rows are the same formula used as an unlabeled ballpark for
  // non-metal cargo — see lashingMethodologyFor/assessLashingRequirement in
  // packing.ts. Rows are never built for 'dangerous-goods' cargo at all —
  // those are listed separately via dangerousGoodsNames below instead.
  methodology: 'metal-rd' | 'general'
}

// Round 19 (lashing per-segment). Extracted out of page.tsx's handleExportPdf
// as its own pure, independently testable function — a composed placement
// can span multiple distinct categories (e.g. ordinary cargo + dangerous
// goods), so it expands into N rows (one per constituent segment), each
// with its OWN category/weight/methodology/requiredCount — assessing the
// whole placement as one row using only the nominal itemId's category
// silently dropped every OTHER constituent's own methodology (or worse,
// misrouted an ordinary constituent through a dangerous-goods verdict it
// doesn't belong to, or vice versa, depending on which constituent happens
// to be nominal). `attachedCount`, `wireLabel` and `justification` stay
// SHARED/placement-level (C3 — lashing points attach to the physical stack,
// not a specific constituent) — the same value repeated across that
// placement's rows. Degenerates to exactly one row per placement, byte-for-
// byte identical to the pre-Round-19 behavior, for every existing
// (uncomposed) placement, since segmentLashingInputs's own one-segment
// fallback kicks in.
export function buildLashingRequirementRows(
  placements: (ComposablePlacement & { id: string; name: string; lashingWireType?: WireRopeType; lashingJustification?: string })[],
  items: LashingCatalogItem[],
  lashingPoints: { placementId?: string }[]
): { rows: LashingRequirementRow[]; dangerousGoodsNames: string[] } {
  const dangerousGoodsNames: string[] = []
  const rows = placements
    .flatMap((p) => {
      const wireType = p.lashingWireType ?? DEFAULT_WIRE_ROPE_TYPE
      const segments = segmentLashingInputs(p, items)
      const multiSegment = segments.length > 1
      return segments.map((seg) => {
        const assessment = assessLashingRequirement(seg.category, seg.weightKg, WIRE_ROPE_SPECS[wireType].breakingLoadKN)
        const rowName = multiSegment ? `${p.name} — ${items.find((it) => it.id === seg.itemId)?.name ?? seg.itemId}` : p.name
        if (assessment.status === 'not-applicable') {
          dangerousGoodsNames.push(rowName)
          return null
        }
        if (assessment.status !== 'calculated' || !assessment.requiredCount) return null
        const row: LashingRequirementRow = {
          name: rowName,
          requiredCount: assessment.requiredCount,
          attachedCount: lashingPoints.filter((pt) => pt.placementId === p.id).length,
          wireLabel: WIRE_ROPE_SPECS[wireType].label,
          justification: p.lashingJustification,
          category: seg.category,
          methodology: assessment.methodology,
        }
        return row
      })
    })
    .filter((r): r is LashingRequirementRow => r !== null)
  return { rows, dangerousGoodsNames }
}

type LashingPlacement = ComposablePlacement & {
  id: string
  name: string
  lashingWireType?: WireRopeType
  lashingJustification?: string
}

// The stacks the lashing table covers: everything placed in the plan (L16).
// In auto mode the table used to take only pinned stacks, so cargo the packer
// placed by itself fell out of it. Every trip counts — lashing gear is
// bought once for the whole operation — and a pinned stack keeps its pin's
// id (for its attached lashing points), wire and justification. A
// quarantined placement isn't on the deck and isn't counted.
export function lashingPlacementsForPlan(
  mode: 'auto' | 'manual',
  manualPlacements: readonly ManualPlacement[],
  trips: readonly PackingResult[],
  pinnedPlacementsByTrip: Readonly<Record<number, readonly PinnedPlacement[]>>
): LashingPlacement[] {
  if (mode === 'manual') return manualPlacements.filter((m) => !(m.malformed && !m.composition))
  return trips.flatMap((trip, tripIndex) => lashingPlacementsForTrip(trip, tripIndex, pinnedPlacementsByTrip[tripIndex] ?? []))
}

// One trip's stacks for the lashing table, in auto mode.
function lashingPlacementsForTrip(trip: PackingResult, tripIndex: number, pins: readonly PinnedPlacement[]): LashingPlacement[] {
  return trip.placed.map((p, i): LashingPlacement => {
    const pin = pins.find((pp) => pp.itemId === p.itemId && Math.abs(pp.x - p.x) < 0.01 && Math.abs(pp.y - p.y) < 0.01)
    const placed = { itemId: p.itemId, name: p.name, layers: p.stackedCount, composition: p.composition }
    return pin
      ? { ...placed, id: pin.id, lashingWireType: pin.lashingWireType, lashingJustification: pin.lashingJustification }
      : { ...placed, id: `trip-${tripIndex}-${i}` }
  })
}

// The PDF's «Остойчивость» block (spec 2026-10-24, 7): the open trip at
// departure and at arrival, then the limit, the reasons, the disclaimer and
// what isn't checked. The verdict goes in words — the PDF's font may lack
// ✓ ⚠ ✕ — and the KN reference stays out. Without the vessel's data the
// block is one line.
export interface StabilityPdfBlock {
  title: string
  only?: string
  head: string[]
  rows: string[][]
  // The verdict of each row, for its colour.
  verdicts: StabilityVerdict[]
  notes: string[]
}

const STABILITY_HEAD = ['Состояние', 'Водоизм., т', 'Осадка ср. / нос / корма, м', 'Крен, °', 'Дифферент, м', 'GM, м', 'Предел GM, м', 'Вода в трубах, т', 'Лёд, т', 'Итог']
const VERDICT_IN_WORDS: Record<StabilityVerdict, string> = { ok: 'выполнено', warn: 'нужна проверка', error: 'не выполнено' }

export function buildStabilityPdfBlock(
  evaluation: TripStabilityResult | undefined,
  vessel: VesselStabilityData | undefined,
  // Why it isn't worked out though the vessel's data is there.
  missing?: string
): StabilityPdfBlock {
  const title = 'Остойчивость'
  const empty = (only: string): StabilityPdfBlock => ({ title, only, head: STABILITY_HEAD, rows: [], verdicts: [], notes: [] })
  if (!vessel) return empty('Остойчивость не рассчитывалась: нет данных судна')
  if (!evaluation && missing === NO_DECK_HEIGHT)
    return empty('Остойчивость не рассчитывалась: не задана высота палубы над килем — без неё груз на палубе не посчитать')
  if (!evaluation) return empty('Остойчивость не рассчитывалась: нет гидростатики судна')
  const m2 = (v: number) => v.toFixed(2)
  // Numbers read off the edge of the hydrostatic table carry a star.
  const row = (s: StateStability): string[] => {
    const r = s.stability
    const star = r.extrapolated ? '*' : ''
    const draughts = [s.draughts.meanM, s.draughts.foreM, s.draughts.aftM].map((v) => (v === null ? '—' : m2(v))).join(' / ')
    const list = r.listSide === 'none' ? '0' : `${r.listDeg.toFixed(1)} на ${r.listSide === 'starboard' ? 'пр.' : 'лев.'} борт`
    const trim = r.trimM === null ? '—' : r.trimDirection === 'even' ? '0' : `${m2(Math.abs(r.trimM))} на ${r.trimDirection === 'by-head' ? 'нос' : 'корму'}`
    const limit = !s.limit ? '—' : s.limit.inRange ? m2(s.limit.gmMinM) : 'вне таблицы'
    return [
      STATE_LABEL[s.state],
      `${star}${Math.round(r.displacementKg / 1000)}`,
      `${star}${draughts}`,
      `${star}${list}`,
      `${star}${trim}`,
      `${star}${m2(r.GM_fluid)}`,
      limit,
      fmtTonnes(s.waterKg),
      s.iceKg > 0 ? fmtTonnes(s.iceKg) : '—',
      VERDICT_IN_WORDS[s.verdict],
    ]
  }
  const states = [evaluation.departure, evaluation.arrival]
  const limit = vessel.limit && vessel.limit.rows.length > 0 ? vessel.limit : undefined
  const notes = [
    limit
      ? `Предел по формуляру: ${limit.kind === 'min-gm-by-draft' ? 'мин. GM по осадке' : 'макс. KG по водоизмещению, в таблице пересчитан в GM как KM − KG предельный'}, ${limit.rows.length} ${pluralRu(limit.rows.length, 'строка', 'строки', 'строк')}${limit.source ? `. Источник: ${limit.source}` : ''}.`
      : `Предел по формуляру не задан — проверено только по общему минимуму GM ${G_METACENTRIC_MIN_SAFE} м.`,
    ...(states.some((s) => s.stability.extrapolated) ? ['* Водоизмещение вне таблицы гидростатики: число взято по её крайней строке, это оценка.'] : []),
    // «Не выполнено (приход): GM 3.17 м ниже предела…», «Нужна проверка: …».
    ...evaluation.reasons.map((r) => {
      const word = VERDICT_IN_WORDS[r.status]
      const state = r.states.length === 1 ? ` (${STATE_LABEL[r.states[0]].toLowerCase()})` : ''
      return `${prefixedReason(word[0].toUpperCase() + word.slice(1) + state, r.text)}.`
    }),
    STABILITY_DISCLAIMER,
    `Не проверяется: ${NOT_CHECKED.join('; ')}.`,
  ]
  return { title, head: STABILITY_HEAD, rows: states.map(row), verdicts: states.map((s) => s.verdict), notes }
}


export interface PlanPdfInput {
  projectName: string
  deck: DeckConfig
  items: CargoItem[]
  mode: 'auto' | 'manual'
  // The trips shown (an empty trailing trip left out).
  trips: readonly PackingResult[]
  manualPlacements: readonly ManualPlacement[]
  pinnedPlacementsByTrip: Readonly<Record<number, readonly PinnedPlacement[]>>
  // The plan's facts (gatherPlanFacts), for each trip's checks and marks.
  facts: PlanFacts
  // Cargo id → its number in the list.
  numbers: Map<string, number>
  date: Date
}

// A row of a trip's cargo table: its cargo's number and tone for the swatch.
export interface PdfCargoRow {
  number?: number
  tone?: string
  cells: string[]
}

export interface PdfCheckLine {
  title: string
  status: CheckStatus
  word: string
  detail: string
}

// A lashing row for the sheets: the stacks of one cargo with the same wire
// and footing taken together — a row per stack ran to pages of identical
// lines. Required and attached are the sums over those stacks.
export interface PdfLashingRow extends LashingRequirementRow {
  stacks: number
}

export interface PdfLashing {
  rows: PdfLashingRow[]
  dangerousGoodsNames: string[]
}

export function groupLashingRows(rows: readonly LashingRequirementRow[]): PdfLashingRow[] {
  const groups = new Map<string, PdfLashingRow>()
  for (const r of rows) {
    const key = [r.name, r.category ?? '', r.methodology, r.wireLabel].join('|')
    const g = groups.get(key)
    if (!g) {
      groups.set(key, { ...r, stacks: 1, justification: r.attachedCount < r.requiredCount ? r.justification : undefined })
      continue
    }
    g.stacks += 1
    g.requiredCount += r.requiredCount
    g.attachedCount += r.attachedCount
    // The reasons given for stacks short of points, each once.
    const reason = r.attachedCount < r.requiredCount ? r.justification : undefined
    if (reason && !(g.justification ?? '').split('; ').includes(reason)) g.justification = g.justification ? `${g.justification}; ${reason}` : reason
  }
  return [...groups.values()]
}

export interface PdfTripSheet {
  // «Рейс 1 из 2».
  title: string
  drawing: PlanDrawing
  cargo: PdfCargoRow[]
  cargoTotal: string[]
  units: number
  weightKg: number
  stacks: number
  weight: { text: string; over: boolean }
  area: string
  checks: PdfCheckLine[]
  stability: StabilityPdfBlock
  lashing: PdfLashing
}

export interface PlanPdfModel {
  fileName: string
  // «Алексей Кузнецов (IMO 9692648)» or «Своя палуба 8 × 20 м».
  vessel: string
  name: string
  date: string
  trips: PdfTripSheet[]
  totals: { rows: string[][]; total: string[]; lashing: PdfLashing }
}

export const CARGO_HEAD_FOR = (unit: string) => ['№', 'Груз', 'Кол-во, шт', `Д×Ш×В, ${unit}`, 'Вес ед., т', 'Вес всего, т', 'Ярусов', 'Штабелей']
// The cargo table's columns, pt: «Груз» takes the rest. Numbers are right-aligned.
export const CARGO_COLUMN_WIDTHS: (number | undefined)[] = [34, undefined, 62, 110, 62, 70, 52, 60]
export const CARGO_RIGHT_ALIGNED = [0, 2, 3, 4, 5, 6, 7]
export const TOTALS_HEAD = ['Рейс', 'Груз, шт', 'Вес груза, т', 'Штабелей', 'Загрузка площади']
const LASHING_HEAD = ['Груз', 'Штабелей', 'Категория', 'Статус', 'Канат', 'Требуется', 'Прикреплено', 'Обоснование']

// Tonnes to 10 kg: «2.2», «0.5», «0.01».
const tonnes = (kg: number) => String(Math.round(kg / 10) / 100)
// Sizes as the cargo table shows them: «0.8», «2.44».
const short = (v: number) => String(Math.round(v * 100) / 100)

// The check's status in words: the PDF's font has no ✓ ⚠ ✕.
export const CHECK_STATUS_WORD: Record<CheckStatus, string> = { ok: 'в норме', warn: 'внимание', error: 'ошибка', none: 'не проверялось' }

export function buildPlanPdf(input: PlanPdfInput): PlanPdfModel {
  const { deck, items, trips, numbers } = input
  const unit = UNIT_LABEL[deck.unit]
  const applied = appliedVessel(deck)
  const vessel = applied ? applied.label : `Своя палуба ${fmtNumber(deck.width)} × ${fmtNumber(deck.length)} ${unit}`
  const count = trips.length
  const lashingOf = (placements: LashingPlacement[]): PdfLashing => {
    const { rows, dangerousGoodsNames } = buildLashingRequirementRows(placements, items, deck.lashingPoints ?? [])
    return { rows: groupLashingRows(rows), dangerousGoodsNames: [...new Set(dangerousGoodsNames)] }
  }

  const sheets = trips.map((t, i): PdfTripSheet => {
    const found = input.facts.trips[i]?.found
    const zoneLoads =
      deck.loadZones && deck.loadZones.length > 0
        ? computeZoneLoads(
            t.placed.map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length, totalWeightKg: (p.weight ?? 0) * p.stackedCount })),
            deck.loadZones,
            deck.outline,
            deck.unit
          )
        : []
    const drawing = buildPlanDrawing({
      deck,
      placed: t.placed,
      numbers,
      zoneLoads,
      lashingShort: new Set(found?.lashingShort.map((s) => s.stack.key)),
      unknownMakeup: new Set(found?.unknownMakeup.map((s) => s.stack.key)),
      frame: SCHEME_FRAME,
    })
    const rows = sortByCargoNumber(
      t.breakdown.filter((b) => b.placed > 0),
      numbers
    )
    const cargo = rows.map((b): PdfCargoRow => {
      const n = numbers.get(b.itemId)
      const item = items.find((it) => it.id === b.itemId)
      const dims = item ? `${short(item.length)}×${short(item.width)}×${item.height > 0 ? short(item.height) : '—'}` : '—'
      return {
        number: n,
        tone: n ? cargoToneForNumber(n) : undefined,
        cells: [
          n ? String(n) : '—',
          b.name,
          String(b.placed),
          dims,
          b.unitWeight > 0 ? tonnes(b.unitWeight) : '—',
          b.weight > 0 ? tonnes(b.weight) : '—',
          String(b.layers),
          String(b.footprints),
        ],
      }
    })
    const units = rows.reduce((n, b) => n + b.placed, 0)
    const stacks = rows.reduce((n, b) => n + b.footprints, 0)
    const limit = deck.maxDeckCargoT
    const placements =
      input.mode === 'manual' ? lashingPlacementsForPlan('manual', input.manualPlacements, [], {}) : lashingPlacementsForTrip(t, i, input.pinnedPlacementsByTrip[i] ?? [])
    return {
      title: `Рейс ${i + 1} из ${count}`,
      drawing,
      cargo,
      cargoTotal: ['', 'Итого по рейсу', String(units), '', '', tonnes(t.totalWeight), '', String(stacks)],
      units,
      weightKg: t.totalWeight,
      stacks,
      weight: {
        text:
          limit !== undefined
            ? `Вес груза: ${tonnes(t.totalWeight)} т из ${fmtNumber(limit)} т — лимит судна`
            : `Вес груза: ${tonnes(t.totalWeight)} т — лимит судна не задан`,
        over: limit !== undefined && t.totalWeight / 1000 > limit + 1e-9,
      },
      area: `Загрузка площади: ${Math.round(t.utilization * 100)}% — занято ${fmtNumber(t.usedArea)} из ${fmtNumber(t.totalArea)} ${unit}²`,
      checks: tripChecks(input.facts, i).map((c) => ({ title: c.title, status: c.status, word: CHECK_STATUS_WORD[c.status], detail: c.detail })),
      stability: buildStabilityPdfBlock(evaluateDeckTripStability(deck, t, items), deck.vessel, deckStabilityMissing(deck, t)),
      lashing: lashingOf(placements),
    }
  })

  const totalUnits = sheets.reduce((n, s) => n + s.units, 0)
  const totalKg = sheets.reduce((n, s) => n + s.weightKg, 0)
  const totalStacks = sheets.reduce((n, s) => n + s.stacks, 0)
  return {
    fileName: `deckload-${slugify(input.projectName)}-${input.date.toISOString().slice(0, 10)}.pdf`,
    vessel,
    name: input.projectName,
    date: new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' }).format(input.date),
    trips: sheets,
    totals: {
      rows: sheets.map((s, i) => [`Рейс ${i + 1}`, String(s.units), tonnes(s.weightKg), String(s.stacks), `${Math.round(trips[i].utilization * 100)}%`]),
      total: ['Всего', String(totalUnits), tonnes(totalKg), String(totalStacks), ''],
      lashing: lashingOf(lashingPlacementsForPlan(input.mode, input.manualPlacements, trips, input.pinnedPlacementsByTrip)),
    },
  }
}

// One trip's checks, for its sheet: the trip's own findings, judged as if it
// were the whole plan — except how the cargo goes into trips, which is the
// plan's matter and reads the same on every sheet.
export function tripChecks(f: PlanFacts, tripIndex: number): Check[] {
  const trip = f.trips[tripIndex]
  const plan = buildChecks(f)
  if (!trip) return plan
  const found = trip.found
  const one = buildChecks({
    ...f,
    trips: [trip],
    tenFoot: f.tenFoot ? { capacity: f.tenFoot.capacity, byTrip: [f.tenFoot.byTrip[tripIndex] ?? 0] } : undefined,
    lashing: found
      ? { securedStacks: trip.securedStacks ?? f.lashing.securedStacks, shortStacks: found.lashingShort.length, dangerousGoodsStacks: found.dangerousGoods.length }
      : f.lashing,
    attention: found
      ? {
          malformed: found.quarantined.length,
          legacyUnknown: found.unknownMakeup.length,
          rejectedPins: found.rejectedPins.length,
          manualConflicts: found.conflicts.length,
        }
      : f.attention,
  })
  return one.map((c) => (c.id === 'capacity' ? (plan.find((p) => p.id === 'capacity') ?? c) : c))
}

// ---- Laying the sheets out ----

const STATUS_COLOR: Record<CheckStatus, string> = { ok: OK, warn: WARN, error: DANGER, none: INK_2 }

// What each sheet is, for its header: a trip's first sheet, its
// continuation, or the totals.
type SheetKind = { trip: number; continued: boolean } | { totals: true }

export async function exportPlanPdf(input: PlanPdfInput): Promise<void> {
  const model = buildPlanPdf(input)
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  await registerFonts(pdf)
  layOutPlanPdf(pdf, model, CARGO_HEAD_FOR(UNIT_LABEL[input.deck.unit]))
  pdf.save(model.fileName)
}

export function layOutPlanPdf(pdf: jsPDF, model: PlanPdfModel, cargoHead: string[]): void {
  const sheets = new Map<number, SheetKind>()
  let current: SheetKind = { trip: 0, continued: false }
  // Sheets a table spilled onto continue the trip it belongs to.
  const claimSheets = () => {
    for (let n = 1; n <= pdf.getNumberOfPages(); n++)
      if (!sheets.has(n)) sheets.set(n, 'trip' in current ? { trip: current.trip, continued: true } : current)
  }
  let y = CONTENT_TOP
  const newSheet = () => {
    pdf.addPage()
    claimSheets()
    y = CONTENT_TOP
  }
  const makeRoom = (height: number) => {
    if (y + height > CONTENT_BOTTOM) newSheet()
  }
  const lastTableEnd = () => (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  const tableStyles = {
    theme: 'grid' as const,
    margin: { left: MARGIN, right: MARGIN, top: CONTENT_TOP, bottom: PAGE.h - CONTENT_BOTTOM },
    styles: { font: FONT_FAMILY, fontSize: 8.5, cellPadding: 4, lineColor: LINE, lineWidth: 0.5, textColor: INK },
    headStyles: { font: FONT_FAMILY, fillColor: HEAD_BG, textColor: INK, fontStyle: 'bold' as const, halign: 'left' as const },
  }
  const title = (text: string) => {
    makeRoom(40)
    pdf.setFont(FONT_FAMILY, 'bold')
    pdf.setFontSize(10)
    pdf.setTextColor(INK)
    pdf.text(text, MARGIN, y + 10)
    y += 16
  }
  const lines = (texts: string[], size: number, color: string, bold = false) => {
    pdf.setFont(FONT_FAMILY, bold ? 'bold' : 'normal')
    pdf.setFontSize(size)
    pdf.setTextColor(color)
    for (const text of texts) {
      const wrapped = pdf.splitTextToSize(text, CONTENT_W) as string[]
      makeRoom(wrapped.length * size * 1.3)
      pdf.setFont(FONT_FAMILY, bold ? 'bold' : 'normal')
      pdf.setFontSize(size)
      pdf.setTextColor(color)
      pdf.text(wrapped, MARGIN, y + size)
      y += wrapped.length * size * 1.3 + 2
    }
  }

  model.trips.forEach((sheet, i) => {
    if (i > 0) pdf.addPage()
    current = { trip: i, continued: false }
    sheets.set(pdf.getNumberOfPages(), current)
    drawPlanOnPdf(pdf, sheet.drawing, FONT_FAMILY)
    y = SCHEME_FRAME.y + SCHEME_FRAME.h + 6

    // The trip's cargo, the swatch of its tone beside each number.
    autoTable(pdf, {
      ...tableStyles,
      startY: y,
      head: [cargoHead],
      body: sheet.cargo.map((r) => r.cells),
      foot: [sheet.cargoTotal],
      footStyles: { font: FONT_FAMILY, fillColor: HEAD_BG, textColor: INK, fontStyle: 'bold' },
      showFoot: 'lastPage',
      columnStyles: Object.fromEntries(
        CARGO_COLUMN_WIDTHS.map((w, i) => [i, { ...(w ? { cellWidth: w } : {}), ...(CARGO_RIGHT_ALIGNED.includes(i) ? { halign: 'right' as const } : {}) }])
      ),
      didParseCell: (data) => {
        if (data.section === 'foot' && [2, 5, 7].includes(data.column.index)) data.cell.styles.halign = 'right'
      },
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 0) return
        const tone = sheet.cargo[data.row.index]?.tone
        if (!tone) return
        pdf.setFillColor(tone)
        pdf.setDrawColor(INK)
        pdf.setLineWidth(0.5)
        pdf.rect(data.cell.x + 4, data.cell.y + data.cell.height / 2 - 4, 8, 8, 'FD')
      },
    })
    claimSheets()
    y = lastTableEnd() + 12

    // The summary — weight, area, the checks — kept on one sheet.
    makeRoom(16 + 2 * 14 + (sheet.checks.length + 1) * 19 + 8)
    title('Сводка рейса')
    lines([sheet.weight.text], 9, sheet.weight.over ? DANGER : INK)
    lines([sheet.area], 9, INK)
    y += 2
    autoTable(pdf, {
      ...tableStyles,
      startY: y,
      head: [['Проверка', 'Итог', 'Что найдено']],
      body: sheet.checks.map((c) => [c.title, c.word, c.detail]),
      pageBreak: 'avoid',
      rowPageBreak: 'avoid',
      columnStyles: { 0: { cellWidth: 130, fontStyle: 'bold' }, 1: { cellWidth: 90 } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 1) {
          data.cell.styles.textColor = STATUS_COLOR[sheet.checks[data.row.index].status]
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })
    claimSheets()
    y = lastTableEnd() + 12

    // Stability of the trip.
    const stability = sheet.stability
    if (stability.only) {
      makeRoom(20)
      lines([stability.only], 9, INK, true)
      y += 8
    } else {
      makeRoom(16 + (stability.rows.length + 1) * 19)
      title(stability.title)
      autoTable(pdf, {
        ...tableStyles,
        startY: y,
        head: [stability.head],
        body: stability.rows,
        pageBreak: 'avoid',
        styles: { ...tableStyles.styles, fontSize: 8 },
        columnStyles: { 0: { fontStyle: 'bold' }, 9: { fontStyle: 'bold' } },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 9) {
            const verdict = stability.verdicts[data.row.index]
            data.cell.styles.textColor = verdict === 'error' ? DANGER : verdict === 'warn' ? WARN : OK
          }
        },
      })
      claimSheets()
      y = lastTableEnd() + 8
      lines(stability.notes, 7.5, INK)
      y += 8
    }

    // Lashing of the trip's cargo, then the signatures — together on the
    // next sheet when they don't fit here, rather than the signatures alone
    // on a sheet of their own.
    const lashingHeight =
      sheet.lashing.rows.length > 0 || sheet.lashing.dangerousGoodsNames.length > 0
        ? 16 + (sheet.lashing.rows.length + 1) * 19 + 40 + (sheet.lashing.dangerousGoodsNames.length > 0 ? 30 : 0)
        : 0
    if (lashingHeight + SIGNATURES_HEIGHT < CONTENT_BOTTOM - CONTENT_TOP) makeRoom(lashingHeight + SIGNATURES_HEIGHT)
    drawLashing(sheet.lashing, `Крепление груза рейса ${i + 1}`)

    // Signatures.
    makeRoom(SIGNATURES_HEIGHT)
    y += 18
    pdf.setFont(FONT_FAMILY, 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(INK)
    const third = CONTENT_W / 3
    ;['Составил', 'Проверил', 'Дата'].forEach((label, k) => {
      const x = MARGIN + k * third
      pdf.text(label, x, y)
      pdf.setDrawColor(INK)
      pdf.setLineWidth(0.5)
      pdf.line(x + pdf.getTextWidth(label) + 6, y + 1, x + third - 24, y + 1)
    })
    y += 12
  })

  // The operation's totals.
  pdf.addPage()
  current = { totals: true }
  sheets.set(pdf.getNumberOfPages(), current)
  y = CONTENT_TOP
  title('Груз по рейсам')
  autoTable(pdf, {
    ...tableStyles,
    startY: y,
    head: [TOTALS_HEAD],
    body: model.totals.rows,
    foot: [model.totals.total],
    footStyles: { font: FONT_FAMILY, fillColor: HEAD_BG, textColor: INK, fontStyle: 'bold' },
    showFoot: 'lastPage',
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    didParseCell: (data) => {
      if (data.section === 'foot' && data.column.index > 0) data.cell.styles.halign = 'right'
    },
  })
  claimSheets()
  y = lastTableEnd() + 14
  drawLashing(model.totals.lashing, 'Крепление на всю операцию', true)

  // Headers and footers, now that the sheets are counted.
  const total = pdf.getNumberOfPages()
  for (let n = 1; n <= total; n++) {
    pdf.setPage(n)
    const kind = sheets.get(n) ?? { totals: true }
    const right = 'totals' in kind ? 'Итого по операции' : `${model.trips[kind.trip].title}${kind.continued ? ' (продолжение)' : ''}`
    pdf.setFont(FONT_FAMILY, 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor(INK)
    pdf.text(model.vessel, MARGIN, 30)
    pdf.text(right, PAGE.w - MARGIN, 30, { align: 'right' })
    pdf.setFont(FONT_FAMILY, 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(INK_2)
    pdf.text(model.name, MARGIN, 44)
    pdf.text(`${model.date} · Лист ${n} из ${total}`, PAGE.w - MARGIN, 44, { align: 'right' })
    pdf.setDrawColor(LINE)
    pdf.setLineWidth(0.75)
    pdf.line(MARGIN, 52, PAGE.w - MARGIN, 52)
    pdf.line(MARGIN, PAGE.h - 24, PAGE.w - MARGIN, PAGE.h - 24)
    pdf.setFontSize(8)
    pdf.text('DeckLoad', MARGIN, PAGE.h - 12)
    pdf.text(`Лист ${n} из ${total}`, PAGE.w - MARGIN, PAGE.h - 12, { align: 'right' })
  }

  // The lashing table with its footnote, and the dangerous goods the app
  // doesn't calculate, in red. The operation's table ends with the totals:
  // the gear is bought for the whole operation.
  function drawLashing(lashing: PdfLashing, heading: string, withTotal = false) {
    const hasRows = lashing.rows.length > 0
    const hasDangerous = lashing.dangerousGoodsNames.length > 0
    if (!hasRows && !hasDangerous) return
    title(heading)
    if (hasRows) {
      const required = lashing.rows.reduce((n, r) => n + r.requiredCount, 0)
      const attached = lashing.rows.reduce((n, r) => n + r.attachedCount, 0)
      autoTable(pdf, {
        ...tableStyles,
        startY: y,
        head: [LASHING_HEAD],
        body: lashing.rows.map((r) => [
          r.name,
          String(r.stacks),
          r.category || '—',
          r.methodology === 'metal-rd' ? 'Норматив (РД 31.11.21.23-96)' : 'Инженерная оценка',
          r.wireLabel,
          String(r.requiredCount),
          String(r.attachedCount),
          r.attachedCount < r.requiredCount ? r.justification || '—' : '—',
        ]),
        ...(withTotal
          ? {
              foot: [['Всего', String(lashing.rows.reduce((n, r) => n + r.stacks, 0)), '', '', '', String(required), String(attached), '']],
              footStyles: { font: FONT_FAMILY, fillColor: HEAD_BG, textColor: INK, fontStyle: 'bold' as const },
              showFoot: 'lastPage' as const,
            }
          : {}),
        columnStyles: { 1: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
        didParseCell: (data) => {
          if (data.section === 'foot' && [1, 5, 6].includes(data.column.index)) data.cell.styles.halign = 'right'
          if (data.section === 'body' && data.column.index === 6) {
            const row = lashing.rows[data.row.index]
            if (row && row.attachedCount < row.requiredCount) data.cell.styles.textColor = WARN
          }
        },
      })
      claimSheets()
      y = lastTableEnd() + 6
      lines(
        [
          '* «Норматив» — формула РД 31.11.21.23-96 применена по назначению (категория «Металлопродукция»). «Инженерная оценка» — та же формула как ориентир для другого груза, не нормативный расчёт крепления.',
        ],
        7.5,
        INK_2
      )
    }
    if (hasDangerous) {
      lines(
        [
          `РАСЧЁТ НЕ ВЫПОЛНЕН — ТРЕБУЕТСЯ ОТДЕЛЬНАЯ ПРОВЕРКА: ${lashing.dangerousGoodsNames.join(', ')}. Классификация, сегрегация и документация — по IMDG Code (вне этого приложения); прочность крепления — отдельная проверка, число не подменяет ни то, ни другое.`,
        ],
        8,
        DANGER,
        true
      )
    }
    y += 6
  }
}
