import { HULL_SIDE_LABEL, type DrawingEdge, type HullSide } from '@/lib/deckDrawing'
import type { ThemeTokens } from '@/lib/theme'

// Around the deck, as on a drawing (spec 6.1, 9.5): which side of the hull
// each edge is, the deck's overall dimensions and a scale bar. Everything
// sits in the margin outside the deck rectangle and is sized in screen
// pixels — `px` converts them to viewBox units, so the labels stay 12 px
// whatever the window width or zoom.
//
// Two rows run along each edge: the dimension (top and left only) next to
// the deck, the side's name beyond it; along the bottom the name comes first
// and the scale bar under it. DRAWING_MARGIN_PX is what those rows need.
const GAP = 6
const FONT = 12
const ROW = 16
export const DRAWING_MARGIN_PX = GAP + ROW + FONT + 4
// Each edge's share: the right edge carries the side's name alone.
export const DRAWING_MARGINS_PX = { top: DRAWING_MARGIN_PX, right: GAP + FONT + 4, bottom: DRAWING_MARGIN_PX, left: DRAWING_MARGIN_PX }

// Distance from the deck edge to the middle of row 1 or 2, in screen px.
const rowCenter = (row: 1 | 2) => GAP + (row - 1) * ROW + FONT / 2

// The bow's arrow points out of the drawing. Labels on the left and right
// edges are turned to read bottom-to-top, which turns the glyph with them.
export const BOW_ARROW: Record<DrawingEdge, string> = { top: '↑', bottom: '↓', left: '↑', right: '↓' }

export interface ScaleBar {
  // One grid step in viewBox units, how many steps the bar spans, and its label.
  stepUnits: number
  steps: number
  label: string
}

export function DeckDrawingFrame({
  offX,
  offY,
  w,
  h,
  px,
  sides,
  horizontalDimension,
  verticalDimension,
  scaleBar,
  palette,
}: {
  // The deck rectangle in viewBox units.
  offX: number
  offY: number
  w: number
  h: number
  // ViewBox units per screen pixel.
  px: number
  sides: Record<HullSide, DrawingEdge>
  horizontalDimension: string
  verticalDimension: string
  scaleBar: ScaleBar | null
  palette: ThemeTokens
}) {
  const font = FONT * px
  // Row positions outward from each edge.
  const at = (edge: DrawingEdge, row: 1 | 2) => {
    const d = rowCenter(row) * px
    switch (edge) {
      case 'top':
        return { x: offX + w / 2, y: offY - d }
      case 'bottom':
        return { x: offX + w / 2, y: offY + h + d }
      case 'left':
        return { x: offX - d, y: offY + h / 2 }
      case 'right':
        return { x: offX + w + d, y: offY + h / 2 }
    }
  }
  // The top and left edges carry the dimensions in row 1, so their names
  // move out to row 2.
  const nameRow = (edge: DrawingEdge): 1 | 2 => (edge === 'top' || edge === 'left' ? 2 : 1)

  return (
    <g className="pointer-events-none select-none" data-deck-drawing="true">
      <Dimension
        text={horizontalDimension}
        from={offX}
        to={offX + w}
        at={offY - rowCenter(1) * px}
        horizontal
        px={px}
        color={palette.ink2}
      />
      <Dimension
        text={verticalDimension}
        from={offY}
        to={offY + h}
        at={offX - rowCenter(1) * px}
        horizontal={false}
        px={px}
        color={palette.ink2}
      />

      {(Object.keys(sides) as HullSide[]).map((side) => {
        const edge = sides[side]
        const { x, y } = at(edge, nameRow(edge))
        const vertical = edge === 'left' || edge === 'right'
        return (
          <text
            key={side}
            data-hull-side={side}
            data-edge={edge}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={font}
            fontWeight={600}
            letterSpacing="0.08em"
            fill={palette.ink}
            transform={vertical ? `rotate(-90 ${x} ${y})` : undefined}
          >
            {side === 'bow' ? `${BOW_ARROW[edge]} ${HULL_SIDE_LABEL[side]}` : HULL_SIDE_LABEL[side]}
          </text>
        )
      })}

      {scaleBar && (
        <ScaleBarMark bar={scaleBar} x={offX} y={offY + h + rowCenter(2) * px} px={px} color={palette.ink2} />
      )}
    </g>
  )
}

// An overall dimension: a line along the edge with ticks at both ends, broken
// in the middle for the figure. Plex Mono's digits are 0.6 em wide, which
// gives the gap without measuring the text.
function Dimension({
  text,
  from,
  to,
  at,
  horizontal,
  px,
  color,
}: {
  text: string
  from: number
  to: number
  at: number
  horizontal: boolean
  px: number
  color: string
}) {
  const font = FONT * px
  const mid = (from + to) / 2
  const half = (text.length * 0.6 * font) / 2 + 4 * px
  const tick = 4 * px
  const showLine = to - from > half * 2 + 8 * px
  const seg = (a: number, b: number) =>
    horizontal ? <line x1={a} y1={at} x2={b} y2={at} /> : <line x1={at} y1={a} x2={at} y2={b} />
  const tickAt = (v: number) =>
    horizontal ? <line x1={v} y1={at - tick} x2={v} y2={at + tick} /> : <line x1={at - tick} y1={v} x2={at + tick} y2={v} />
  const x = horizontal ? mid : at
  const y = horizontal ? at : mid
  return (
    <g data-dimension={horizontal ? 'horizontal' : 'vertical'}>
      {showLine && (
        <g stroke={color} strokeWidth={px}>
          {seg(from, mid - half)}
          {seg(mid + half, to)}
          {tickAt(from)}
          {tickAt(to)}
        </g>
      )}
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={font}
        className="font-mono"
        fontFamily="monospace"
        fill={color}
        transform={horizontal ? undefined : `rotate(-90 ${x} ${y})`}
      >
        {text}
      </text>
    </g>
  )
}

// The scale bar: grid-step segments, alternately filled, then «2 м · сетка 1 м».
function ScaleBarMark({ bar, x, y, px, color }: { bar: ScaleBar; x: number; y: number; px: number; color: string }) {
  const height = 4 * px
  const length = bar.stepUnits * bar.steps
  return (
    <g data-scale-bar="true">
      {Array.from({ length: bar.steps }, (_, i) => (
        <rect
          key={i}
          x={x + i * bar.stepUnits}
          y={y - height / 2}
          width={bar.stepUnits}
          height={height}
          fill={i % 2 === 0 ? color : 'none'}
          stroke={color}
          strokeWidth={px}
        />
      ))}
      <text
        x={x + length + 6 * px}
        y={y}
        dominantBaseline="central"
        fontSize={FONT * px}
        className="font-mono"
        fontFamily="monospace"
        fill={color}
      >
        {bar.label}
      </text>
    </g>
  )
}
