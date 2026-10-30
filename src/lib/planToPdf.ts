import type { jsPDF } from 'jspdf'
import type { PlanDrawing, PlanShape, Stroke } from './planDrawing'

// The plan on paper (planDrawing.ts) drawn into a jsPDF page: vector shapes
// and text in the document's own font, so it prints sharp at any size.
// The document's unit must be points, the drawing's.
export function drawPlanOnPdf(pdf: jsPDF, drawing: PlanDrawing, font: string): void {
  for (const shape of drawing.shapes) drawShape(pdf, shape, font)
  pdf.setLineDashPattern([], 0)
}

// Text is centred on its y: the baseline sits 0.35 em below the centre, as
// on screen (deckMarks.tsx's StackNumber). jsPDF's own alignment isn't used,
// so turned text lines up the same way as level text.
const BASELINE_DROP = 0.35

function drawShape(pdf: jsPDF, s: PlanShape, font: string): void {
  switch (s.kind) {
    case 'poly': {
      const style = paint(pdf, s.fill, s.stroke)
      if (!style || s.points.length < 2) return
      const [first, ...rest] = s.points
      let prev = first
      const deltas = rest.map((p) => {
        const d = [p.x - prev.x, p.y - prev.y]
        prev = p
        return d
      })
      pdf.lines(deltas, first.x, first.y, [1, 1], style, true)
      return
    }
    case 'rect': {
      const style = paint(pdf, s.fill, s.stroke)
      if (!style) return
      const r = Math.min(s.r ?? 0, s.w / 2, s.h / 2)
      if (r > 0) pdf.roundedRect(s.x, s.y, s.w, s.h, r, r, style)
      else pdf.rect(s.x, s.y, s.w, s.h, style)
      return
    }
    case 'ellipse': {
      const style = paint(pdf, s.fill, s.stroke)
      if (style) pdf.ellipse(s.cx, s.cy, s.rx, s.ry, style)
      return
    }
    case 'line':
      setStroke(pdf, s.stroke)
      pdf.line(s.from.x, s.from.y, s.to.x, s.to.y)
      return
    case 'text': {
      pdf.setFont(font, s.bold ? 'bold' : 'normal')
      pdf.setFontSize(s.size)
      pdf.setTextColor(s.color)
      const spacing = s.spacing ?? 0
      const width = pdf.getTextWidth(s.text) + spacing * Math.max(0, [...s.text].length - 1)
      const before = s.anchor === 'middle' ? width / 2 : s.anchor === 'end' ? width : 0
      const drop = BASELINE_DROP * s.size
      const options = spacing ? { charSpace: spacing } : {}
      // Turned a quarter anticlockwise, the text reads bottom to top and its
      // "down" points right.
      if (s.vertical) pdf.text(s.text, s.x + drop, s.y + before, { ...options, angle: 90 })
      else pdf.text(s.text, s.x - before, s.y + drop, options)
      return
    }
  }
}

function setStroke(pdf: jsPDF, stroke: Stroke): void {
  pdf.setDrawColor(stroke.color)
  pdf.setLineWidth(stroke.width)
  pdf.setLineDashPattern(stroke.dash ?? [], 0)
}

// Sets the colours and returns jsPDF's style for fill, stroke or both.
function paint(pdf: jsPDF, fill: string | undefined, stroke: Stroke | undefined): 'F' | 'S' | 'FD' | null {
  if (fill) pdf.setFillColor(fill)
  if (stroke) setStroke(pdf, stroke)
  return fill && stroke ? 'FD' : fill ? 'F' : stroke ? 'S' : null
}
