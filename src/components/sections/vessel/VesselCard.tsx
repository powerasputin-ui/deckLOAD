'use client'

import { useId } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { NumberField } from '@/components/calculator/NumberField'
import { isWholeDeckZone, useCalculator, UNIT_LABEL, convertLength } from '@/store/calculator'
import { appliedVessel } from '@/lib/vesselLibrary'
import { cn, fmtNumber } from '@/lib/utils'

// The vessel's card (spec 8.1): what the calculation is planned for and the
// limits that hold for it — the library vessel's, or the user's own deck's.
// The deck-strength limit is chosen here when the vessel's sources disagree
// (it used to wait in «Зоны нагрузки»); the cargo limit can be changed and
// cleared; «Откуда данные» says what is real and what estimated.
export function VesselCard() {
  const deck = useCalculator((s) => s.deck)
  const setDeck = useCalculator((s) => s.setDeck)
  const chooseDeckStrength = useCalculator((s) => s.chooseDeckStrength)
  const uid = useId()
  // The vessel as the calculation copied it when applied.
  const applied = appliedVessel(deck)
  const strength = applied?.deckStrengthTPerM2
  const choice = deck.deckStrengthChoiceTPerM2
  const pending = !!strength && choice === undefined
  // The choice made, but the zone over the whole deck that carries it gone.
  const zoneMissing = !!strength && choice !== undefined && !(deck.loadZones ?? []).some((z) => isWholeDeckZone(z, deck.width, deck.length))
  const stackHeightM = applied?.maxStackHeightM

  return (
    <PanelBlock title="Карточка судна" fold="card">
      <p className="text-sm font-medium" data-testid="vessel-name">
        {applied ? applied.label : 'Своя палуба'}
      </p>
      <dl className="space-y-1.5 text-sm">
        {strength && (
          <div className={cn('space-y-1.5 rounded-md border p-2', pending ? 'border-warn bg-warn-bg' : 'border-line')}>
            <dt className="flex items-center justify-between gap-2">
              <span className="text-ink-2">Прочность палубы</span>
              {pending ? (
                <span className="flex items-center gap-1 text-xs font-medium text-warn">
                  <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  лимит не выбран
                </span>
              ) : (
                <span className="font-medium tabular-nums">{fmtNumber(choice ?? 0)} т/м²</span>
              )}
            </dt>
            <dd className="space-y-1.5">
              <p className="text-xs text-ink-2">Источники расходятся: {strength.sources}. Выбор задаёт зону нагрузки на всю палубу.</p>
              <div className="flex gap-1.5" role="group" aria-label="Лимит прочности палубы">
                {(strength.min === strength.max ? [strength.min] : [strength.min, strength.max]).map((v) => (
                  <Button
                    key={v}
                    size="sm"
                    variant={choice === v ? 'default' : 'outline'}
                    aria-pressed={choice === v}
                    className="h-7 flex-1 text-xs"
                    onClick={() => chooseDeckStrength(v)}
                  >
                    {fmtNumber(v)} т/м²
                  </Button>
                ))}
              </div>
              {zoneMissing && (
                <p className="text-xs text-warn">Зоны на всю палубу нет, лимит не проверяется. Нажмите выбранное значение, чтобы вернуть её.</p>
              )}
            </dd>
          </div>
        )}
        <div className="space-y-1">
          <dt>
            <label htmlFor={`${uid}-cargo`} className="text-ink-2">
              Наибольший вес груза на палубе
            </label>
          </dt>
          <dd className="flex items-center gap-1.5">
            <NumberField
              id={`${uid}-cargo`}
              aria-describedby={`${uid}-cargo-hint`}
              min={0.1}
              step={10}
              value={deck.maxDeckCargoT}
              onCommit={(v) => setDeck({ maxDeckCargoT: v })}
              onClear={() => setDeck({ maxDeckCargoT: undefined })}
              placeholder="не задан"
              className="h-8 flex-1 text-xs"
            />
            <span className="w-6 text-xs text-ink-2">т</span>
          </dd>
          <p id={`${uid}-cargo-hint`} className="text-xs text-ink-2">
            На рейс. Пусто — лимита нет, вес не проверяется
          </p>
        </div>
        {deck.tenFootContainerCapacity !== undefined && (
          <Row term="Вместимость 10-футовых контейнеров" value={fmtNumber(deck.tenFootContainerCapacity)} />
        )}
        {stackHeightM !== undefined && (
          <Row
            term="Предельная высота штабеля по данным судна"
            value={`${fmtNumber(convertLength(stackHeightM, 'm', deck.unit))} ${UNIT_LABEL[deck.unit]}`}
          />
        )}
        {applied && (
          <Row
            term="Направление носа"
            value={applied.bowFromData ? 'из данных судна' : 'по умолчанию — проверьте'}
            tone={applied.bowFromData ? undefined : 'text-warn'}
          />
        )}
        {!applied && <Row term="Данные остойчивости" value={deck.vessel ? 'заданы' : 'не заданы'} />}
      </dl>
      {applied?.note && (
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-2 hover:text-ink">Откуда данные</summary>
          <p className="mt-1 whitespace-pre-line text-ink-2" data-testid="vessel-note">
            {applied.note}
          </p>
        </details>
      )}
    </PanelBlock>
  )
}

function Row({ term, value, tone }: { term: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{term}</dt>
      <dd className={cn('shrink-0 whitespace-nowrap text-right font-medium tabular-nums', tone)}>{value}</dd>
    </div>
  )
}
