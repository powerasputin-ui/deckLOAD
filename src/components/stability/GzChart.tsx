'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { GZCurveResult } from '@/lib/stability'
import { fmtNumber } from '@/lib/utils'

// The KN reference's righting-arm curve (spec 2026-10-24, 6.1): GZ against
// heel, one series, so no legend — the heading names it. Straight segments
// between the table's angles, as the areas are integrated. The 0.20 m the
// criteria ask for is a dashed threshold; the angle of downflooding, when
// set, a hairline. Hover or the arrow keys read each angle; the table under
// it gives every value without either. Drawn at the column's own width in
// pixels, so its labels stay at the 12 px of the type scale (spec 9.3)
// rather than shrinking with a scaled viewBox.
//
// The curve's colour is the accent, validated as a one-slot palette with
// the dataviz skill's validator on each theme's surface: #C2410C on #FFFFFF,
// and #E2702A on #122131 — the dark theme's own accent sits above the dark
// lightness band.
const DEFAULT_W = 480
const H = 220
const PAD = { left: 40, right: 14, top: 14, bottom: 30 }
const REQUIRED_GZ = 0.2

function niceStep(span: number): number {
  const raw = span / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / pow
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * pow
}

export function GzChart({ gz, downfloodingAngleDeg }: { gz: GZCurveResult; downfloodingAngleDeg?: number }) {
  const [active, setActive] = useState<number | null>(null)
  const [W, setW] = useState(DEFAULT_W)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const titleId = useId()
  const curve = gz.curve
  const xMax = curve[curve.length - 1]?.heelDeg ?? 0
  const lo = Math.min(0, ...curve.map((p) => p.GZ))
  const hi = Math.max(REQUIRED_GZ, ...curve.map((p) => p.GZ), gz.maxGZ)
  const step = niceStep(hi - lo || 1)
  const yMin = Math.floor(lo / step) * step
  const yMax = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(Math.round(v / step) * step)
  const x = (deg: number) => PAD.left + (xMax > 0 ? (deg / xMax) * (W - PAD.left - PAD.right) : 0)
  const y = (gzM: number) => PAD.top + ((yMax - gzM) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom)
  const points = curve.map((p) => `${x(p.heelDeg)},${y(p.GZ)}`).join(' ')
  const hasPeak = gz.maxGZ > 0
  const shown = active !== null ? curve[active] : null
  // The readout sits right of the point, or left of it past the middle.
  const tipLeft = shown ? x(shown.heelDeg) > W / 2 : false

  const nearest = (clientX: number, rect: DOMRect) => {
    const vx = ((clientX - rect.left) / rect.width) * W
    let best = 0
    curve.forEach((p, i) => {
      if (Math.abs(x(p.heelDeg) - vx) < Math.abs(x(curve[best].heelDeg) - vx)) best = i
    })
    return best
  }

  return (
    <figure className="space-y-2">
      <figcaption id={titleId} className="text-xs text-ink-2">
        Кривая GZ, м, по углу крена, °
      </figcaption>
      <div ref={boxRef} className="w-full">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block touch-none select-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="img"
        aria-labelledby={titleId}
        tabIndex={0}
        onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? 0)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          setActive((a) => Math.max(0, Math.min(curve.length - 1, (a ?? 0) + (e.key === 'ArrowRight' ? 1 : -1))))
        }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className={v === 0 ? 'stroke-line-strong' : 'stroke-line'} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink-2 text-xs tabular-nums">
              {fmtNumber(v)}
            </text>
          </g>
        ))}
        {curve.map((p) => (
          <text key={p.heelDeg} x={x(p.heelDeg)} y={H - PAD.bottom + 16} textAnchor="middle" className="fill-ink-2 text-xs tabular-nums">
            {fmtNumber(p.heelDeg)}°
          </text>
        ))}
        {/* The criterion's threshold, dashed as a threshold. */}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(REQUIRED_GZ)} y2={y(REQUIRED_GZ)} className="stroke-ink-2" strokeWidth={1} strokeDasharray="4 3" />
        <text x={W - PAD.right} y={y(REQUIRED_GZ) - 4} textAnchor="end" className="fill-ink-2 text-xs">
          0.20 м
        </text>
        {downfloodingAngleDeg !== undefined && downfloodingAngleDeg > 0 && downfloodingAngleDeg <= xMax && (
          <g>
            <line x1={x(downfloodingAngleDeg)} x2={x(downfloodingAngleDeg)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-line-strong" strokeWidth={1} />
            <text x={x(downfloodingAngleDeg) + 4} y={PAD.top + 10} className="fill-ink-2 text-xs">
              заливание {fmtNumber(downfloodingAngleDeg)}°
            </text>
          </g>
        )}
        <polyline
          points={points}
          fill="none"
          className="stroke-[#C2410C] dark:stroke-[#E2702A]"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {curve.map((p, i) => (
          <circle
            key={p.heelDeg}
            cx={x(p.heelDeg)}
            cy={y(p.GZ)}
            r={i === active ? 5 : 4}
            className="fill-[#C2410C] stroke-surface dark:fill-[#E2702A]"
            strokeWidth={2}
          />
        ))}
        {hasPeak && (
          <text
            x={x(gz.angleOfMaxGZ)}
            y={y(gz.maxGZ) - 10}
            textAnchor={x(gz.angleOfMaxGZ) > W * 0.75 ? 'end' : 'middle'}
            className="fill-ink text-xs font-medium"
          >
            макс. {fmtNumber(gz.maxGZ)} м при {fmtNumber(gz.angleOfMaxGZ)}°
          </text>
        )}
        {shown && (
          <g pointerEvents="none">
            <line x1={x(shown.heelDeg)} x2={x(shown.heelDeg)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-line-strong" strokeWidth={1} />
            <g transform={`translate(${x(shown.heelDeg) + (tipLeft ? -132 : 10)}, ${Math.min(Math.max(y(shown.GZ) - 36, PAD.top), H - PAD.bottom - 46)})`}>
              <rect width={122} height={44} rx={4} className="fill-surface stroke-line-strong" strokeWidth={1} />
              <text x={8} y={18} className="fill-ink text-sm font-semibold tabular-nums">
                GZ {fmtNumber(shown.GZ)} м
              </text>
              <text x={8} y={35} className="fill-ink-2 text-xs tabular-nums">
                крен {fmtNumber(shown.heelDeg)}°
              </text>
            </g>
          </g>
        )}
      </svg>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-ink-2 hover:text-ink">Таблица GZ</summary>
        <table className="mt-1 w-full max-w-xs text-xs tabular-nums" aria-label="Кривая GZ">
          <thead>
            <tr className="text-ink-2">
              <th scope="col" className="py-0.5 text-left font-medium">
                Крен, °
              </th>
              <th scope="col" className="py-0.5 text-right font-medium">
                GZ, м
              </th>
            </tr>
          </thead>
          <tbody>
            {curve.map((p) => (
              <tr key={p.heelDeg} className="border-t border-line">
                <td className="py-0.5">{fmtNumber(p.heelDeg)}</td>
                <td className="py-0.5 text-right">{fmtNumber(p.GZ)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
