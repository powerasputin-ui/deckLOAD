'use client'

import { useId } from 'react'
import { PenLine, RectangleHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { NumberField } from '@/components/calculator/NumberField'
import { convertLength, undoCalculator, useCalculator, UNIT_LABEL, type Unit } from '@/store/calculator'
import { DRAWING_EDGE_WORD, hullSideEdges } from '@/lib/deckDrawing'
import { appliedVessel } from '@/lib/vesselLibrary'
import { fmtNumber } from '@/lib/utils'

// No real vessel's cargo deck comes anywhere close to this — the largest
// container ships afloat run well under 500 m LOA. Without a cap, a stray
// extra digit (e.g. typing "999999999" instead of "20") silently collapses
// the whole deck to a sliver a few px tall on screen and every placed item
// becomes unplaceable, with no error explaining why — this clamp turns that
// into a normal, explained validation instead.
const MAX_DECK_DIMENSION_M = 1000

// «Палуба» (spec 8.1): its size, units, board offset, the stack height it
// allows and which end is the bow. The gap between cargo and the packing
// order are rules of placement, in «Размещение».
//
// Every field applies on Enter/blur, not per keystroke: setDeck() reflows
// and clamps the placements already on the deck whenever the size, board
// offset or stack height changes, and a transient "2" on the way to "24"
// would rearrange (or discard stacked layers from) the user's layout for
// good. See NumberField.
export function DeckBlock() {
  const deck = useCalculator((s) => s.deck)
  const setDeck = useCalculator((s) => s.setDeck)
  const setUnit = useCalculator((s) => s.setUnit)
  const setEditingDeckOutline = useCalculator((s) => s.setEditingDeckOutline)
  const setForward = useCalculator((s) => s.setDeckForwardIsPositiveY)
  const uid = useId()
  const u = UNIT_LABEL[deck.unit]
  const maxDeckInUnit = convertLength(MAX_DECK_DIMENSION_M, 'm', deck.unit)
  const forward = deck.deckForwardIsPositiveY ?? true
  const bow = DRAWING_EDGE_WORD[hullSideEdges(deck.width, deck.length, forward).bow]
  const applied = appliedVessel(deck)

  return (
    <PanelBlock title="Палуба" fold="deck">
      <div data-tour="deck-settings" className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <Field id={`${uid}-width`} label="Ширина (борт–борт)">
            <NumberField
              id={`${uid}-width`}
              min={0.1}
              max={maxDeckInUnit}
              step={0.1}
              value={deck.width}
              onClamp={({ bound, limit }) => {
                if (bound === 'max') toast.warning(`Максимальная ширина палубы — ${fmtNumber(limit)} ${u}`)
              }}
              onCommit={(v) => setDeck({ width: v })}
              className="h-8 text-xs"
            />
          </Field>
          <Field id={`${uid}-length`} label="Длина (нос–корма)">
            <NumberField
              id={`${uid}-length`}
              min={0.1}
              max={maxDeckInUnit}
              step={0.1}
              value={deck.length}
              onClamp={({ bound, limit }) => {
                if (bound === 'max') toast.warning(`Максимальная длина палубы — ${fmtNumber(limit)} ${u}`)
              }}
              onCommit={(v) => setDeck({ length: v })}
              className="h-8 text-xs"
            />
          </Field>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-ink-2" id={`${uid}-unit`}>
            Единицы
          </span>
          <ToggleGroup
            type="single"
            value={deck.unit}
            onValueChange={(v) => v && setUnit(v as Unit)}
            aria-labelledby={`${uid}-unit`}
            className="justify-start"
          >
            <ToggleGroupItem value="m" className="h-7 px-2 text-xs">
              м
            </ToggleGroupItem>
            <ToggleGroupItem value="cm" className="h-7 px-2 text-xs">
              см
            </ToggleGroupItem>
            <ToggleGroupItem value="ft" className="h-7 px-2 text-xs">
              фт
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Field id={`${uid}-offset`} label="Отступ от борта" unit={u}>
          <NumberField
            id={`${uid}-offset`}
            min={0}
            step={0.05}
            value={deck.boardOffset}
            onCommit={(v) => setDeck({ boardOffset: v })}
            className="h-8 flex-1 text-xs"
          />
        </Field>
        <Field id={`${uid}-clearance`} label="Предельная высота штабеля" unit={u}>
          <NumberField
            id={`${uid}-clearance`}
            aria-describedby={`${uid}-clearance-hint`}
            min={0}
            step={0.1}
            value={deck.clearance > 0 ? deck.clearance : undefined}
            onCommit={(v) => setDeck({ clearance: v })}
            onClear={() => setDeck({ clearance: 0 })}
            placeholder="не ограничена"
            className="h-8 flex-1 text-xs"
          />
        </Field>
        <p id={`${uid}-clearance-hint`} className="text-xs text-ink-2">
          Пусто или 0 — палуба высоту не ограничивает: ярусы ограничивают «Ярусов» и предельная высота самого груза, а если не
          задано ни то, ни другое, груз ставится в один ярус. Больше 0 — штабель не выше этой высоты
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-2">
            Нос на схеме: <span className="font-medium text-ink">{bow}</span>
            {applied && !applied.bowFromData && <span className="text-warn"> — по умолчанию, проверьте</span>}
          </span>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setForward(!forward)}>
            Сменить
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditingDeckOutline(true)}>
            <PenLine className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Форма палубы
          </Button>
          {deck.outline && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => {
                setDeck({ outline: undefined })
                toast.info('Палуба снова прямоугольная', { action: { label: 'Отменить', onClick: () => undoCalculator() } })
              }}
            >
              <RectangleHorizontal className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Сбросить к прямоугольнику
            </Button>
          )}
        </div>
      </div>
    </PanelBlock>
  )
}

function Field({ id, label, unit, children }: { id: string; label: string; unit?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs text-ink-2">
        {label}
      </label>
      {unit ? (
        <div className="flex items-center gap-1.5">
          {children}
          <span className="w-6 text-xs text-ink-2">{unit}</span>
        </div>
      ) : (
        children
      )}
    </div>
  )
}
