// The marks the deck draws on stacks and on the deck itself. The legend
// («Вид» → «Условные обозначения») draws its samples with the same pieces,
// so it always shows what the deck shows.
import { CARGO_INK } from '@/lib/cargoPalette'
import type { ThemeTokens } from '@/lib/theme'

export const MARK_COLORS = {
  problem: '#dc2626',
  mergeTarget: '#16a34a',
  hovered: '#94a3b8',
  // Badges in a stack's corners (spec 6.3), white glyphs on these.
  badge: CARGO_INK,
  lashingShortBadge: '#B45309',
  // A lashing point attached to a stack whose forces balance, one whose
  // forces don't, and one not attached to a stack.
  lashingOk: '#16a34a',
  lashingShort: '#dc2626',
  lashingLoose: 'rgba(15,23,42,0.85)',
  socket: '#f59e0b',
} as const

// A stack's outline: the target of a merge being dragged (red when the merge
// can't be done), a problem (an overloaded zone or a manual stack where it
// may not stand), selected, under the pointer, or plain. A locked stack is
// dashed. A selected stack also gets the halo (SELECTION_HALO_WIDTH).
export function stackOutline(s: {
  mergeTarget?: boolean
  mergeBlocked?: boolean
  problem?: boolean
  selected?: boolean
  hovered?: boolean
  locked?: boolean
}): { stroke: string; strokeWidth: number; strokeDasharray?: string } {
  return {
    stroke: s.mergeTarget
      ? s.mergeBlocked
        ? MARK_COLORS.problem
        : MARK_COLORS.mergeTarget
      : s.problem
        ? MARK_COLORS.problem
        : s.hovered && !s.selected
          ? MARK_COLORS.hovered
          : CARGO_INK,
    strokeWidth: s.mergeTarget ? 4 : s.problem || s.selected || s.hovered ? 2 : 1,
    strokeDasharray: s.mergeTarget ? '6 3' : s.locked ? '4 2' : undefined,
  }
}

// The selection (spec 6.3): an inner dark line of 2 px — the stack's own
// outline — and an outer accent band of 3 px. The band is the stack's shape
// drawn underneath with a stroke this wide: centred on the edge, it reaches
// 4 px out, 3 px past the inner line; the stack's fill covers its inner half.
export const SELECTION_HALO_WIDTH = 8

interface Box {
  x: number
  y: number
  w: number
  h: number
}

// The hatches: free space (a light --ok hatch, spec 9.5), obstacles (a
// --danger hatch), a manual stack standing where it may not, and a load zone
// carrying more than its limit. Line opacity × line coverage gives the
// spec's ~0.15 and 0.12 overall tint.
export function HatchPatterns({
  palette,
  ids,
}: {
  palette: ThemeTokens
  ids: { free: string; obstacle: string; conflict: string; overload: string }
}) {
  return (
    <>
      <pattern id={ids.free} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="8" height="8" fill="transparent" />
        <line x1="0" y1="0" x2="0" y2="8" stroke={palette.ok} strokeOpacity={0.4} strokeWidth="3" />
      </pattern>
      <pattern id={ids.obstacle} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="transparent" />
        <line x1="0" y1="0" x2="0" y2="6" stroke={palette.danger} strokeOpacity={0.5} strokeWidth="1.5" />
      </pattern>
      <pattern id={ids.conflict} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke={palette.danger} strokeOpacity={0.85} strokeWidth="2.5" />
      </pattern>
      {/* An overloaded load zone: the other way from obstacles. */}
      <pattern id={ids.overload} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <rect width="7" height="7" fill="transparent" />
        <line x1="0" y1="0" x2="0" y2="7" stroke={palette.danger} strokeOpacity={0.3} strokeWidth="2" />
      </pattern>
    </>
  )
}

// Stacked-layers cue: faint offset "ghost" outlines behind the main box, so a
// multi-layer footprint reads as a physical pile rather than just the "×N"
// badge.
export function LayerGhosts({ x, y, w, h, count, tone }: Box & { count: number; tone: string }) {
  return (
    <g className="pointer-events-none" opacity={0.5}>
      <rect x={x - 3} y={y - 3} width={w} height={h} rx={2} fill="none" stroke={tone} strokeWidth={1.5} />
      {count > 2 && <rect x={x - 6} y={y - 6} width={w} height={h} rx={2} fill="none" stroke={tone} strokeWidth={1.5} />}
    </g>
  )
}

// Red hatching over a manual stack standing where it may not.
export function ConflictHatch({ x, y, w, h, patternId }: Box & { patternId: string }) {
  return <rect data-conflict="true" x={x} y={y} width={w} height={h} rx={2} fill={`url(#${patternId})`} className="pointer-events-none" />
}

// The marks in a stack's corners (spec 6.3) are sized in screen pixels, like
// its label: `px` is drawing units per screen pixel (DeckVisualization's
// labelPx; 1 in the legend). Each is drawn in its own box from (0, 0) and
// moved into place. They keep 2 px from the stack's edges.
const INSET = 2

function CornerMark({ mark, x, y, px, children }: { mark: string; x: number; y: number; px: number; children: React.ReactNode }) {
  return (
    <g data-mark={mark} className="pointer-events-none" transform={`translate(${x} ${y}) scale(${px})`}>
      {children}
    </g>
  )
}

// A stack over an overloaded load zone: «!» in a red triangle, top left.
export const OVERLOAD_MARK = { w: 16, h: 14 }
export function OverloadBadge({ x, y, px = 1 }: { x: number; y: number; px?: number }) {
  return (
    <CornerMark mark="overload" x={x + INSET * px} y={y + INSET * px} px={px}>
      <polygon points="8,0 16,14 0,14" fill={MARK_COLORS.problem} stroke="#fff" strokeWidth={1} strokeLinejoin="round" />
      <rect x={7.25} y={4.5} width={1.5} height={5} rx={0.5} fill="#fff" />
      <circle cx={8} cy={11.4} r={0.95} fill="#fff" />
    </CornerMark>
  )
}

// The stack a dragged one would merge into.
export function MergeTargetBadge({ x, y, w, h }: Box) {
  return (
    <g className="pointer-events-none">
      <rect x={x + w / 2 - 14} y={y + h / 2 - 12} width={28} height={24} rx={4} fill="rgba(22,163,74,0.95)" stroke="#fff" strokeWidth={1.5} />
      <text x={x + w / 2} y={y + h / 2 + 5} textAnchor="middle" fontSize={16} fontWeight={800} fill="#fff" className="select-none">
        +
      </text>
    </g>
  )
}

// A stack's label (spec 6.2): its cargo number — «3», «3 ×4», «3+4 ×16» —
// in dark ink over the cargo's light tone, centred on (cx, cy). Where it
// spills over its stack, a halo of the deck's surface keeps it legible.
export function StackNumber({
  cx,
  cy,
  text,
  fontSize,
  halo,
  ...rest
}: { cx: number; cy: number; text: string; fontSize: number; halo?: string } & Omit<
  React.SVGProps<SVGTextElement>,
  'x' | 'y' | 'fontSize' | 'children'
>) {
  return (
    <text
      x={cx}
      y={cy + fontSize * 0.35}
      textAnchor="middle"
      fontSize={fontSize}
      fontWeight={600}
      fill={CARGO_INK}
      className="select-none pointer-events-none"
      style={halo ? { paintOrder: 'stroke', stroke: halo, strokeWidth: fontSize * 0.3, strokeLinejoin: 'round' } : undefined}
      {...rest}
    >
      {text}
    </text>
  )
}

// A badge in a stack's corner (spec 6.3): 14 × 14 px, a white glyph on it.
export const BADGE = 14

// A stack the user fixed in place («Закреплён»): a padlock, bottom right.
export function LockBadge({ x, y, w, h, px = 1 }: Box & { px?: number }) {
  return (
    <CornerMark mark="lock" x={x + w - (BADGE + INSET) * px} y={y + h - (BADGE + INSET) * px} px={px}>
      <rect width={BADGE} height={BADGE} rx={3} fill={MARK_COLORS.badge} />
      <path d="M 4.6 6.6 V 5.2 a 2.4 2.4 0 0 1 4.8 0 V 6.6" fill="none" stroke="#fff" strokeWidth={1.4} />
      <rect x={3.4} y={6.4} width={7.2} height={5} rx={1} fill="#fff" />
    </CornerMark>
  )
}

// A stack whose lashing falls short (spec 6.3): an amber chain, bottom left.
export function LashingShortBadge({ x, y, h, px = 1 }: { x: number; y: number; h: number; px?: number }) {
  return (
    <CornerMark mark="lashing-short" x={x + INSET * px} y={y + h - (BADGE + INSET) * px} px={px}>
      <rect width={BADGE} height={BADGE} rx={3} fill={MARK_COLORS.lashingShortBadge} />
      <g transform="rotate(-45 7 7)" fill="none" stroke="#fff" strokeWidth={1.4}>
        <rect x={1.8} y={5.2} width={6} height={3.6} rx={1.8} />
        <rect x={6.2} y={5.2} width={6} height={3.6} rx={1.8} />
      </g>
    </CornerMark>
  )
}

// A stack an old file merged without keeping what it is made of (spec 6.3):
// «?», bottom left — or next to the chain when that is there too (`offset`,
// screen px).
export function UnknownMakeupBadge({ x, y, h, offset = 0, px = 1 }: { x: number; y: number; h: number; offset?: number; px?: number }) {
  return (
    <CornerMark mark="unknown-makeup" x={x + (INSET + offset) * px} y={y + h - (BADGE + INSET) * px} px={px}>
      <rect width={BADGE} height={BADGE} rx={3} fill={MARK_COLORS.badge} />
      <text x={BADGE / 2} y={10.6} fontSize={11} fontWeight={700} textAnchor="middle" fill="#fff" className="select-none">
        ?
      </text>
    </CornerMark>
  )
}

// A stack holding more than one cargo: a small split circle near its top
// right corner, its centre kept inside the stack at any size.
export function MixedLoadMarker({ x, y, w, px = 1 }: { x: number; y: number; w: number; px?: number }) {
  const mr = 6 * px
  const mcx = Math.min(Math.max(x + w - 30 * px, x + mr), x + w - mr)
  const mcy = y + 9 * px
  return (
    <g className="pointer-events-none">
      <title>Смешанный груз: несколько видов физически в одном месте</title>
      <circle cx={mcx} cy={mcy} r={mr} fill="#475569" stroke="#fff" strokeWidth={px} />
      <path d={`M ${mcx} ${mcy - mr} A ${mr} ${mr} 0 0 1 ${mcx} ${mcy + mr} L ${mcx} ${mcy - mr} Z`} fill="#cbd5e1" />
    </g>
  )
}

// A single unit turned by 90°: «↻» in the top right corner, in the ink of
// the stack's number — white was lost on the light tones.
export function RotatedMark({ x, y, w, px = 1 }: { x: number; y: number; w: number; px?: number }) {
  return (
    <text
      data-mark="rotated"
      x={x + w - 6 * px}
      y={y + 12 * px}
      fontSize={10 * px}
      textAnchor="end"
      fill={CARGO_INK}
      fillOpacity={0.75}
      className="select-none pointer-events-none"
    >
      ↻
    </text>
  )
}

// Where the corner marks go on a stack `w` × `h` screen px whose label
// takes `labelW` × `labelH` px in its middle (0 × 0 without one): a mark is
// drawn only where it leaves the number clear (spec 6.2 — the number comes
// first). The stack's outline still shows a lock (dashed) and a problem
// (red); «Проверки» and the inspector list everything.
export function cornerMarksFit(w: number, h: number, labelW: number, labelH: number) {
  // Clear of the label sideways when its inner edge is `edge` px from the
  // stack's side, or above or below it when `edge` px from the top or bottom.
  const clear = (sideways: number, upright: number) =>
    labelW === 0 || (w - labelW) / 2 >= sideways || (h - labelH) / 2 >= upright
  const holds = (mw: number, mh: number) => w >= mw + 2 * INSET && h >= mh + 2 * INSET
  return {
    overload: holds(OVERLOAD_MARK.w, OVERLOAD_MARK.h) && clear(OVERLOAD_MARK.w + INSET, OVERLOAD_MARK.h + INSET),
    badge: holds(BADGE, BADGE) && clear(BADGE + INSET, BADGE + INSET),
    // A second badge beside the first one in the bottom left corner.
    secondBadge: holds(2 * BADGE + INSET, BADGE) && clear(2 * BADGE + 2 * INSET, BADGE + INSET),
    mixed: holds(12, 12) && clear(36, 15),
    rotated: holds(12, 12) && clear(17, 14),
  }
}

// A lashing point's fill: attached to a stack whose forces balance or don't,
// or not attached to any stack.
export function lashingPointColor(check?: { ok: boolean } | null): string {
  return check ? (check.ok ? MARK_COLORS.lashingOk : MARK_COLORS.lashingShort) : MARK_COLORS.lashingLoose
}

// Hand-drawn plug glyph for power-socket markers: every marker on the deck is
// plain SVG, no icon font. A small amber rounded body with two short prongs,
// distinct in colour from the dark lashing pin and the zone strokes, so it
// reads as "electrical" at a glance.
export function PowerSocketGlyph({
  x,
  y,
  interactive,
  onPointerDown,
}: {
  x: number
  y: number
  interactive?: boolean
  onPointerDown?: (e: React.PointerEvent) => void
}) {
  return (
    <g style={interactive ? { cursor: 'move' } : undefined} onPointerDown={onPointerDown}>
      {interactive && <circle cx={x} cy={y} r={9} fill="transparent" />}
      <rect x={x - 6} y={y - 5} width={12} height={10} rx={2.5} fill={MARK_COLORS.socket} stroke="#fff" strokeWidth={1.2} />
      <line x1={x - 2.5} y1={y - 5} x2={x - 2.5} y2={y - 8} stroke="#fff" strokeWidth={1.4} />
      <line x1={x + 2.5} y1={y - 5} x2={x + 2.5} y2={y - 8} stroke="#fff" strokeWidth={1.4} />
    </g>
  )
}
