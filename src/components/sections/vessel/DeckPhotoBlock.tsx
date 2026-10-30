'use client'

import { useId, useRef } from 'react'
import { Move, Ratio, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { undoCalculator, useCalculator } from '@/store/calculator'
import { readDeckPhoto } from '@/lib/deckPhoto'

// «Фото палубы» (spec 8.1): a photo or drawing of the real deck under the
// plan — loaded or replaced, its transparency, moved and scaled or
// calibrated by a distance known on it, removed. It was a button over the
// deck; the deck's right-click still offers «Загрузить фото».
export function DeckPhotoBlock() {
  const photo = useCalculator((s) => s.deck.backgroundImage)
  const opacity = useCalculator((s) => s.deck.backgroundImageOpacity ?? 0.5)
  const deckWidth = useCalculator((s) => s.deck.width)
  const deckLength = useCalculator((s) => s.deck.length)
  const tool = useCalculator((s) => s.deckPhotoTool)
  const setTool = useCalculator((s) => s.setDeckPhotoTool)
  const setPhoto = useCalculator((s) => s.setDeckBackgroundImage)
  const setOpacity = useCalculator((s) => s.setDeckBackgroundImageOpacity)
  const fileRef = useRef<HTMLInputElement>(null)
  const uid = useId()

  const load = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // the same file can be chosen again
    if (!file) return
    try {
      const { dataUrl, rect } = await readDeckPhoto(file, deckWidth, deckLength)
      setPhoto(dataUrl, rect)
    } catch {
      toast.error('Не удалось загрузить фото палубы')
    }
  }

  return (
    <PanelBlock title="Фото палубы" fold="photo">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={load} data-testid="deck-photo-input" />
      <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => fileRef.current?.click()}>
        <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {photo ? 'Заменить фото' : 'Загрузить фото'}
      </Button>
      {photo && (
        <>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-ink-2">
              <label htmlFor={`${uid}-opacity`}>Прозрачность</label>
              <span className="tabular-nums">{Math.round(opacity * 100)}%</span>
            </div>
            <input
              id={`${uid}-opacity`}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              variant={tool === 'move' ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={tool === 'move'}
              className="h-8 text-xs"
              onClick={() => setTool(tool === 'move' ? null : 'move')}
            >
              <Move className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Переместить
            </Button>
            <Button
              type="button"
              variant={tool === 'calibrate' ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={tool === 'calibrate'}
              className="h-8 text-xs"
              onClick={() => setTool(tool === 'calibrate' ? null : 'calibrate')}
            >
              <Ratio className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Калибровать
            </Button>
          </div>
          {/* What to do is said on the deck, next to where it's done. */}
          <p className="text-xs text-ink-2">
            {tool
              ? 'Подсказка — внизу палубы; Esc — готово'
              : 'Переместить и масштабировать — на палубе; калибровка — по двум точкам и известному расстоянию'}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-full text-xs text-danger hover:text-danger"
            onClick={() => {
              setTool(null)
              setPhoto(null)
              toast.info('Фото палубы удалено', { action: { label: 'Отменить', onClick: () => undoCalculator() } })
            }}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Удалить фото
          </Button>
        </>
      )}
    </PanelBlock>
  )
}
