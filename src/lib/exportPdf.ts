import jsPDF from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { ManualPlacement, PackingResult, PinnedPlacement } from './packing'
import { assessLashingRequirement, DEFAULT_WIRE_ROPE_TYPE, WIRE_ROPE_SPECS, type WireRopeType } from './packing'
import type { DeckConfig, Unit } from '@/store/calculator'
import { UNIT_LABEL } from '@/store/calculator'
import { fmtNumber, fmtTonnes, pluralRu } from './utils'
import { G_METACENTRIC_MIN_SAFE, type VesselStabilityData } from './stability'
import {
  NOT_CHECKED,
  prefixedReason,
  STABILITY_DISCLAIMER,
  STATE_LABEL,
  type StabilityVerdict,
  type StateStability,
  type TripStabilityResult,
} from './stabilityConditions'
import { sortByCargoNumber } from './cargoPalette'
import { segmentLashingInputs, type ComposablePlacement, type LashingCatalogItem } from './placementComposition'

// App palette (mirrors the colors already used on-screen: slate-900 ink,
// sky-500 accent, slate-100/200 for card backgrounds/borders).
const INK: [number, number, number] = [15, 23, 42]
const CARD_BG: [number, number, number] = [241, 245, 249]
const BORDER: [number, number, number] = [226, 232, 240]
const MUTED: [number, number, number] = [100, 116, 139]
const GOOD: [number, number, number] = [5, 150, 105]
const WARN: [number, number, number] = [217, 119, 6]
const DANGER: [number, number, number] = [220, 38, 38]

const FONT_FAMILY = 'PTSans'

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

// Serializes the already-mounted deck SVG (all fills/strokes are inline hex
// attributes, not Tailwind classes, so it's self-contained) and rasterizes it
// to a JPEG data URL via an offscreen canvas — no separate "print mode"
// rendering path needed, we just capture what's already on screen. JPEG
// (rather than PNG) keeps the embedded image from ballooning the file size.
async function rasterizeSvg(svgEl: SVGSVGElement, scale = 2): Promise<{ dataUrl: string; width: number; height: number }> {
  const clone = svgEl.cloneNode(true) as SVGSVGElement
  const viewBox = svgEl.viewBox.baseVal
  const width = (viewBox && viewBox.width) || svgEl.clientWidth || 900
  const height = (viewBox && viewBox.height) || svgEl.clientHeight || 560
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  const svgString = new XMLSerializer().serializeToString(clone)
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Не удалось растрировать схему палубы'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D недоступен в этом браузере')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), width: canvas.width, height: canvas.height }
  } finally {
    URL.revokeObjectURL(url)
  }
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
  manualPlacements: ManualPlacement[],
  trips: PackingResult[],
  pinnedPlacementsByTrip: Record<number, PinnedPlacement[]>
): LashingPlacement[] {
  if (mode === 'manual') return manualPlacements.filter((m) => !(m.malformed && !m.composition))
  return trips.flatMap((trip, tripIndex) =>
    trip.placed.map((p, i): LashingPlacement => {
      const pin = (pinnedPlacementsByTrip[tripIndex] ?? []).find(
        (pp) => pp.itemId === p.itemId && Math.abs(pp.x - p.x) < 0.01 && Math.abs(pp.y - p.y) < 0.01
      )
      const placed = { itemId: p.itemId, name: p.name, layers: p.stackedCount, composition: p.composition }
      return pin
        ? { ...placed, id: pin.id, lashingWireType: pin.lashingWireType, lashingJustification: pin.lashingJustification }
        : { ...placed, id: `trip-${tripIndex}-${i}` }
    })
  )
}

// The «Учёт по грузам» rows: the cargo's number first (the same number as on
// the deck and in the list), in list order.
export function cargoTableRows(
  breakdown: PackingResult['breakdown'],
  cargoNumberByItemId: Map<string, number>
): string[][] {
  return sortByCargoNumber(breakdown, cargoNumberByItemId).map((b) => [
    String(cargoNumberByItemId.get(b.itemId) ?? '—'),
    b.name,
    b.layers > 1 ? `×${b.layers}` : '1',
    String(b.footprints),
    `${b.placed}/${b.requested}`,
    fmtNumber(b.area),
    b.weight > 0 ? fmtNumber(b.weight) : '—',
  ])
}

// Which trip the deck image and the cargo table show, and what the lashing
// table covers — said in the section titles when there is more than one
// trip (L16: the cargo table showed one trip with no word of which).
export function pdfSectionTitles(trip?: { index: number; count: number }): {
  scheme: string
  cargo: string
  stability: string
  lashing: string
} {
  if (!trip || trip.count <= 1) return { scheme: 'Схема палубы', cargo: 'Учёт по грузам', stability: 'Остойчивость', lashing: 'Крепление груза' }
  const which = `рейс ${trip.index + 1} из ${trip.count}`
  return {
    scheme: `Схема палубы — ${which}`,
    cargo: `Учёт по грузам — ${which}`,
    stability: `Остойчивость — ${which}`,
    lashing: `Крепление груза — вся операция, ${trip.count} ${pluralRu(trip.count, 'рейс', 'рейса', 'рейсов')}`,
  }
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
  trip?: { index: number; count: number }
): StabilityPdfBlock {
  const title = pdfSectionTitles(trip).stability
  const empty = (only: string): StabilityPdfBlock => ({ title, only, head: STABILITY_HEAD, rows: [], verdicts: [], notes: [] })
  if (!vessel) return empty('Остойчивость: данные судна не заданы')
  if (!evaluation) return empty('Остойчивость: гидростатика судна не задана')
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

interface ExportDeckPlanToPdfOptions {
  svgEl: SVGSVGElement
  deck: DeckConfig
  unit: Unit
  result: PackingResult
  projectName: string
  lashingRequirements?: LashingRequirementRow[]
  // Names of placed cargo whose category routes to the dangerous-goods
  // methodology (assessLashingRequirement returns 'not-applicable' for
  // these) — listed by name in the PDF instead of getting a fabricated
  // number, so the report doesn't silently drop them either.
  dangerousGoodsNames?: string[]
  // The trip `result` and the deck image belong to, when there are several.
  trip?: { index: number; count: number }
  // That trip's stability block (buildStabilityPdfBlock).
  stability?: StabilityPdfBlock
  // Cargo id → number in the list, for the «№» column.
  cargoNumberByItemId?: Map<string, number>
}

export async function exportDeckPlanToPdf({
  svgEl,
  deck,
  unit,
  result,
  projectName,
  lashingRequirements,
  dangerousGoodsNames,
  trip,
  stability,
  cargoNumberByItemId = new Map(),
}: ExportDeckPlanToPdfOptions): Promise<void> {
  const titles = pdfSectionTitles(trip)
  const { dataUrl: img, width: imgWidthPx, height: imgHeightPx } = await rasterizeSvg(svgEl)
  const unitLabel = UNIT_LABEL[unit]
  const utilPct = Math.round(result.utilization * 100)
  const utilColor = utilPct >= 85 ? GOOD : utilPct >= 60 ? WARN : MUTED

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  await registerFonts(pdf)
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 32
  const contentWidth = pageWidth - margin * 2
  // A new page when what's next doesn't fit above the footer.
  const makeRoom = (height: number) => {
    if (y + height > pageHeight - 36) {
      pdf.addPage()
      y = 40
    }
  }
  const lastTableEnd = () => (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  // --- Header band ---
  const headerHeight = 56
  pdf.setFillColor(...INK)
  pdf.rect(0, 0, pageWidth, headerHeight, 'F')
  pdf.setTextColor(255, 255, 255)
  pdf.setFont(FONT_FAMILY, 'bold')
  pdf.setFontSize(16)
  pdf.text('DeckLoad', margin, 24)
  pdf.setFont(FONT_FAMILY, 'normal')
  pdf.setFontSize(11)
  pdf.text(projectName, margin, 42)
  const date = new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  pdf.setFontSize(9)
  pdf.setTextColor(203, 213, 225)
  pdf.text(date, pageWidth - margin, 24, { align: 'right' })
  pdf.text(`Палуба ${fmtNumber(deck.width)}×${fmtNumber(deck.length)} ${unitLabel}`, pageWidth - margin, 38, { align: 'right' })

  let y = headerHeight + 22

  // --- Stat cards ---
  const cards: { label: string; value: string; color: [number, number, number] }[] = [
    { label: 'ЗАГРУЗКА ПАЛУБЫ', value: `${utilPct}%`, color: utilColor },
    { label: 'РАЗМЕЩЕНО', value: `${result.placedCount}/${result.requestedCount} ед.`, color: INK },
    { label: 'ОБЩИЙ ВЕС', value: `${fmtNumber(result.totalWeight)} кг`, color: INK },
    { label: 'РАЗМЕР ПАЛУБЫ', value: `${fmtNumber(deck.width)}×${fmtNumber(deck.length)} ${unitLabel}`, color: INK },
  ]
  const cardGap = 12
  const cardWidth = (contentWidth - cardGap * (cards.length - 1)) / cards.length
  const cardHeight = 46
  cards.forEach((card, i) => {
    const x = margin + i * (cardWidth + cardGap)
    pdf.setFillColor(...CARD_BG)
    pdf.setDrawColor(...BORDER)
    pdf.roundedRect(x, y, cardWidth, cardHeight, 4, 4, 'FD')
    pdf.setFont(FONT_FAMILY, 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(...MUTED)
    pdf.text(card.label, x + 10, y + 16)
    pdf.setFont(FONT_FAMILY, 'bold')
    pdf.setFontSize(15)
    pdf.setTextColor(...card.color)
    pdf.text(card.value, x + 10, y + 34)
  })
  y += cardHeight + 20

  // --- Deck layout image ---
  pdf.setFont(FONT_FAMILY, 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(...INK)
  pdf.text(titles.scheme, margin, y)
  y += 10

  const maxImgWidth = contentWidth
  const maxImgHeight = 260
  const imgScale = Math.min(maxImgWidth / imgWidthPx, maxImgHeight / imgHeightPx)
  const imgWidth = imgWidthPx * imgScale
  const imgHeight = imgHeightPx * imgScale
  const imgX = margin + (contentWidth - imgWidth) / 2
  pdf.setDrawColor(...BORDER)
  pdf.setFillColor(255, 255, 255)
  pdf.roundedRect(imgX - 4, y - 4, imgWidth + 8, imgHeight + 8, 3, 3, 'FD')
  pdf.addImage(img, 'JPEG', imgX, y, imgWidth, imgHeight)
  y += imgHeight + 26

  // --- Breakdown table ---
  pdf.setFont(FONT_FAMILY, 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(...INK)
  pdf.text(titles.cargo, margin, y)
  y += 8

  autoTable(pdf, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 36 },
    head: [['№', 'Груз', 'Ярусы', 'Размещено', 'Всего ед.', 'Площадь', 'Вес']],
    body: cargoTableRows(result.breakdown, cargoNumberByItemId),
    theme: 'grid',
    styles: {
      font: FONT_FAMILY,
      fontSize: 9,
      cellPadding: 6,
      lineColor: BORDER,
      lineWidth: 0.5,
      textColor: INK,
    },
    headStyles: {
      font: FONT_FAMILY,
      fillColor: INK,
      textColor: 255,
      fontStyle: 'bold',
      halign: 'left',
    },
    alternateRowStyles: { fillColor: CARD_BG },
    columnStyles: {
      0: { halign: 'right', cellWidth: 28 },
      1: { halign: 'left' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right', fontStyle: 'bold' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
  })

  y = lastTableEnd() + 22

  // --- Stability of the open trip (spec 2026-10-24, 7) ---
  if (stability) {
    pdf.setFont(FONT_FAMILY, 'bold')
    pdf.setFontSize(10)
    pdf.setTextColor(...INK)
    if (stability.only) {
      makeRoom(14)
      pdf.text(stability.only, margin, y)
      y += 22
    } else {
      makeRoom(80)
      pdf.text(stability.title, margin, y)
      y += 8
      autoTable(pdf, {
        startY: y,
        margin: { left: margin, right: margin, bottom: 36 },
        head: [stability.head],
        body: stability.rows,
        theme: 'grid',
        styles: { font: FONT_FAMILY, fontSize: 8.5, cellPadding: 5, lineColor: BORDER, lineWidth: 0.5, textColor: INK },
        headStyles: { font: FONT_FAMILY, fillColor: INK, textColor: 255, fontStyle: 'bold', halign: 'left' },
        columnStyles: { 0: { fontStyle: 'bold' }, 9: { fontStyle: 'bold' } },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 9) {
            const verdict = stability.verdicts[data.row.index]
            data.cell.styles.textColor = verdict === 'error' ? DANGER : verdict === 'warn' ? WARN : GOOD
          }
        },
      })
      y = lastTableEnd() + 12
      pdf.setFont(FONT_FAMILY, 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(...INK)
      for (const note of stability.notes) {
        const lines = pdf.splitTextToSize(note, contentWidth) as string[]
        makeRoom(lines.length * 10)
        pdf.text(lines, margin, y)
        y += lines.length * 10 + 3
      }
      y += 16
    }
  }

  // --- Lashing count table + dangerous-goods notice. Runs whenever there's
  // something to report — a calculated row, a dangerous-goods cargo name,
  // or both — so a project with ONLY dangerous-goods cargo (no calculable
  // rows at all) still gets the warning instead of silently showing nothing.
  const hasLashingRows = !!lashingRequirements && lashingRequirements.length > 0
  const hasDangerousGoods = !!dangerousGoodsNames && dangerousGoodsNames.length > 0
  if (hasLashingRows || hasDangerousGoods) {
    makeRoom(40)
    pdf.setFont(FONT_FAMILY, 'bold')
    pdf.setFontSize(10)
    pdf.setTextColor(...INK)
    pdf.text(titles.lashing, margin, y)
    y += 8

    if (hasLashingRows && lashingRequirements) {
      autoTable(pdf, {
        startY: y,
        margin: { left: margin, right: margin, bottom: 36 },
        head: [['Груз', 'Категория', 'Статус', 'Канат', 'Требуется', 'Прикреплено', 'Обоснование']],
        body: lashingRequirements.map((r) => [
          r.name,
          r.category || '—',
          r.methodology === 'metal-rd' ? 'Норматив (РД 31.11.21.23-96)' : 'Инженерная оценка',
          r.wireLabel,
          String(r.requiredCount),
          String(r.attachedCount),
          r.attachedCount < r.requiredCount ? (r.justification || '—') : '—',
        ]),
        theme: 'grid',
        styles: {
          font: FONT_FAMILY,
          fontSize: 9,
          cellPadding: 6,
          lineColor: BORDER,
          lineWidth: 0.5,
          textColor: INK,
        },
        headStyles: {
          font: FONT_FAMILY,
          fillColor: INK,
          textColor: 255,
          fontStyle: 'bold',
          halign: 'left',
        },
        alternateRowStyles: { fillColor: CARD_BG },
        columnStyles: {
          0: { halign: 'left' },
          1: { halign: 'left' },
          2: { halign: 'left' },
          3: { halign: 'left' },
          4: { halign: 'right' },
          5: { halign: 'right' },
          6: { halign: 'left' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 5) {
            const row = lashingRequirements[data.row.index]
            if (row && row.attachedCount < row.requiredCount) data.cell.styles.textColor = WARN
          }
        },
      })

      y = lastTableEnd() + 14
      pdf.setFont(FONT_FAMILY, 'normal')
      pdf.setFontSize(7.5)
      pdf.setTextColor(...MUTED)
      pdf.text(
        '* «Норматив» — формула РД 31.11.21.23-96 применена по назначению (категория «Металлопродукция»). «Инженерная оценка» — та же формула как ориентир для другого груза, не нормативный расчёт крепления.',
        margin,
        y
      )
    }

    if (hasDangerousGoods && dangerousGoodsNames) {
      y += hasLashingRows ? 11 : 0
      pdf.setFont(FONT_FAMILY, 'bold')
      pdf.setFontSize(hasLashingRows ? 7.5 : 9)
      pdf.setTextColor(...DANGER)
      pdf.text(
        `РАСЧЁТ НЕ ВЫПОЛНЕН — ТРЕБУЕТСЯ ОТДЕЛЬНАЯ ПРОВЕРКА: ${dangerousGoodsNames.join(', ')}. Классификация, сегрегация и документация — по IMDG Code (вне этого приложения); прочность крепления — отдельная проверка, число не подменяет ни то, ни другое.`,
        margin,
        y,
        { maxWidth: contentWidth }
      )
    }
  }

  // --- Footer on every page ---
  const pageCount = pdf.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i)
    pdf.setDrawColor(...BORDER)
    pdf.line(margin, pageHeight - 24, pageWidth - margin, pageHeight - 24)
    pdf.setFont(FONT_FAMILY, 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(...MUTED)
    pdf.text('DeckLoad', margin, pageHeight - 12)
    pdf.text(`Стр. ${i} из ${pageCount}`, pageWidth - margin, pageHeight - 12, { align: 'right' })
  }

  const fileDate = new Date().toISOString().slice(0, 10)
  pdf.save(`deckload-${slugify(projectName)}-${fileDate}.pdf`)
}
