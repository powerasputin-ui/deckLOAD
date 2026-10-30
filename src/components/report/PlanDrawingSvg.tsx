import type { PlanShape, Stroke } from '@/lib/planDrawing'

// The plan on paper (planDrawing.ts) as SVG: the «Отчёт» preview of a sheet
// and the start screen's picture show exactly what the PDF prints. In
// points, like the PDF; the font is the PDF's PT Sans where the page has it.
export const PLAN_FONT = "'PT Sans', 'IBM Plex Sans', Arial, sans-serif"

export function PlanShapes({ shapes }: { shapes: readonly PlanShape[] }) {
  return (
    <g fontFamily={PLAN_FONT}>
      {shapes.map((s, i) => (
        <Shape key={i} s={s} />
      ))}
    </g>
  )
}

const strokeProps = (stroke?: Stroke) =>
  stroke
    ? { stroke: stroke.color, strokeWidth: stroke.width, strokeDasharray: stroke.dash?.join(' '), strokeLinejoin: 'round' as const }
    : { stroke: 'none' }

function Shape({ s }: { s: PlanShape }) {
  switch (s.kind) {
    case 'poly':
      return <polygon points={s.points.map((p) => `${p.x},${p.y}`).join(' ')} fill={s.fill ?? 'none'} {...strokeProps(s.stroke)} />
    case 'rect': {
      const r = Math.min(s.r ?? 0, s.w / 2, s.h / 2)
      return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={r} ry={r} fill={s.fill ?? 'none'} {...strokeProps(s.stroke)} />
    }
    case 'ellipse':
      return <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={s.fill ?? 'none'} {...strokeProps(s.stroke)} />
    case 'line':
      return <line x1={s.from.x} y1={s.from.y} x2={s.to.x} y2={s.to.y} {...strokeProps(s.stroke)} />
    case 'text':
      return (
        <text
          x={s.x}
          y={s.y}
          fontSize={s.size}
          fontWeight={s.bold ? 700 : 400}
          fill={s.color}
          textAnchor={s.anchor}
          dominantBaseline="central"
          letterSpacing={s.spacing}
          transform={s.vertical ? `rotate(-90 ${s.x} ${s.y})` : undefined}
        >
          {s.text}
        </text>
      )
  }
}
