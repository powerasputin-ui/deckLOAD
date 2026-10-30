import { PLAN_FONT, PlanShapes } from './PlanDrawingSvg'
import { CARGO_COLUMN_WIDTHS, CARGO_RIGHT_ALIGNED, PAGE, SCHEME_FRAME, type PdfTripSheet } from '@/lib/exportPdf'
import { CARGO_INK } from '@/lib/cargoPalette'

// A trip's first sheet of the PDF as the «Отчёт» preview shows it (spec
// 8.8): the header, the deck drawn exactly as the PDF draws it, and as much
// of the cargo table as the sheet holds. In the PDF's points, scaled to
// the panel.
const MARGIN = SCHEME_FRAME.x
const INK_2 = '#4B5D70'
const LINE = '#D6DEE6'
const HEAD_BG = '#E9EEF3'
const ROW = 19
const FONT = 8.5

export function PagePreview({ vessel, name, sheet, cargoHead }: { vessel: string; name: string; sheet: PdfTripSheet; cargoHead: string[] }) {
  const fixed = CARGO_COLUMN_WIDTHS.reduce<number>((sum, w) => sum + (w ?? 0), 0)
  const widths = CARGO_COLUMN_WIDTHS.map((w) => w ?? PAGE.w - 2 * MARGIN - fixed)
  const lefts = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0))
  const top = SCHEME_FRAME.y + SCHEME_FRAME.h + 6
  // The rows that fit above the footer, the total row with them when all do.
  const room = Math.floor((PAGE.h - 34 - top) / ROW) - 1
  const rows = sheet.cargo.slice(0, Math.max(0, room - 1))
  const withTotal = rows.length === sheet.cargo.length
  const cell = (text: string, col: number, y: number, bold = false) => {
    const right = CARGO_RIGHT_ALIGNED.includes(col)
    return (
      <text
        key={col}
        x={right ? lefts[col] + widths[col] - 4 : lefts[col] + 4}
        y={y + ROW / 2}
        textAnchor={right ? 'end' : 'start'}
        dominantBaseline="central"
        fontSize={FONT}
        fontWeight={bold ? 700 : 400}
        fill={CARGO_INK}
      >
        {text}
      </text>
    )
  }
  return (
    <svg viewBox={`0 0 ${PAGE.w} ${PAGE.h}`} role="img" aria-label={`Превью листа: ${sheet.title}`} className="w-full rounded-md border border-line bg-white shadow-sm">
      <rect width={PAGE.w} height={PAGE.h} fill="#FFFFFF" />
      <g fontFamily={PLAN_FONT}>
        <text x={MARGIN} y={30} fontSize={11} fontWeight={700} fill={CARGO_INK}>
          {vessel}
        </text>
        <text x={PAGE.w - MARGIN} y={30} fontSize={11} fontWeight={700} fill={CARGO_INK} textAnchor="end">
          {sheet.title}
        </text>
        <text x={MARGIN} y={44} fontSize={9} fill={INK_2}>
          {name}
        </text>
        <line x1={MARGIN} y1={52} x2={PAGE.w - MARGIN} y2={52} stroke={LINE} strokeWidth={0.75} />
      </g>
      <PlanShapes shapes={sheet.drawing.shapes} />
      <g fontFamily={PLAN_FONT}>
        <rect x={MARGIN} y={top} width={PAGE.w - 2 * MARGIN} height={ROW} fill={HEAD_BG} stroke={LINE} strokeWidth={0.5} />
        {cargoHead.map((h, col) => cell(h, col, top, true))}
        {rows.map((r, i) => {
          const y = top + (i + 1) * ROW
          return (
            <g key={i}>
              <rect x={MARGIN} y={y} width={PAGE.w - 2 * MARGIN} height={ROW} fill="#FFFFFF" stroke={LINE} strokeWidth={0.5} />
              {r.tone && <rect x={MARGIN + 4} y={y + ROW / 2 - 4} width={8} height={8} fill={r.tone} stroke={CARGO_INK} strokeWidth={0.5} />}
              {r.cells.map((c, col) => cell(c, col, y))}
            </g>
          )
        })}
        {withTotal && (
          <g>
            <rect x={MARGIN} y={top + (rows.length + 1) * ROW} width={PAGE.w - 2 * MARGIN} height={ROW} fill={HEAD_BG} stroke={LINE} strokeWidth={0.5} />
            {sheet.cargoTotal.map((c, col) => cell(c, col, top + (rows.length + 1) * ROW, true))}
          </g>
        )}
        <line x1={MARGIN} y1={PAGE.h - 24} x2={PAGE.w - MARGIN} y2={PAGE.h - 24} stroke={LINE} strokeWidth={0.75} />
        <text x={MARGIN} y={PAGE.h - 12} fontSize={8} fill={INK_2}>
          DeckLoad
        </text>
      </g>
    </svg>
  )
}
