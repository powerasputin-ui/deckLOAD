// The marks the deck draws on stacks and on the deck itself. The legend
// («Вид» → «Условные обозначения») draws its samples with the same pieces,
// so it always shows what the deck shows.
import { CARGO_INK } from '@/lib/cargoPalette'
import type { ThemeTokens } from '@/lib/theme'

export const MARK_COLORS = {
  problem: '#dc2626',
  mergeTarget: '#16a34a',
  hovered: '#94a3b8',
  lockBadge: 'rgba(124,58,237,0.9)',
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
    strokeWidth: s.mergeTarget ? 4 : s.problem ? 3 : s.selected || s.hovered ? 2 : 1,
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
// --danger hatch) and a manual stack standing where it may not. Line opacity
// × line coverage gives the spec's ~0.15 and 0.12 overall tint.
export function HatchPatterns({
  palette,
  ids,
}: {
  palette: ThemeTokens
  ids: { free: string; obstacle: string; conflict: string }
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

// A stack over an overloaded load zone.
export function OverloadBadge({ x, y }: { x: number; y: number }) {
  return (
    <g className="pointer-events-none">
      <circle cx={x + 8} cy={y + 8} r={7} fill={MARK_COLORS.problem} stroke="#fff" strokeWidth={1.2} />
      <text x={x + 8} y={y + 11} fontSize={10} fontWeight={800} textAnchor="middle" fill="#fff" className="select-none">
        !
      </text>
    </g>
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

// A stack the user locked («Закреплён»).
export function LockBadge({ x, y, w, h }: Box) {
  return (
    <g className="pointer-events-none">
      <rect x={x + w - 16} y={y + h - 14} width={14} height={11} rx={2} fill={MARK_COLORS.lockBadge} />
      <text x={x + w - 9} y={y + h - 4.5} fontSize={9} textAnchor="middle" fill="#fff" className="select-none">
        🔒
      </text>
    </g>
  )
}

// The real total unit count of a stack, the same badge for every shape.
export function LayersBadge({ x, y, w, count }: { x: number; y: number; w: number; count: number }) {
  return (
    <g className="pointer-events-none">
      <rect x={x + w - 22} y={y + 2} width={20} height={14} rx={3} fill="rgba(0,0,0,0.55)" />
      <text x={x + w - 12} y={y + 12} fontSize={9} fontWeight={700} textAnchor="middle" fill="#fff" className="select-none">
        ×{count}
      </text>
    </g>
  )
}

// A stack holding more than one cargo: a small split circle just left of the
// ×N badge. Its centre is kept inside the stack, so at the smallest sizes it
// overlaps the badge rather than floating outside the stack.
export function MixedLoadMarker({ x, y, w }: { x: number; y: number; w: number }) {
  const mr = 6
  const mcx = Math.min(Math.max(x + w - 30, x + mr), x + w - mr)
  const mcy = y + 9
  return (
    <g className="pointer-events-none">
      <title>Смешанный груз: несколько видов физически в одном месте</title>
      <circle cx={mcx} cy={mcy} r={mr} fill="#475569" stroke="#fff" strokeWidth={1} />
      <path d={`M ${mcx} ${mcy - mr} A ${mr} ${mr} 0 0 1 ${mcx} ${mcy + mr} L ${mcx} ${mcy - mr} Z`} fill="#cbd5e1" />
    </g>
  )
}

// A single unit turned by 90°.
export function RotatedMark({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <text x={x + w - 6} y={y + 12} fontSize={10} textAnchor="end" fill="rgba(255,255,255,0.9)" className="select-none pointer-events-none">
      ↻
    </text>
  )
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
