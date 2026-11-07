'use client'

import { useState } from 'react'
import { Anchor, ArrowLeftRight, BookOpen, ChevronDown, Copy, Eraser, Factory, List, Pencil, Save, Search, Ship, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useProjects } from '@/store/projects'
import { UNIT_LABEL, useCalculator } from '@/store/calculator'
import { OBJECT_KIND_HINT, OBJECT_KIND_LABEL, OBJECT_KIND_SHORT, OBJECT_KINDS, objectKindOf, type ObjectKind } from '@/lib/objectKind'
import { cn, fmtNumber } from '@/lib/utils'
import { MENU_CLOSES_AT_ONCE, MenuItem, MenuLabel, MenuSeparator } from './menu'

// What a new calculation is of, as the menu offers it (spec 2026-11-06, 14).
const NEW_OF: Record<ObjectKind, string> = { vessel: 'Судно', 'semi-sub': 'ППБУ', 'jack-up': 'СПБУ', fixed: 'Стационарная' }

// The calculation's name with everything done to calculations as a whole
// (spec 5.2): new, duplicate, rename, all calculations, file, example, clear,
// delete. Clearing and deleting ask first, with the wording they always had.
// A new calculation is of a kind — a vessel, a ППБУ, a СПБУ, a fixed
// platform — as on the start screen; the open one's kind is changed here
// too, rarely, never in its steps (spec 2026-11-06, 14).
export function ProjectMenu({
  onOpenFile,
  onSaveFile,
  onClear,
  onNewCalculation,
  onChangeKind,
}: {
  onOpenFile: () => void
  onSaveFile: () => void
  // Empties the current calculation (the store reset lives in the page).
  onClear: () => void
  // A new calculation of this kind, opened at its first step.
  onNewCalculation: (kind: ObjectKind) => void
  // The open calculation is now of this kind; its deck and cargo stay.
  onChangeKind: (kind: ObjectKind) => void
}) {
  const projects = useProjects((s) => s.projects)
  const activeId = useProjects((s) => s.activeId)
  const createProject = useProjects((s) => s.createProject)
  const duplicateProject = useProjects((s) => s.duplicateProject)
  const renameProject = useProjects((s) => s.renameProject)
  const deleteProject = useProjects((s) => s.deleteProject)
  const active = projects.find((p) => p.id === activeId)
  const name = active?.name ?? 'Расчёт'
  const kind = useCalculator((s) => objectKindOf(s.deck))

  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<null | 'rename' | 'kind' | 'all' | 'clear' | 'delete'>(null)
  const pick = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Меню расчёта «${name}»`}
            className="flex h-9 min-w-0 max-w-[260px] items-center gap-2 rounded-md px-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Anchor className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate text-sm font-semibold">{name}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-2" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className={cn('w-72 p-1', MENU_CLOSES_AT_ONCE)}>
          <MenuLabel>Новый расчёт</MenuLabel>
          <div role="group" aria-label="Новый расчёт" className="grid grid-cols-2 gap-0.5">
            {OBJECT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-label={`Новый расчёт: ${NEW_OF[k]}`}
                onClick={pick(() => onNewCalculation(k))}
                className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="shrink-0 text-ink-2 [&_svg]:h-4 [&_svg]:w-4">{k === 'vessel' ? <Ship /> : <Factory />}</span>
                <span className="truncate">{NEW_OF[k]}</span>
              </button>
            ))}
          </div>
          <MenuSeparator />
          <MenuItem
            icon={<Copy />}
            disabled={!active}
            onSelect={pick(() => {
              if (!active) return
              duplicateProject(active.id)
              toast.success('Дублировано')
            })}
          >
            Дублировать
          </MenuItem>
          <MenuItem icon={<Pencil />} disabled={!active} onSelect={pick(() => setDialog('rename'))}>
            Переименовать…
          </MenuItem>
          <MenuItem icon={<ArrowLeftRight />} disabled={!active} onSelect={pick(() => setDialog('kind'))} hint={OBJECT_KIND_SHORT[kind]}>
            Тип расчёта…
          </MenuItem>
          <MenuItem icon={<List />} onSelect={pick(() => setDialog('all'))} hint={String(projects.length)}>
            Все расчёты…
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Upload />} onSelect={pick(onOpenFile)}>
            Открыть файл…
          </MenuItem>
          <MenuItem icon={<Save />} onSelect={pick(onSaveFile)}>
            Сохранить файл…
          </MenuItem>
          <MenuItem
            icon={<BookOpen />}
            onSelect={pick(() => {
              createProject('Демо-расчёт', { demo: true })
              toast.success('Пример открыт новым расчётом')
            })}
          >
            Открыть пример
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Eraser />} onSelect={pick(() => setDialog('clear'))}>
            Очистить расчёт…
          </MenuItem>
          <MenuItem icon={<Trash2 />} destructive disabled={!active} onSelect={pick(() => setDialog('delete'))}>
            Удалить расчёт…
          </MenuItem>
        </PopoverContent>
      </Popover>

      {active && dialog === 'rename' && (
        <RenameDialog
          name={active.name}
          onCancel={() => setDialog(null)}
          onSave={(next) => {
            renameProject(active.id, next)
            setDialog(null)
          }}
        />
      )}
      {active && dialog === 'kind' && (
        <KindDialog
          kind={kind}
          onCancel={() => setDialog(null)}
          onChange={(next) => {
            setDialog(null)
            onChangeKind(next)
          }}
        />
      )}
      <AllProjectsDialog open={dialog === 'all'} onOpenChange={(v) => setDialog(v ? 'all' : null)} />

      <AlertDialog open={dialog === 'clear'} onOpenChange={(v) => !v && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Очистить текущий расчёт?</AlertDialogTitle>
            <AlertDialogDescription>
              Будут удалены все грузы и расстановка, а также фото палубы, контур, зоны нагрузки, точки крепления и данные
              судна. Размеры палубы вернутся к 8×20 м. Вернуть расчёт будет нельзя — история отмены тоже сбрасывается.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                setDialog(null)
                onClear()
              }}
            >
              Очистить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {active && (
        <DeleteProjectDialog
          open={dialog === 'delete'}
          name={active.name}
          onOpenChange={(v) => !v && setDialog(null)}
          onConfirm={() => {
            deleteProject(active.id)
            setDialog(null)
            toast.info('Удалено')
          }}
        />
      )}
    </>
  )
}

// «Тип расчёта» (spec 2026-11-06, 14): what the open calculation is of. Its
// deck and cargo stay, and the other kind's data waits in it for a change
// back.
function KindDialog({ kind, onCancel, onChange }: { kind: ObjectKind; onCancel: () => void; onChange: (kind: ObjectKind) => void }) {
  const [value, setValue] = useState(kind)
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Тип расчёта</DialogTitle>
          <DialogDescription>
            Обычно тип задают, создавая расчёт. Сменить его можно и сейчас: палуба и груз останутся, а данные прежнего типа хранятся в
            расчёте и вернутся, если сменить тип обратно.
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Тип расчёта" className="space-y-1.5">
          {OBJECT_KINDS.map((k) => (
            <label
              key={k}
              className={cn('flex cursor-pointer items-start gap-2.5 rounded-md border p-2', value === k ? 'border-line-strong bg-accent' : 'border-line')}
            >
              <input type="radio" name="calculation-kind" value={k} checked={value === k} onChange={() => setValue(k)} className="mt-1 h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{OBJECT_KIND_LABEL[k]}</span>
                <span className="block text-xs text-ink-2">{OBJECT_KIND_HINT[k]}</span>
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button onClick={() => onChange(value)} disabled={value === kind}>
            Сменить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RenameDialog({ name, onCancel, onSave }: { name: string; onCancel: () => void; onSave: (name: string) => void }) {
  const [value, setValue] = useState(name)
  const save = () => {
    if (value.trim()) onSave(value.trim())
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Переименовать расчёт</DialogTitle>
          <DialogDescription className="sr-only">Новое название расчёта</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          aria-label="Название расчёта"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button onClick={save} disabled={!value.trim()}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteProjectDialog({
  open,
  name,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  name: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить «{name}»?</AlertDialogTitle>
          <AlertDialogDescription>Расчёт будет удалён безвозвратно.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={onConfirm}>
            Удалить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// Every calculation in this browser: search, open, rename, duplicate, delete.
function AllProjectsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const projects = useProjects((s) => s.projects)
  const activeId = useProjects((s) => s.activeId)
  const switchTo = useProjects((s) => s.switchTo)
  const duplicateProject = useProjects((s) => s.duplicateProject)
  const renameProject = useProjects((s) => s.renameProject)
  const deleteProject = useProjects((s) => s.deleteProject)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const deleting = projects.find((p) => p.id === deletingId)

  const q = query.trim().toLowerCase()
  const shown = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects
  const commitEdit = () => {
    if (editingId && editName.trim()) renameProject(editingId, editName.trim())
    setEditingId(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Все расчёты</DialogTitle>
          <DialogDescription>Расчёты хранятся в этом браузере.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" aria-hidden="true" />
          <Input
            aria-label="Найти расчёт"
            placeholder="Найти расчёт"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
          {shown.length === 0 && <li className="px-2 py-3 text-sm text-ink-2">Ничего не найдено</li>}
          {shown.map((p) => {
            const isActive = p.id === activeId
            return (
              <li
                key={p.id}
                className={cn('flex items-center gap-1 rounded-md border px-2 py-1.5', isActive ? 'border-line-strong bg-accent' : 'border-transparent hover:bg-accent')}
              >
                {editingId === p.id ? (
                  <Input
                    autoFocus
                    aria-label="Название расчёта"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit()
                      if (e.key === 'Escape') {
                        e.stopPropagation()
                        setEditingId(null)
                      }
                    }}
                    onBlur={commitEdit}
                    className="h-8 flex-1"
                  />
                ) : (
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      switchTo(p.id)
                      onOpenChange(false)
                    }}
                  >
                    <span className="flex items-baseline gap-1.5">
                      <span className="truncate text-sm font-medium">{p.name}</span>
                      {isActive && <span className="shrink-0 text-xs text-ink-2">открыт</span>}
                    </span>
                    <span className="block text-xs text-ink-2">
                      {p.items.length} гр. · {fmtNumber(p.deck.width)}×{fmtNumber(p.deck.length)} {UNIT_LABEL[p.deck.unit]}
                    </span>
                  </button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={`Переименовать «${p.name}»`}
                  title="Переименовать"
                  onClick={() => {
                    setEditingId(p.id)
                    setEditName(p.name)
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={`Дублировать «${p.name}»`}
                  title="Дублировать"
                  onClick={() => {
                    duplicateProject(p.id)
                    toast.success('Дублировано')
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-danger hover:text-danger"
                  aria-label={`Удалить «${p.name}»`}
                  title="Удалить"
                  onClick={() => setDeletingId(p.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            )
          })}
        </ul>
        {deleting && (
          <DeleteProjectDialog
            open
            name={deleting.name}
            onOpenChange={(v) => !v && setDeletingId(null)}
            onConfirm={() => {
              deleteProject(deleting.id)
              setDeletingId(null)
              toast.info('Удалено')
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
