'use client'

import { useRef, useState, type ComponentProps } from 'react'
import { Input } from '@/components/ui/input'
import {
  cleanNumberInput,
  formatNumberInput,
  isAllowedNumberInput,
  parseNumberInput,
  stepNumberInput,
  type NumberInputBounds,
} from '@/lib/numberInput'

export interface NumberFieldProps
  extends Omit<ComponentProps<typeof Input>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max' | 'step'>,
    NumberInputBounds {
  value: number | undefined
  /**
   * Fires once per FINISHED edit (Enter, blur or an arrow step) with a finite
   * number already rounded and clamped to [min, max] — never for half-typed
   * text, and never when the result equals the current value.
   */
  onCommit: (value: number) => void
  /** Makes the field optional: committing it empty calls this instead of reverting to the old value. */
  onClear?: () => void
  /** ArrowUp/ArrowDown increment. Defaults to 1 for integer fields, 0.1 otherwise. */
  step?: number
  /** Fires when a committed value had to be pulled back to `min` or `max`. */
  onClamp?: (info: { bound: 'min' | 'max'; limit: number; typed: number }) => void
  /** A click selects the whole number, so what's typed replaces it — a spreadsheet's cell, two actions to change it (spec 2.3). */
  selectOnFocus?: boolean
}

// A text input with a draft buffer instead of a controlled `type="number"`.
// While the user is typing, nothing reaches the store — setDeck()/updateItem()
// reflow, resize and clamp placements already on the deck, so a transient "2"
// on the way to "24" (or a "0.1" snapped in for an emptied field) would damage
// the layout for good. The value is applied on Enter / blur / arrow step, and
// both "," and "." work as the decimal separator (see src/lib/numberInput.ts).
export function NumberField({
  value,
  onCommit,
  onClear,
  onClamp,
  min,
  max,
  integer,
  step,
  selectOnFocus,
  onBlur,
  onFocus,
  onMouseUp,
  onKeyDown,
  ...inputProps
}: NumberFieldProps) {
  // null = not editing: show the live value, so undo/redo or a reflow that
  // changes it from outside is always reflected without any sync effect.
  const [draft, setDraft] = useState<string | null>(null)
  const bounds: NumberInputBounds = { min, max, integer }
  // The click that focused the field would put the caret in place of the
  // selection on its way up; with selectOnFocus that one mouseup is skipped.
  const justFocused = useRef(false)

  const commit = () => {
    if (draft === null) return
    setDraft(null)
    const parsed = parseNumberInput(draft, bounds)
    if (parsed.kind === 'empty') {
      if (value !== undefined) onClear?.()
      return
    }
    if (parsed.kind === 'invalid') return
    if (parsed.clamped) {
      const limit = parsed.clamped === 'min' ? min : max
      if (limit !== undefined) onClamp?.({ bound: parsed.clamped, limit, typed: parsed.typed })
    }
    if (formatNumberInput(parsed.value) !== formatNumberInput(value)) onCommit(parsed.value)
  }

  return (
    <Input
      {...inputProps}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      autoComplete="off"
      spellCheck={false}
      value={draft ?? formatNumberInput(value)}
      onChange={(e) => {
        const next = cleanNumberInput(e.target.value)
        if (isAllowedNumberInput(next, bounds)) setDraft(next)
      }}
      onBlur={(e) => {
        commit()
        onBlur?.(e)
      }}
      onFocus={(e) => {
        if (selectOnFocus) {
          e.currentTarget.select()
          justFocused.current = true
        }
        onFocus?.(e)
      }}
      onMouseUp={(e) => {
        if (justFocused.current) e.preventDefault()
        justFocused.current = false
        onMouseUp?.(e)
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape' && draft !== null) {
          // Revert the edit — and keep Escape from also reaching the app's
          // own "clear selection" shortcut.
          e.preventDefault()
          e.stopPropagation()
          setDraft(null)
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const parsed = draft === null ? undefined : parseNumberInput(draft, bounds)
          const base = parsed?.kind === 'ok' ? parsed.value : (value ?? min ?? 0)
          const next = stepNumberInput(base, e.key === 'ArrowUp' ? 1 : -1, step ?? (integer ? 1 : 0.1), bounds)
          setDraft(null)
          if (formatNumberInput(next) !== formatNumberInput(value)) onCommit(next)
        }
      }}
    />
  )
}
