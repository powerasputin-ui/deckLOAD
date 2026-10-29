'use client'

import { useId, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NumberField } from '@/components/calculator/NumberField'
import { useCalculator } from '@/store/calculator'
import { DEFAULT_CATEGORIES } from '@/lib/cargoTable'
import { DEFAULT_VESSEL_MOTION, VESSEL_MOTION_PRESETS, type VesselMotionPreset } from '@/lib/packing'
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
  'open-sea': 'Открытое море',
  coastal: 'Прибрежное плавание',
  sheltered: 'Защищённые воды',
  custom: 'Свои ускорения',
}

// «Крепление»: the voyage the securing is judged for — the accelerations
// across and along the ship, in g, and the friction under the cargo. The
// lashing check used to assume coastal waters without saying so; coastal
// stays the default, and the check says it.
export function VesselMotionPicker() {
  const motion = useCalculator((s) => s.deck.vesselMotion)
  const setVesselMotion = useCalculator((s) => s.setVesselMotion)
  const uid = useId()
  const current = motion ?? DEFAULT_VESSEL_MOTION

  return (
    <div className="space-y-1.5">
      <label htmlFor={`${uid}-motion`} className="text-xs text-ink-2">
        Условия плавания
      </label>
      <Select
        value={current.preset}
        onValueChange={(v) => {
          const preset = v as VesselMotionPreset
          setVesselMotion(preset === 'custom' ? { preset } : { ...VESSEL_MOTION_PRESETS[preset], preset })
        }}
      >
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
      <p id={`${uid}-motion-hint`} className="text-xs text-ink-2">
        {!motion && 'По умолчанию — прибрежное плавание. '}
        Ускорения: поперёк {fmtNumber(current.ay)} g, вдоль {fmtNumber(current.ax)} g; трение {fmtNumber(current.friction)}
      </p>
      {current.preset === 'custom' && (
        <div className="grid grid-cols-3 gap-1.5">
          <MotionField label="Поперёк, g" value={current.ay} onCommit={(v) => setVesselMotion({ ay: v })} />
          <MotionField label="Вдоль, g" value={current.ax} onCommit={(v) => setVesselMotion({ ax: v })} />
          <MotionField label="Трение" value={current.friction} onCommit={(v) => setVesselMotion({ friction: v })} />
        </div>
      )}
    </div>
  )
}

function MotionField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const id = useId()
  return (
    <div className="space-y-0.5">
      <label htmlFor={id} className="text-xs text-ink-2">
        {label}
      </label>
      <NumberField id={id} min={0} max={2} step={0.05} value={value} onCommit={onCommit} className="h-7 text-xs" />
    </div>
  )
}
