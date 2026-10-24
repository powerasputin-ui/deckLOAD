'use client'

import { useState, type ComponentProps } from 'react'
import { Input } from '@/components/ui/input'

// A text input that commits on Enter or on leaving it, like NumberField —
// never per keystroke — and reverts on Escape. Used where a typed value
// changes the calculation (a vessel's name, a table cell).
export function TextField({
  value,
  label,
  onCommit,
  className,
  onBlur,
  onKeyDown,
  ...inputProps
}: Omit<ComponentProps<typeof Input>, 'value' | 'defaultValue' | 'onChange'> & {
  value: string
  // Its accessible name, when no <label> points at its id.
  label?: string
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  return (
    <Input
      {...inputProps}
      aria-label={label ?? inputProps['aria-label']}
      className={className ?? 'h-7 min-w-28 px-1.5 text-xs'}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        commit()
        onBlur?.(e)
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape' && draft !== null) {
          e.preventDefault()
          e.stopPropagation()
          setDraft(null)
        }
      }}
    />
  )
}
