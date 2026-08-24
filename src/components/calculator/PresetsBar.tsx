'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plug, Sparkles, Trash2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useCalculator, PRESETS, PALETTE, PRESET_TEMPLATE_COLORS } from '@/store/calculator'
import { type CargoShape } from '@/lib/packing'
import { cn } from '@/lib/utils'

// Stable empty-array reference — see the same pattern's comment in
// Sidebar.tsx (a fresh `[] ` every selector call looks like "the snapshot
// changed" to useSyncExternalStore and re-renders forever).
const EMPTY_POWER_SOCKETS: never[] = []

// Same store/logic PresetsSection used inside the Sidebar (moved here
// unchanged) — only the layout is horizontal now, to fit a bar under the
// deck instead of a vertical column in the sidebar. Category buttons open
// on click (toggle) OR on hover (purely additive — never changes the
// underlying activePresetCategory model, just an extra way to trigger it).
export function PresetsBar({ onPlaceCustomShape }: { onPlaceCustomShape: (name: string, weight?: number) => void }) {
  return (
    <>
      <PresetsPicker onPlaceCustomShape={onPlaceCustomShape} />
      <PowerSocketsBar />
    </>
  )
}

function PresetsPicker({ onPlaceCustomShape }: { onPlaceCustomShape: (name: string, weight?: number) => void }) {
  const [open, setOpen] = useState(false)
  const activePresetCategory = useCalculator((s) => s.activePresetCategory)
  const setActivePresetCategory = useCalculator((s) => s.setActivePresetCategory)
  const pendingPresetStamp = useCalculator((s) => s.pendingPresetStamp)
  const setPendingPresetStamp = useCalculator((s) => s.setPendingPresetStamp)
  const drawingCustomShape = useCalculator((s) => s.drawingCustomShape)
  const setDrawingCustomShape = useCalculator((s) => s.setDrawingCustomShape)
  const pendingCustomShape = useCalculator((s) => s.pendingCustomShape)
  const setPendingCustomShape = useCalculator((s) => s.setPendingCustomShape)
  const [drawName, setDrawName] = useState('')
  const [drawWeight, setDrawWeight] = useState('')
  // Reset the finalize form's fields once the pending shape is cleared
  // (placed, or cancelled via Escape) — same render-time "compare previous
  // prop" pattern used elsewhere in this app instead of a useEffect.
  const [prevPendingCustomShape, setPrevPendingCustomShape] = useState(pendingCustomShape)
  if (pendingCustomShape !== prevPendingCustomShape) {
    setPrevPendingCustomShape(pendingCustomShape)
    if (!pendingCustomShape) {
      setDrawName('')
      setDrawWeight('')
    }
  }

  return (
    <div className="border-t pt-2.5 mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-left mb-1.5 group"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-muted-foreground group-hover:text-foreground transition-colors">
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Пресеты
        </span>
      </button>
      {open && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground leading-tight">
            Выберите категорию, затем тип груза — он вооружится для клика по палубе.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(PRESETS).map(([key, cat]) => (
              <Button
                key={key}
                variant={activePresetCategory === key ? 'secondary' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                // Hover only OPENS a category when nothing is open yet (a
                // discovery convenience) — once one is open, only an
                // explicit click switches it. Letting hover always switch
                // meant the mouse merely passing over a neighbouring
                // category button on its way to an item further down (a
                // very normal cursor path once the row wraps) would silently
                // rip the open list out from under the user.
                onMouseEnter={() => {
                  if (!activePresetCategory) setActivePresetCategory(key)
                }}
                // Deliberately NOT a toggle (activePresetCategory === key ?
                // null : key) — a real mouse click always fires mouseenter
                // right before the click itself, so if this category wasn't
                // open yet, the hover handler above already opened it a
                // moment earlier; a toggle would then read that just-opened
                // state and immediately close it again on the very click
                // meant to open it. Always setting to `key` is immune to
                // whatever hover changed a beat before. To close a category,
                // pick a different one or collapse the whole bar's header.
                onClick={() => setActivePresetCategory(key)}
              >
                {cat.label}
              </Button>
            ))}
          </div>
          {activePresetCategory && (
            <div className="thin-scrollbar flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-0.5">
              {PRESETS[activePresetCategory]?.items.map((tpl, i) => {
                // One fixed color per template NAME (PRESET_TEMPLATE_COLORS),
                // not per row position — so the same type always shows the
                // same color regardless of which category list it's viewed
                // from, and the real item created on placement keeps this
                // exact color (see addOrIncrementCargoFromTemplate).
                const color = PRESET_TEMPLATE_COLORS[tpl.name ?? ''] ?? PALETTE[i % PALETTE.length]
                const active = pendingPresetStamp?.name === tpl.name
                return (
                  <PresetTemplateChip
                    key={i}
                    template={tpl}
                    color={color}
                    active={active}
                    onSelect={() => setPendingPresetStamp(active ? null : { ...tpl, color })}
                  />
                )
              })}
              {activePresetCategory === 'objects' && (
                <button
                  onClick={() => setDrawingCustomShape(!drawingCustomShape)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border p-2 text-left transition-all shrink-0',
                    drawingCustomShape
                      ? 'border-slate-400 bg-slate-100 ring-1 ring-slate-300 dark:bg-slate-800/40 dark:ring-slate-600'
                      : 'border-border hover:bg-accent'
                  )}
                >
                  <span className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md border border-dashed border-black/20 text-muted-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium truncate">Нарисовать</span>
                    <span className="block text-[10px] text-muted-foreground">свой контур по точкам</span>
                  </span>
                </button>
              )}
            </div>
          )}
          {pendingPresetStamp && (
            <p className="text-[10px] text-muted-foreground leading-tight">
              «{pendingPresetStamp.name}» готов — кликните по палубе, чтобы разместить.
            </p>
          )}
          {drawingCustomShape && (
            <p className="text-[10px] text-muted-foreground leading-tight">
              Кликайте по палубе, чтобы поставить точки контура (минимум 3), затем кликните рядом с первой точкой, чтобы замкнуть. Backspace — убрать последнюю точку, Esc — отменить.
            </p>
          )}
          {pendingCustomShape && (
            <div className="max-w-xs space-y-1.5 rounded-lg border p-2">
              <p className="text-[10px] text-muted-foreground leading-tight">
                Контур готов — задайте имя, затем разместите.
              </p>
              <Input
                value={drawName}
                onChange={(e) => setDrawName(e.target.value)}
                placeholder="Название груза"
                className="h-7 text-xs"
              />
              <Input
                value={drawWeight}
                onChange={(e) => setDrawWeight(e.target.value)}
                placeholder="Вес, кг (необязательно)"
                inputMode="decimal"
                className="h-7 text-xs"
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="h-7 text-xs flex-1"
                  disabled={!drawName.trim()}
                  onClick={() => {
                    const w = parseFloat(drawWeight)
                    onPlaceCustomShape(drawName.trim(), Number.isFinite(w) && w > 0 ? w : undefined)
                  }}
                >
                  Разместить
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setPendingCustomShape(null)}
                >
                  Отмена
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PresetTemplateChip({
  template,
  color,
  active,
  onSelect,
}: {
  template: { name?: string; width?: number; length?: number; shape?: CargoShape }
  color: string
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-lg border p-1.5 pr-2.5 text-left transition-all',
        active
          ? 'border-slate-400 bg-slate-100 ring-1 ring-slate-300 dark:bg-slate-800/40 dark:ring-slate-600'
          : 'border-border hover:bg-accent'
      )}
    >
      <span
        className={cn(
          'h-6 w-6 shrink-0 border border-black/10',
          template.shape === 'circle' || template.shape === 'oval' ? 'rounded-full' : 'rounded-md',
          template.shape === 'diamond' && 'rotate-45'
        )}
        style={{
          backgroundColor: color,
          clipPath: template.shape === 'triangle' ? 'polygon(50% 0%, 0% 100%, 100% 100%)' : undefined,
        }}
      />
      <div className="min-w-0">
        <div className="text-xs font-medium truncate">{template.name}</div>
        <div className="text-[10px] text-muted-foreground">
          {template.width}×{template.length}
        </div>
      </div>
      {active && <Badge variant="default" className="shrink-0 text-[10px]">активен</Badge>}
    </button>
  )
}

// Visual-only markers for deck electrical outlets — placed by clicking
// anywhere near the deck; DeckVisualization snaps the click onto the real
// perimeter (rectangle or custom outline), since a socket is a fixed
// installation on the ship's edge, never open deck.
function PowerSocketsBar() {
  const [open, setOpen] = useState(false)
  const sockets = useCalculator((s) => s.deck.powerSockets ?? EMPTY_POWER_SOCKETS)
  const removePowerSocket = useCalculator((s) => s.removePowerSocket)
  const placingPowerSocket = useCalculator((s) => s.placingPowerSocket)
  const setPlacingPowerSocket = useCalculator((s) => s.setPlacingPowerSocket)

  return (
    <div className="border-t pt-2.5 mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-left mb-1.5 group"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-muted-foreground group-hover:text-foreground transition-colors">
          <Plug className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Розетки
        </span>
        {sockets.length > 0 && (
          <span className="text-[10px] text-muted-foreground">({sockets.length})</span>
        )}
      </button>
      {open && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground leading-tight">
            Отметьте на контуре палубы, где есть электрические розетки — например, чтобы показать, где
            можно ставить рефрижераторные контейнеры. Только визуальная метка — груз можно ставить рядом.
          </p>
          {sockets.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sockets.map((s, i) => (
                <div key={s.id} className="flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs">
                  <Plug className="h-3 w-3 text-amber-600" />
                  <span>{i + 1}</span>
                  <button
                    onClick={() => removePowerSocket(s.id)}
                    className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-destructive shrink-0"
                    title="Удалить розетку"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant={placingPowerSocket ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() => setPlacingPowerSocket(!placingPowerSocket)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {placingPowerSocket ? 'Кликните у края палубы… (Готово)' : 'Добавить розетку'}
          </Button>
        </div>
      )}
    </div>
  )
}
