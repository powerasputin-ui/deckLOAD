'use client'

import { useState } from 'react'
import { Check, ClipboardPaste, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/calculator/NumberField'
import { parsePastedTable, type PasteColumn } from '@/lib/tablePaste'

export interface ValueColumn {
  key: string
  label: string
  unit?: string
  kind?: 'number' | 'text'
  // An empty number cell is allowed (and means «not given»).
  optional?: boolean
  min?: number
  max?: number
}

export type CellValue = string | number | undefined

// A table the stability workspace edits cell by cell (spec 2026-10-24,
// 6.1): the limit, the tanks, the hydrostatics, the KN curves. Each cell
// commits on Enter or leaving it, like every number field. A new row is
// filled in first and added whole — a half-typed row of zeros would be
// read as data. The whole table can also be pasted as text from the
// booklet or a spreadsheet.
export function ValueTable({
  label,
  columns,
  rows,
  rowKeys,
  onChange,
  onAdd,
  onRemove,
  onPaste,
  onPasteText,
  pasteHint,
  addLabel,
  addDisabled,
  emptyText,
}: {
  label: string
  columns: ValueColumn[]
  rows: CellValue[][]
  // Stable keys for the rows (the tanks' ids); their index otherwise.
  rowKeys?: string[]
  onChange: (row: number, column: number, value: CellValue) => void
  onAdd: (row: CellValue[]) => void
  onRemove: (row: number) => void
  // Replaces every row with the pasted ones, read by `columns`…
  onPaste?: (rows: CellValue[][]) => void
  // …or reads the text itself (the KN curves bring their angles), returning
  // what's wrong with it or null once applied.
  onPasteText?: (text: string) => string | null
  pasteHint?: string
  addLabel: string
  // Why a row can't be added yet (the KN curves without angles).
  addDisabled?: string
  emptyText?: string
}) {
  const [draft, setDraft] = useState<CellValue[] | null>(null)
  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const pasteColumns: PasteColumn[] = columns.map((c) => (c.kind === 'text' ? { kind: 'text' } : { kind: 'number', optional: c.optional }))
  const missing = draft ? columns.filter((c, i) => c.kind !== 'text' && !c.optional && draft[i] === undefined).map((c) => c.label) : []

  const applyPaste = () => {
    let problem: string | null
    if (onPasteText) problem = onPasteText(text)
    else {
      const parsed = parsePastedTable(text, pasteColumns)
      problem = 'error' in parsed ? parsed.error : null
      if (!('error' in parsed)) onPaste?.(parsed.rows)
    }
    if (problem) {
      setError(problem)
      return
    }
    setText('')
    setError(null)
    setPasting(false)
  }

  // A cell of a row, or of the new row: any of its cells can be emptied
  // again, and the first takes the focus when it opens.
  const cell = (c: ValueColumn, name: string, value: CellValue, commit: (v: CellValue) => void, draftCell?: { first: boolean }) =>
    c.kind === 'text' ? (
      <TextCell value={typeof value === 'string' ? value : ''} label={name} onCommit={commit} autoFocus={draftCell?.first} />
    ) : (
      <NumberField
        aria-label={name}
        autoFocus={draftCell?.first}
        className="h-7 min-w-12 px-1.5 text-xs tabular-nums"
        value={typeof value === 'number' ? value : undefined}
        min={c.min}
        max={c.max}
        onCommit={commit}
        onClear={c.optional || draftCell ? () => commit(undefined) : undefined}
      />
    )

  const rowButton = 'inline-flex h-7 w-7 items-center justify-center rounded text-ink-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40'

  return (
    <div className="space-y-2">
      {rows.length === 0 && !draft ? (
        emptyText && <p className="text-xs text-ink-2">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs" aria-label={label}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className="px-1 pb-1 text-left font-medium text-ink-2">
                    {c.label}
                    {c.unit && <span className="font-normal">, {c.unit}</span>}
                  </th>
                ))}
                <th className="w-7" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={rowKeys?.[r] ?? r}>
                  {columns.map((c, ci) => (
                    <td key={c.key} className="px-0.5 py-0.5">
                      {cell(c, `${c.label}, строка ${r + 1}`, row[ci], (v) => onChange(r, ci, v))}
                    </td>
                  ))}
                  <td className="px-0.5 py-0.5">
                    <button type="button" onClick={() => onRemove(r)} aria-label={`Удалить строку ${r + 1}`} className={`${rowButton} hover:text-danger`}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
              {draft && (
                <tr className="bg-accent/50">
                  {columns.map((c, ci) => (
                    <td key={c.key} className="px-0.5 py-0.5">
                      {cell(
                        c,
                        `${c.label}, новая строка`,
                        draft[ci],
                        (v) => setDraft((d) => d && d.map((x, i) => (i === ci ? v : x))),
                        { first: ci === 0 }
                      )}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-0.5 py-0.5">
                    <button
                      type="button"
                      disabled={missing.length > 0}
                      onClick={() => {
                        onAdd(draft)
                        setDraft(null)
                      }}
                      aria-label="Сохранить новую строку"
                      title={missing.length > 0 ? `Заполните: ${missing.join(', ')}` : undefined}
                      className={`${rowButton} hover:text-ok`}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setDraft(null)} aria-label="Отменить новую строку" className={rowButton}>
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {draft && missing.length > 0 && <p className="text-xs text-ink-2">Строка добавится, когда будут заполнены: {missing.join(', ')}.</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={!!draft || !!addDisabled}
          title={addDisabled}
          onClick={() => setDraft(columns.map(() => undefined))}
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {addLabel}
        </Button>
        {(onPaste || onPasteText) && (
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" aria-expanded={pasting} onClick={() => setPasting((p) => !p)}>
            <ClipboardPaste className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Вставить текстом
          </Button>
        )}
      </div>
      {pasting && (
        <div className="space-y-1.5">
          <p className="text-xs text-ink-2">
            {pasteHint ?? `Строка на строку таблицы, столбцы — ${columns.map((c) => c.label).join(', ')}.`} Через табуляцию, точку с
            запятой или пробел; десятичная запятая или точка. Заменяет все строки.
          </p>
          <textarea
            aria-label={`${label}: текст для вставки`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-line bg-surface p-1.5 font-mono text-xs"
          />
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <Button type="button" size="sm" className="h-7 text-xs" onClick={applyPaste}>
            Вставить
          </Button>
        </div>
      )}
    </div>
  )
}

// A text cell committing on Enter or leaving it, like the number cells.
export function TextCell({
  id,
  value,
  label,
  onCommit,
  autoFocus,
  className,
  placeholder,
}: {
  id?: string
  value: string
  // Its accessible name, when no <label> points at `id`.
  label?: string
  onCommit: (v: string) => void
  autoFocus?: boolean
  className?: string
  placeholder?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  return (
    <Input
      id={id}
      aria-label={label}
      autoFocus={autoFocus}
      placeholder={placeholder}
      className={className ?? 'h-7 min-w-28 px-1.5 text-xs'}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
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
