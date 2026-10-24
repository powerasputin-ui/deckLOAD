'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCalculator, UNIT_LABEL } from '@/store/calculator'
import { DEFAULT_CATEGORIES, SIZE_AXES } from '@/lib/cargoTable'
import { formatNumberInput, parseNumberInput } from '@/lib/numberInput'
import { toast } from 'sonner'

// «Свой груз» (spec 7.3): the short form — name, sides, unit weight,
// quantity, category. The rest is edited in the cargo table. The sides start
// as the table's new row does (length 1.2, width 2) and are in sight.
export function OwnCargoForm({ onDone }: { onDone: () => void }) {
  const items = useCalculator((s) => s.items)
  const unit = useCalculator((s) => s.deck.unit)
  const mode = useCalculator((s) => s.mode)
  const addItem = useCalculator((s) => s.addItem)
  const setActiveStamp = useCalculator((s) => s.setActiveStamp)
  const [draft, setDraft] = useState({ name: '', length: '1.2', width: '2', height: '', weight: '', quantity: '1', category: '' })
  const [tried, setTried] = useState(false)
  const id = useId()
  const u = UNIT_LABEL[unit]
  const categories = Array.from(new Set([...DEFAULT_CATEGORIES, ...items.map((it) => it.category).filter((c): c is string => !!c)]))
  const defaultName = `Груз ${items.length + 1}`

  const length = parseNumberInput(draft.length, { min: 0.01 })
  const width = parseNumberInput(draft.width, { min: 0.01 })
  const height = parseNumberInput(draft.height, { min: 0 })
  const weight = parseNumberInput(draft.weight, { min: 0 })
  const quantity = parseNumberInput(draft.quantity, { min: 1, integer: true })
  // What's wrong with each field, if anything; empty height and weight are
  // «not given».
  const errors = {
    length: length.kind !== 'ok' || length.typed <= 0 ? 'Нужна длина больше 0' : null,
    width: width.kind !== 'ok' || width.typed <= 0 ? 'Нужна ширина больше 0' : null,
    height: height.kind === 'invalid' ? 'Число, например 2.5' : null,
    weight: weight.kind === 'invalid' ? 'Число, например 1.2' : null,
    quantity: quantity.kind !== 'ok' || quantity.typed < 1 ? 'Не меньше 1' : null,
  }
  const valid = Object.values(errors).every((e) => e === null)
  const set = (key: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [key]: e.target.value }))

  const field = (key: 'length' | 'width' | 'height' | 'weight' | 'quantity', label: string, placeholder?: string) => {
    const error = tried ? errors[key] : null
    return (
      <div className="space-y-0.5">
        <label htmlFor={`${id}-${key}`} className="block text-xs text-ink-2">
          {label}
        </label>
        <Input
          id={`${id}-${key}`}
          inputMode={key === 'quantity' ? 'numeric' : 'decimal'}
          value={draft[key]}
          placeholder={placeholder}
          onChange={set(key)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-${key}-error` : undefined}
          className="h-8 px-2 text-right text-sm tabular-nums"
        />
        {error && (
          <p id={`${id}-${key}-error`} className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      aria-label="Свой груз"
      className="space-y-3 border-y border-line px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (!valid || length.kind !== 'ok' || width.kind !== 'ok' || quantity.kind !== 'ok') return
        const name = draft.name.trim() || defaultName
        addItem({
          name,
          length: length.value,
          width: width.value,
          height: height.kind === 'ok' ? height.value : 0,
          weight: weight.kind === 'ok' && weight.value > 0 ? weight.value * 1000 : undefined,
          quantity: quantity.value,
          category: draft.category.trim() || undefined,
        })
        // In manual mode the new cargo is armed for a click on the deck, as a
        // choice in the catalogue is.
        const all = useCalculator.getState().items
        const added = all[all.length - 1]
        if (mode === 'manual' && added) setActiveStamp(added.id)
        toast.success(`«${name}» добавлен: ${formatNumberInput(quantity.value)} ед.`)
        onDone()
      }}
    >
      <div className="space-y-0.5">
        <label htmlFor={`${id}-name`} className="block text-xs text-ink-2">
          Название
        </label>
        <Input id={`${id}-name`} autoFocus value={draft.name} placeholder={defaultName} onChange={set('name')} className="h-8 px-2 text-sm" />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-xs text-ink-2">
          <abbr title={SIZE_AXES} className="no-underline">
            Д×Ш×В, {u}
          </abbr>
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {field('length', 'Длина')}
          {field('width', 'Ширина')}
          {field('height', 'Высота', 'не задана')}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        {field('weight', 'Вес единицы, т', 'не задан')}
        {field('quantity', 'Количество')}
      </div>
      <div className="space-y-0.5">
        <label htmlFor={`${id}-category`} className="block text-xs text-ink-2">
          Категория
        </label>
        <Input id={`${id}-category`} list={`${id}-categories`} value={draft.category} placeholder="Обычный" onChange={set('category')} className="h-8 px-2 text-sm" />
        <datalist id={`${id}-categories`}>
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <p className="text-xs text-ink-2">Ярусы, поворот, содержимое и поправки центра тяжести — в таблице грузов.</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="outline" className="h-8 flex-1">
          Добавить груз
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onDone}>
          Отмена
        </Button>
      </div>
    </form>
  )
}
