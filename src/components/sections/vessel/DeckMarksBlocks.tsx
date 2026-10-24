'use client'

import { Ban, Circle, Diamond, MessageSquare, Pencil, Plug, Square, Trash2, Triangle } from 'lucide-react'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { NumberField } from '@/components/calculator/NumberField'
import { TextField } from '@/components/calculator/TextField'
import { useCalculator, UNIT_LABEL } from '@/store/calculator'
import type { RestrictionZoneShape } from '@/lib/packing'
import { cn, fmtNumber } from '@/lib/utils'

// Stable empty-array references for zustand selectors — a fresh `[]` every
// selector call reads as "the snapshot changed" and re-renders forever.
const EMPTY_ZONES: never[] = []
const EMPTY_SOCKETS: never[] = []
const EMPTY_MARKS: never[] = []

// What «Судно» keeps of the deck that isn't cargo (spec 7.5, 8.1): the
// obstacles cargo can't stand on, the marks written on the drawing and the
// reefer sockets. They were in «Пресеты» with the cargo templates.

const SHAPES: { shapeType: RestrictionZoneShape; label: string; Icon: typeof Square }[] = [
  { shapeType: 'rect', label: 'Прямоугольник', Icon: Square },
  { shapeType: 'triangle', label: 'Треугольник', Icon: Triangle },
  { shapeType: 'oval', label: 'Овал', Icon: Circle },
  { shapeType: 'diamond', label: 'Ромб', Icon: Diamond },
]

// A tool that stays on until it's pressed again, Esc, or another tool.
function ToolButton({ pressed, onClick, children, label }: { pressed: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        pressed ? 'border-line-strong bg-accent font-medium' : 'border-line hover:bg-accent'
      )}
    >
      {children}
    </button>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink-2">{children}</p>
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-2 hover:bg-accent hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  )
}

export function ObstaclesBlock() {
  const zones = useCalculator((s) => s.deck.restrictionZones ?? EMPTY_ZONES)
  const unit = useCalculator((s) => s.deck.unit)
  const drawingShape = useCalculator((s) => s.drawingRestrictionShape)
  const setDrawingShape = useCalculator((s) => s.setDrawingRestrictionShape)
  const freeform = useCalculator((s) => s.drawingRestrictionZoneFreeform)
  const setFreeform = useCalculator((s) => s.setDrawingRestrictionZoneFreeform)
  const updateZone = useCalculator((s) => s.updateRestrictionZone)
  const removeZone = useCalculator((s) => s.removeRestrictionZone)
  const u = UNIT_LABEL[unit]

  return (
    <PanelBlock title="Препятствия">
      <Hint>Груз в препятствие не ставится — ни вручную, ни авторасстановкой.</Hint>
      <div role="group" aria-label="Нарисовать препятствие" className="flex flex-wrap gap-1.5">
        {SHAPES.map(({ shapeType, label, Icon }) => (
          <ToolButton key={shapeType} label={label} pressed={drawingShape === shapeType} onClick={() => setDrawingShape(drawingShape === shapeType ? null : shapeType)}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </ToolButton>
        ))}
        <ToolButton pressed={freeform} onClick={() => setFreeform(!freeform)}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Нарисовать
        </ToolButton>
      </div>
      {drawingShape && <Hint>Потяните на палубе, чтобы задать размер. Название — в форме, которая появится; Esc — отмена.</Hint>}
      {freeform && <Hint>Кликайте по палубе, ставя точки контура (не меньше 3), и замкните его кликом у первой точки. Backspace — убрать точку, Esc — отмена.</Hint>}
      {zones.length > 0 && (
        <ul className="space-y-1.5" aria-label="Препятствия на палубе">
          {zones.map((z) => (
            <li key={z.id} className="flex items-center gap-1.5 text-sm">
              <Ban className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{z.name}</span>
              {z.shapeType === 'custom' ? (
                <span className="text-xs text-ink-2">
                  своя форма, {fmtNumber(z.width)}×{fmtNumber(z.length)} {u}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-ink-2">
                  <NumberField
                    aria-label={`Ширина «${z.name}», ${u}`}
                    value={z.width}
                    min={0.01}
                    onCommit={(v) => updateZone(z.id, { width: v })}
                    className="h-7 w-14 px-1.5 text-right text-xs tabular-nums"
                  />
                  ×
                  <NumberField
                    aria-label={`Длина «${z.name}», ${u}`}
                    value={z.length}
                    min={0.01}
                    onCommit={(v) => updateZone(z.id, { length: v })}
                    className="h-7 w-14 px-1.5 text-right text-xs tabular-nums"
                  />
                  {u}
                </span>
              )}
              <RemoveButton label={`Удалить препятствие «${z.name}»`} onClick={() => removeZone(z.id)} />
            </li>
          ))}
        </ul>
      )}
    </PanelBlock>
  )
}

export function SocketsBlock() {
  const sockets = useCalculator((s) => s.deck.powerSockets ?? EMPTY_SOCKETS)
  const placing = useCalculator((s) => s.placingPowerSocket)
  const setPlacing = useCalculator((s) => s.setPlacingPowerSocket)
  const removeSocket = useCalculator((s) => s.removePowerSocket)
  return (
    <PanelBlock title="Розетки">
      <ToolButton pressed={placing} onClick={() => setPlacing(!placing)}>
        <Plug className="h-4 w-4" aria-hidden="true" />
        Поставить розетку
      </ToolButton>
      {placing && <Hint>Кликните у края палубы — розетка встанет на ближайшую точку контура. Это метка для рефконтейнеров, груз рядом ставить можно.</Hint>}
      {sockets.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Розетки на палубе">
          {sockets.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1 rounded-md border border-line pl-2 text-sm">
              <Plug className="h-3.5 w-3.5 text-ink-2" aria-hidden="true" />
              {i + 1}
              <RemoveButton label={`Удалить розетку ${i + 1}`} onClick={() => removeSocket(s.id)} />
            </li>
          ))}
        </ul>
      )}
    </PanelBlock>
  )
}

export function MarksBlock() {
  const marks = useCalculator((s) => s.deck.annotations ?? EMPTY_MARKS)
  const placing = useCalculator((s) => s.placingAnnotation)
  const setPlacing = useCalculator((s) => s.setPlacingAnnotation)
  const updateMark = useCalculator((s) => s.updateAnnotation)
  const removeMark = useCalculator((s) => s.removeAnnotation)
  const armed = placing?.kind === 'note'
  return (
    <PanelBlock title="Метки">
      <div className="flex flex-wrap gap-1.5">
        <ToolButton pressed={armed && !placing.withLeader} onClick={() => setPlacing(armed && !placing.withLeader ? null : { kind: 'note', withLeader: false })}>
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          Заметка
        </ToolButton>
        <ToolButton pressed={armed && placing.withLeader} onClick={() => setPlacing(armed && placing.withLeader ? null : { kind: 'note', withLeader: true })}>
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          Со сноской
        </ToolButton>
      </div>
      {placing && (
        <Hint>
          {placing.withLeader
            ? 'Клик 1 — точка, на которую указывает сноска (можно на груз). Клик 2 — где встанет текст.'
            : 'Кликните по палубе — текст встанет в этой точке. Сам текст задайте в списке ниже.'}
        </Hint>
      )}
      {marks.length > 0 && (
        <ul className="space-y-1.5" aria-label="Метки на палубе">
          {marks.map((a, i) => (
            <li key={a.id} className="flex items-center gap-1.5">
              <TextField
                label={`Текст метки ${i + 1}`}
                value={a.text}
                placeholder="Текст"
                onCommit={(text) => updateMark(a.id, { text })}
                className="h-7 min-w-0 flex-1 px-1.5 text-sm"
              />
              {a.leaderX !== undefined && (
                <button
                  type="button"
                  onClick={() => updateMark(a.id, { leaderX: undefined, leaderY: undefined })}
                  className="shrink-0 text-xs text-ink-2 underline hover:text-ink"
                >
                  Без сноски
                </button>
              )}
              <RemoveButton label={`Удалить метку ${i + 1}`} onClick={() => removeMark(a.id)} />
            </li>
          ))}
        </ul>
      )}
    </PanelBlock>
  )
}
