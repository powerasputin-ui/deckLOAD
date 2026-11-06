'use client'

import { useId, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { NumberField } from '@/components/calculator/NumberField'
import { isWholeDeckZone, useCalculator, UNIT_LABEL, convertLength } from '@/store/calculator'
import { appliedVessel } from '@/lib/vesselLibrary'
import { cn, fmtNumber } from '@/lib/utils'
import { isObjectKind, objectKindOf, type ObjectKind } from '@/lib/objectKind'

// The vessel's card (spec 8.1): what the calculation is planned for and the
// limits that hold for it — the library vessel's, or the user's own deck's.
// The deck-strength limit is chosen here when the vessel's sources disagree
// (it used to wait in «Зоны нагрузки»); the cargo limit can be changed and
// cleared; «Откуда данные» says what is real and what estimated.
//
// What the deck is of is chosen here too (spec 2026-11-06, 4): a vessel, a
// semi-submersible or a fixed platform. A platform's card has its name and
// the deck's allowed load in place of the vessel's figures; changing the
// kind keeps the deck, the cargo and the other kind's data.
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
  const kind = objectKindOf(deck)
  const platform = kind !== 'vessel'

  return (
    <PanelBlock title={platform ? 'Карточка платформы' : 'Карточка судна'} fold="card">
      <ToggleGroup
        type="single"
        value={kind}
        onValueChange={(v) => isObjectKind(v) && setDeck({ objectKind: v === 'vessel' ? undefined : v })}
        aria-label="Тип объекта"
        className="grid w-full grid-cols-2 gap-1"
      >
        {KIND_CHOICES.map(([value, label]) => (
          <ToggleGroupItem key={value} value={value} className="h-8 text-xs">
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {platform ? (
        <PlatformName key={deck.platformName ?? applied?.label ?? ''} id={`${uid}-name`} value={deck.platformName ?? applied?.label ?? ''} onCommit={(v) => setDeck({ platformName: v || undefined })} />
      ) : (
        <p className="text-sm font-medium" data-testid="vessel-name">
          {applied ? applied.label : 'Своя палуба'}
        </p>
      )}
      <dl className="space-y-1.5 text-sm">
        {!platform && strength && (
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
              {platform ? 'Допускаемая нагрузка на палубу' : 'Наибольший вес груза на палубе'}
            </label>
          </dt>
          {/* The hint inside the <dd>: a <dl> group holds only <dt> and <dd>. */}
          <dd className="space-y-1">
            <div className="flex items-center gap-1.5">
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
            </div>
            <p id={`${uid}-cargo-hint`} className="text-xs text-ink-2">
              {platform ? 'Весь груз на палубе после рейса. Пусто — не проверяется' : 'На рейс. Пусто — лимита нет, вес не проверяется'}
            </p>
          </dd>
        </div>
        {!platform && deck.tenFootContainerCapacity !== undefined && (
          <Row term="Вместимость 10-футовых контейнеров" value={fmtNumber(deck.tenFootContainerCapacity)} />
        )}
        {stackHeightM !== undefined && (
          <Row
            term="Предельная высота штабеля по данным судна"
            value={`${fmtNumber(convertLength(stackHeightM, 'm', deck.unit))} ${UNIT_LABEL[deck.unit]}`}
          />
        )}
        {!platform && applied && (
          <Row
            term="Направление носа"
            value={applied.bowFromData ? 'из данных судна' : 'по умолчанию — проверьте'}
            tone={applied.bowFromData ? undefined : 'text-warn'}
          />
        )}
        {!platform && !applied && <Row term="Данные остойчивости" value={deck.vessel ? 'заданы' : 'не заданы'} />}
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

const KIND_CHOICES: readonly [ObjectKind, string][] = [
  ['vessel', 'Судно'],
  ['semi-sub', 'ППБУ'],
  ['jack-up', 'СПБУ'],
  ['fixed', 'Стационарная'],
]

// The platform's name, applied on Enter or on leaving the field.
function PlatformName({ id, value, onCommit }: { id: string; value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value)
  const commit = () => {
    if (text.trim() !== value) onCommit(text.trim())
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs text-ink-2">
        Название
      </label>
      <Input
        id={id}
        value={text}
        placeholder="Например, «Полярная звезда»"
        className="h-8 text-sm"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
    </div>
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
