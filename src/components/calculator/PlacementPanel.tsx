'use client'

import { useId } from 'react'
import { Unlock, Wand2, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { useCalculator } from '@/store/calculator'
import type { PackVariant, PackingResult } from '@/lib/packing'
import { toast } from 'sonner'

// «Размещение»: the variants, clearing the layout and how the mode works
// (spec 13, stage 2 — today's content; 8.2 rebuilds it in stage 4).
export function PlacementControls({
  mode,
  tripIndex,
  result,
  onAutoRedistribute,
  variants,
  onSelectVariant,
}: {
  mode: 'auto' | 'manual'
  tripIndex: number
  result: PackingResult
  onAutoRedistribute: () => void
  variants?: PackVariant[]
  onSelectVariant?: (v: PackVariant) => void
}) {
  const pinnedPlacementsByTrip = useCalculator((s) => s.pinnedPlacementsByTrip)
  const pinnedPlacements = pinnedPlacementsByTrip[tripIndex] ?? []
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const clearPinned = useCalculator((s) => s.clearPinned)
  const clearManualPlacements = useCalculator((s) => s.clearManualPlacements)
  const globalRotation = useCalculator((s) => s.globalRotation)
  const toggleGlobalRotation = useCalculator((s) => s.toggleGlobalRotation)
  const rotationId = useId()

  const isAuto = mode === 'auto'
  const placements = isAuto ? pinnedPlacements : manualPlacements
  // Round 29 corrective pass: excludes Tier-2 quarantined placements (see
  // PinnedPlacement.malformed) from "is there anything to clear" — they're
  // preserved in the raw arrays above but never rendered/participate in
  // packing, so counting them here would show the "Снять
  // закрепления"/"Очистить" button with nothing visibly on the deck to
  // clear. Reads the authoritative `result.quarantined` (already computed
  // once by packDeck/packingResultFromManual) rather than re-implementing
  // the `malformed && !composition` predicate a second time here.
  const quarantinedIds = new Set(result.quarantined.map((q) => q.id))
  const hasPlacements = placements.some((p) => !quarantinedIds.has(p.id))

  const handleClearAll = () => {
    if (isAuto) {
      clearPinned(tripIndex)
      toast.info('Все закрепления сняты')
    } else {
      clearManualPlacements()
      toast.info('Расстановка очищена')
    }
  }

  return (
    <>
      <PanelBlock title={isAuto ? 'Авто-режим' : 'Ручной режим'}>
        <p className="text-sm text-ink-2">
          {isAuto
            ? 'Грузы расставляются сами, перетаскивание закрепляет штабель на новом месте.'
            : 'Каждый груз ставите вы: «Поставить» в разделе «Грузы», затем клик по палубе.'}
        </p>
        <div className="flex items-start justify-between gap-3">
          <div>
            <label htmlFor={rotationId} className="text-sm">
              Разрешить поворот на 90°
            </label>
            <p id={`${rotationId}-hint`} className="text-xs text-ink-2">
              Авторасстановка может поворачивать грузы.
            </p>
          </div>
          <Switch
            id={rotationId}
            aria-describedby={`${rotationId}-hint`}
            checked={globalRotation}
            onCheckedChange={toggleGlobalRotation}
          />
        </div>
      </PanelBlock>

      <PanelBlock title="Раскладка">
        <Button
          variant="outline"
          size="sm"
          onClick={onAutoRedistribute}
          className="w-full"
          title="Сгенерировать несколько вариантов раскладки"
          data-tour="auto-redistribute"
        >
          <Wand2 className="mr-1.5 h-4 w-4" />
          Автораспределение (варианты)
        </Button>
        {variants && variants.length > 0 && onSelectVariant && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
              <Layers className="h-3.5 w-3.5" />
              Варианты раскладки ({variants.length})
            </div>
            <div className="space-y-1">
              {variants.map((v, i) => (
                <button
                  key={i}
                  onClick={() => onSelectVariant(v)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="truncate text-xs font-medium">{v.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="secondary" className="text-xs">{v.utilizationPct}%</Badge>
                    <span className="text-xs text-ink-2">{v.placedCount} ед.</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-2">Клик по варианту — применить. Кнопка «Автораспределение» — новый набор.</p>
          </div>
        )}
        {hasPlacements && (
          <Button variant="ghost" size="sm" onClick={handleClearAll} className="h-8 w-full text-xs">
            <Unlock className="mr-1.5 h-3.5 w-3.5" />
            {isAuto ? 'Снять все закрепления' : 'Очистить расстановку'}
          </Button>
        )}
      </PanelBlock>

      <PanelBlock title="Как работать с палубой">
        <ul className="space-y-1 text-xs text-ink-2">
          {isAuto ? (
            <>
              <li>• «Поставить» в разделе «Грузы» и клик по палубе — штабель закрепится в этой точке</li>
              <li>• Клик по грузу — выделить; перетащите — закрепится на новом месте</li>
              <li>• ПКМ на грузе — «Закрепить» / «Вернуть в авто»</li>
              <li>• Shift+клик — выбрать несколько · ↻ на грузе — повернуть</li>
            </>
          ) : (
            <>
              <li>• «Поставить» в разделе «Грузы» и клик по палубе; R — повернуть</li>
              <li>• Перетаскивание — переместить</li>
              <li>• ↻ на грузе — повернуть</li>
              <li>• ✕ на грузе — удалить</li>
            </>
          )}
        </ul>
      </PanelBlock>
    </>
  )
}
