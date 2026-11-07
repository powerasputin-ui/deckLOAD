'use client'

import { useId, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NumberField } from '@/components/calculator/NumberField'
import { useCalculator } from '@/store/calculator'
import { DEFAULT_CATEGORIES } from '@/lib/cargoTable'
import { DEFAULT_VESSEL_MOTION, type VesselMotion, type VesselMotionPreset } from '@/lib/packing'
import { CSS_RANGE, cssAccelerations } from '@/lib/securing'
import { accelerationsLine } from '@/lib/securingWords'
import { fmtNumber } from '@/lib/utils'

// The settings that live in their checks (spec 8.7, «Расчёт: проверки»):
// the separation rules and the conditions the lashing is judged for.

// «Сепарация»: two categories and the least distance between them, in
// metres. A rule is changed in place — it used to take removing it and
// adding it again.
export function SeparationRulesEditor() {
  const rules = useCalculator((s) => s.separationRules)
  const items = useCalculator((s) => s.items)
  const addSeparationRule = useCalculator((s) => s.addSeparationRule)
  const updateSeparationRule = useCalculator((s) => s.updateSeparationRule)
  const removeSeparationRule = useCalculator((s) => s.removeSeparationRule)
  const [categoryA, setCategoryA] = useState('')
  const [categoryB, setCategoryB] = useState('')
  const [minDistance, setMinDistance] = useState(3)

  // Every category in use, the cargo's and the rules' own among them.
  const options = Array.from(
    new Set([
      ...DEFAULT_CATEGORIES,
      ...items.map((it) => it.category).filter((c): c is string => !!c),
      ...rules.flatMap((r) => [r.categoryA, r.categoryB]),
    ])
  )

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-2">
        Наименьшее расстояние между грузами двух категорий. Ближе груз не поставить, авторасстановка его выдерживает.
      </p>
      {rules.length > 0 && (
        <ul className="space-y-1.5" aria-label="Правила сепарации">
          {rules.map((r, i) => (
            <li key={r.id} className="space-y-1.5 rounded-md border border-line p-2">
              <div className="grid grid-cols-2 gap-1.5">
                <CategorySelect label={`Правило ${i + 1}: категория A`} options={options} value={r.categoryA} onChange={(v) => updateSeparationRule(r.id, { categoryA: v })} />
                <CategorySelect label={`Правило ${i + 1}: категория B`} options={options} value={r.categoryB} onChange={(v) => updateSeparationRule(r.id, { categoryB: v })} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-ink-2">не ближе</span>
                <NumberField
                  aria-label={`Правило ${i + 1}: расстояние, м`}
                  min={0}
                  step={0.5}
                  value={r.minDistance}
                  onCommit={(v) => updateSeparationRule(r.id, { minDistance: v })}
                  className="h-7 w-20 text-xs"
                />
                <span className="text-xs text-ink-2">м</span>
                <button
                  type="button"
                  onClick={() => removeSeparationRule(r.id)}
                  aria-label={`Удалить правило ${i + 1}`}
                  title="Удалить правило"
                  className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded text-ink-2 hover:bg-accent hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div role="group" aria-label="Новое правило" className="space-y-1.5 rounded-md border border-dashed border-line p-2">
        <div className="grid grid-cols-2 gap-1.5">
          <CategorySelect label="Категория A" placeholder="Категория A" options={options} value={categoryA} onChange={setCategoryA} />
          <CategorySelect label="Категория B" placeholder="Категория B" options={options} value={categoryB} onChange={setCategoryB} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-ink-2">не ближе</span>
          <NumberField
            aria-label="Минимальное расстояние, м"
            min={0}
            step={0.5}
            value={minDistance}
            onCommit={setMinDistance}
            className="h-7 w-20 text-xs"
          />
          <span className="text-xs text-ink-2">м</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-full text-xs"
          disabled={!categoryA || !categoryB}
          onClick={() => {
            addSeparationRule({ categoryA, categoryB, minDistance })
            setCategoryA('')
            setCategoryB('')
            toast.success('Правило добавлено')
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Добавить правило
        </Button>
      </div>
    </div>
  )
}

function CategorySelect({
  label,
  placeholder,
  options,
  value,
  onChange,
}: {
  label: string
  placeholder?: string
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-7 w-full min-w-0 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((c) => (
          <SelectItem key={c} value={c}>
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const MOTION_LABEL: Record<VesselMotionPreset, string> = {
  css: 'По CSS Code, приложение 13',
  custom: 'Свои (из Наставления по креплению)',
}

// «Крепление»: the accelerations a stack's securing is judged for, and the
// friction under the cargo (securing.ts). By the CSS Code's annex 13 they
// come from the vessel's length, breadth, speed and GM — the length and
// breadth from the vessel's data, the GM from the trip's stability, each
// asked here when there is none. Decided 2026-11-07: three presets stood
// here — open sea, coastal, sheltered — whose figures were no rule's and
// ran at half the annex's or less.
export function VesselMotionPicker() {
  const motion = useCalculator((s) => s.deck.vesselMotion)
  const particulars = useCalculator((s) => s.deck.vessel?.particulars)
  const setVesselMotion = useCalculator((s) => s.setVesselMotion)
  const uid = useId()
  const current: VesselMotion = motion ?? DEFAULT_VESSEL_MOTION
  const vesselLength = particulars && particulars.lengthBpp > 0 ? particulars.lengthBpp : undefined
  const vesselBreadth = particulars && particulars.breadth > 0 ? particulars.breadth : undefined
  const css = cssAccelerations(
    { lengthM: vesselLength ?? current.lengthM, breadthM: vesselBreadth ?? current.breadthM, speedKn: current.speedKn, gmM: current.gmM },
    undefined
  )

  return (
    <div className="space-y-1.5">
      <label htmlFor={`${uid}-motion`} className="text-xs text-ink-2">
        Ускорения для крепления
      </label>
      <Select value={current.preset} onValueChange={(v) => setVesselMotion({ preset: v as VesselMotionPreset })}>
        <SelectTrigger id={`${uid}-motion`} aria-describedby={`${uid}-motion-hint`} className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(MOTION_LABEL) as VesselMotionPreset[]).map((p) => (
            <SelectItem key={p} value={p}>
              {MOTION_LABEL[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {current.preset === 'css' ? (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <MotionField label="Скорость, уз" value={current.speedKn} max={40} step={0.5} onCommit={(v) => setVesselMotion({ speedKn: v })} onClear={() => setVesselMotion({ speedKn: undefined })} />
            <MotionField label="GM, м" value={current.gmM} max={20} step={0.05} onCommit={(v) => setVesselMotion({ gmM: v })} onClear={() => setVesselMotion({ gmM: undefined })} />
            {vesselLength === undefined && (
              <MotionField label="Длина L, м" value={current.lengthM} max={400} step={1} onCommit={(v) => setVesselMotion({ lengthM: v })} onClear={() => setVesselMotion({ lengthM: undefined })} />
            )}
            {vesselBreadth === undefined && (
              <MotionField label="Ширина B, м" value={current.breadthM} max={80} step={0.1} onCommit={(v) => setVesselMotion({ breadthM: v })} onClear={() => setVesselMotion({ breadthM: undefined })} />
            )}
          </div>
          <p id={`${uid}-motion-hint`} className="text-xs text-ink-2">
            {[
              vesselLength !== undefined && `L ${fmtNumber(vesselLength)} м`,
              vesselBreadth !== undefined && `B ${fmtNumber(vesselBreadth)} м`,
            ]
              .filter(Boolean)
              .join(', ')}
            {(vesselLength !== undefined || vesselBreadth !== undefined) && ' — из данных судна. '}
            GM берётся из остойчивости рейса, если она посчитана; без неё — из поля. Таблицы годятся для L {CSS_RANGE.lengthM[0]}–
            {CSS_RANGE.lengthM[1]} м, {CSS_RANGE.speedKn[0]}–{CSS_RANGE.speedKn[1]} уз, B/GM от {CSS_RANGE.minBOverGM}; груз на палубе
            считается «высоко», с запасом. Плюс ветер и заливание по 1 кН/м².
            {css.status === 'ok' && ` При этих данных у носа: ${accelerationsLine(css.accelerations)}.`}
            {css.status === 'outside' && ` Вне таблиц: ${css.reason} — выберите свои ускорения.`}
          </p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            <MotionField label="Поперёк, g" value={current.ay} onCommit={(v) => setVesselMotion({ ay: v })} />
            <MotionField label="Вдоль, g" value={current.ax} onCommit={(v) => setVesselMotion({ ax: v })} />
            <MotionField label="Вертик., g" value={current.az} onCommit={(v) => setVesselMotion({ az: v })} />
          </div>
          <p id={`${uid}-motion-hint`} className="text-xs text-ink-2">
            Из Наставления по креплению груза судна или расчёта буксировки; вертикальное — без веса (1 g). Плюс ветер и заливание по 1 кН/м².
          </p>
        </>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        <MotionField label="Трение μ" value={current.friction} max={1} onCommit={(v) => setVesselMotion({ friction: v })} />
      </div>
      <p className="text-xs text-ink-2">Трение: сталь по дереву или резине 0,3; сталь по стали сухо 0,1, мокро 0.</p>
    </div>
  )
}

function MotionField({
  label,
  value,
  onCommit,
  onClear,
  max = 2,
  step = 0.05,
}: {
  label: string
  value: number | undefined
  onCommit: (v: number) => void
  onClear?: () => void
  max?: number
  step?: number
}) {
  const id = useId()
  return (
    <div className="space-y-0.5">
      <label htmlFor={id} className="text-xs text-ink-2">
        {label}
      </label>
      <NumberField id={id} min={0} max={max} step={step} value={value} onCommit={onCommit} onClear={onClear} className="h-7 text-xs" />
    </div>
  )
}
