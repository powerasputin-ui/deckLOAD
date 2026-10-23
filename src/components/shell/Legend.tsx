'use client'

import { useId } from 'react'
import { useTheme } from '@/components/ThemeProvider'
import {
  ConflictHatch,
  HatchPatterns,
  LayerGhosts,
  LockBadge,
  MergeTargetBadge,
  MixedLoadMarker,
  OverloadBadge,
  PowerSocketGlyph,
  RotatedMark,
  SELECTION_HALO_WIDTH,
  StackNumber,
  lashingPointColor,
  stackOutline,
} from '@/components/calculator/deckMarks'
import { cargoToneForNumber } from '@/lib/cargoPalette'
import { THEME_TOKENS, type ThemeTokens } from '@/lib/theme'

const W = 44
const H = 28

interface SampleProps {
  palette: ThemeTokens
  hatch: { free: string; obstacle: string; conflict: string }
}

interface Entry {
  key: string
  label: string
  Sample: (p: SampleProps) => React.ReactNode
}

// A stack as the deck draws it: its tone and outline.
function Stack({ x, y, w, h, ...outline }: { x: number; y: number; w: number; h: number } & Parameters<typeof stackOutline>[0]) {
  const o = stackOutline(outline)
  return <rect x={x} y={y} width={w} height={h} rx={2} fill={cargoToneForNumber(1)} {...o} />
}

const BOX = { x: 6, y: 5, w: 34, h: 19 }

// What the deck draws on stacks (spec 6.3) and on the deck itself, in the
// pieces the deck draws them with (deckMarks.tsx).
const STACK_ENTRIES: Entry[] = [
  {
    key: 'stack',
    label: 'Штабель груза: номер груза в списке, цвет — по номеру',
    Sample: () => (
      <>
        <Stack {...BOX} />
        <StackNumber cx={BOX.x + BOX.w / 2} cy={BOX.y + BOX.h / 2} text="1" fontSize={11} />
      </>
    ),
  },
  {
    key: 'selected',
    label: 'Выделен',
    Sample: ({ palette }) => (
      <>
        <rect x={BOX.x} y={BOX.y} width={BOX.w} height={BOX.h} rx={2} fill="none" stroke={palette.accent} strokeWidth={SELECTION_HALO_WIDTH} />
        <Stack {...BOX} selected />
      </>
    ),
  },
  {
    key: 'locked',
    label: 'Закреплён: авторасстановка его не двигает',
    Sample: () => (
      <>
        <Stack {...BOX} locked />
        <LockBadge {...BOX} />
      </>
    ),
  },
  {
    key: 'layers',
    label: 'Несколько ярусов; «×N» — сколько единиц в штабеле',
    Sample: () => {
      const b = { x: 9, y: 8, w: 32, h: 17 }
      return (
        <>
          <LayerGhosts {...b} count={3} tone={cargoToneForNumber(1)} />
          <Stack {...b} />
          <StackNumber cx={b.x + b.w / 2} cy={b.y + b.h / 2} text="1 ×3" fontSize={11} />
        </>
      )
    },
  },
  {
    key: 'rotated',
    label: 'Повёрнут на 90°',
    Sample: () => (
      <>
        <Stack {...BOX} />
        <RotatedMark x={BOX.x} y={BOX.y} w={BOX.w} />
      </>
    ),
  },
  {
    key: 'mixed',
    label: 'Смешанный штабель: номера всех его грузов через «+»',
    Sample: () => (
      <>
        <Stack {...BOX} />
        <MixedLoadMarker x={BOX.x + 12} y={BOX.y} w={BOX.w - 12} />
        <StackNumber cx={BOX.x + BOX.w / 2 - 4} cy={BOX.y + BOX.h / 2 + 2} text="1+2" fontSize={11} />
      </>
    ),
  },
  {
    key: 'overload',
    label: 'Перегружена зона нагрузки под штабелем',
    Sample: () => (
      <>
        <Stack {...BOX} problem />
        <OverloadBadge x={BOX.x} y={BOX.y} />
      </>
    ),
  },
  {
    key: 'conflict',
    label: 'Стоит там, где нельзя (ручной режим). Причина — при наведении',
    Sample: ({ hatch }) => (
      <>
        <Stack {...BOX} problem />
        <ConflictHatch {...BOX} patternId={hatch.conflict} />
      </>
    ),
  },
  {
    key: 'separation',
    label: 'Стоят ближе, чем требует сепарация: «1.2 м из 3 м»',
    Sample: ({ palette }) => (
      <>
        <Stack x={3} y={8} w={12} h={12} />
        <Stack x={29} y={8} w={12} h={12} />
        <line x1={15} y1={14} x2={29} y2={14} stroke={palette.danger} strokeWidth={2} strokeDasharray="4 3" />
      </>
    ),
  },
  {
    key: 'merge',
    label: 'Сюда можно объединить перетаскиваемый штабель',
    Sample: () => {
      const b = { x: 2, y: 2, w: 40, h: 24 }
      return (
        <>
          <Stack {...b} mergeTarget />
          <MergeTargetBadge {...b} />
        </>
      )
    },
  },
  {
    key: 'merge-blocked',
    label: 'Объединить нельзя: причина — рядом с этим штабелем',
    Sample: () => <Stack x={2} y={2} w={40} h={24} mergeTarget mergeBlocked />,
  },
  {
    key: 'clearance',
    label: 'Зона отступа вокруг штабеля: другой груз сюда не ставится',
    Sample: ({ palette }) => (
      <>
        <Stack x={12} y={9} w={20} h={10} />
        <rect x={3} y={3} width={38} height={22} fill="none" stroke={palette.danger} strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="5 3" />
      </>
    ),
  },
]

const DECK_ENTRIES: Entry[] = [
  {
    key: 'free',
    label: 'Свободное место внутри отступа от борта',
    Sample: ({ hatch }) => <rect x={2} y={2} width={W - 4} height={H - 4} fill={`url(#${hatch.free})`} />,
  },
  {
    key: 'obstacle',
    label: 'Зона ограничений: груз сюда не ставится',
    Sample: ({ palette, hatch }) => (
      <rect
        x={4}
        y={4}
        width={W - 8}
        height={H - 8}
        fill={`url(#${hatch.obstacle})`}
        stroke={palette.danger}
        strokeOpacity={0.8}
        strokeWidth={1.5}
        strokeDasharray="5 3"
      />
    ),
  },
  {
    key: 'load-zone',
    label: 'Зона нагрузки и её предел, т/м²',
    Sample: ({ palette }) => (
      <>
        <rect x={3} y={3} width={W - 6} height={H - 6} fill={palette.ink2} fillOpacity={0.04} stroke={palette.ink2} strokeWidth={1.25} strokeDasharray="6 3" />
        <text x={7} y={17} fontSize={9} fontWeight={600} fill={palette.ink2}>
          5 т/м²
        </text>
      </>
    ),
  },
  {
    key: 'lashing-ok',
    label: 'Точка крепления: крепление удерживает штабель',
    Sample: () => <LashingSample ok />,
  },
  {
    key: 'lashing-short',
    label: 'Точка крепления: сил крепления не хватает',
    Sample: () => <LashingSample ok={false} />,
  },
  {
    key: 'lashing-loose',
    label: 'Точка крепления, не привязанная к штабелю',
    Sample: () => (
      <>
        <circle cx={W / 2} cy={H / 2} r={6} fill={lashingPointColor(null)} stroke="#fff" strokeWidth={1.5} />
        <line x1={W / 2 - 3} y1={H / 2} x2={W / 2 + 3} y2={H / 2} stroke="#fff" strokeWidth={1.2} />
        <line x1={W / 2} y1={H / 2 - 3} x2={W / 2} y2={H / 2 + 3} stroke="#fff" strokeWidth={1.2} />
      </>
    ),
  },
  { key: 'socket', label: 'Розетка', Sample: () => <PowerSocketGlyph x={W / 2} y={H / 2 + 2} /> },
]

// A stack's corner tied to a lashing point.
function LashingSample({ ok }: { ok: boolean }) {
  const color = lashingPointColor({ ok })
  return (
    <>
      <Stack x={4} y={4} w={18} h={14} />
      <line x1={22} y1={18} x2={35} y2={22} stroke={color} strokeWidth={1.5} />
      <circle cx={35} cy={22} r={5} fill={color} stroke="#fff" strokeWidth={1.5} />
    </>
  )
}

// «Вид» → «Условные обозначения» (spec 6.3, 6.10).
export function Legend() {
  const { resolved } = useTheme()
  const palette = THEME_TOKENS[resolved]
  // Pattern ids must be unique in the page and valid in url(#…).
  const base = `legend-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const hatch = { free: `${base}-free`, obstacle: `${base}-obstacle`, conflict: `${base}-conflict` }
  return (
    <div className="space-y-3" data-legend>
      {/* The hatches the samples point at, defined once. */}
      <svg width={0} height={0} className="absolute" aria-hidden="true">
        <defs>
          <HatchPatterns palette={palette} ids={hatch} />
        </defs>
      </svg>
      <LegendSection title="Штабели" entries={STACK_ENTRIES} palette={palette} hatch={hatch} />
      <LegendSection title="Палуба" entries={DECK_ENTRIES} palette={palette} hatch={hatch} />
    </div>
  )
}

function LegendSection({ title, entries, palette, hatch }: { title: string; entries: Entry[] } & SampleProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="space-y-1.5">
      <h3 id={headingId} className="text-xs font-medium text-ink-2">
        {title}
      </h3>
      <ul className="space-y-1.5">
        {entries.map(({ key, label, Sample }) => (
          <li key={key} data-legend-entry={key} className="flex items-center gap-2.5">
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden="true">
              <rect width={W} height={H} rx={3} fill={palette.deck} />
              <Sample palette={palette} hatch={hatch} />
            </svg>
            <span className="text-sm leading-snug">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
