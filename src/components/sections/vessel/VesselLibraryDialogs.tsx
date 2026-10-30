'use client'

import { useId, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

// Saving the open calculation's deck as a vessel of the library, updating a
// vessel from it, or renaming one (spec 8.1, revision 2026-10-30): its name,
// and — saving — where its data comes from, with what the data covers.
export function SaveVesselDialog({
  title,
  label,
  note,
  dataLine,
  heightMissing,
  submit,
  onCancel,
  onSave,
}: {
  title: string
  label: string
  // Unset when only the name is edited.
  note?: string
  // What the vessel's data covers (vesselDataLine).
  dataLine?: string
  // Stability data without the deck's height above the keel.
  heightMissing?: boolean
  submit: string
  onCancel: () => void
  onSave: (entry: { label: string; note: string }) => void
}) {
  const uid = useId()
  const [name, setName] = useState(label)
  const [source, setSource] = useState(note ?? '')
  const save = () => {
    if (name.trim()) onSave({ label: name.trim(), note: source.trim() })
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={dataLine ? 'text-xs' : 'sr-only'}>{dataLine ?? 'Название судна'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor={`${uid}-name`} className="text-xs text-ink-2">
              Название судна
            </label>
            <Input
              id={`${uid}-name`}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
              }}
            />
          </div>
          {note !== undefined && (
            <div className="space-y-1">
              <label htmlFor={`${uid}-note`} className="text-xs text-ink-2">
                Откуда данные
              </label>
              <Textarea
                id={`${uid}-note`}
                rows={3}
                value={source}
                placeholder="Например: Информация об остойчивости, ред. 3; GA-чертёж"
                onChange={(e) => setSource(e.target.value)}
              />
            </div>
          )}
          {heightMissing && (
            <p className="flex gap-2 text-xs text-warn">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Высота палубы над килем не задана — с этим судном остойчивость с грузом считаться не будет, пока её не задать.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button onClick={save} disabled={!name.trim()}>
            {submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Deleting a vessel of the library: the calculations made with it keep
// their copy, and the toast that follows brings it back.
export function DeleteVesselDialog({ label, onCancel, onConfirm }: { label: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <AlertDialog open onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить «{label}» из библиотеки?</AlertDialogTitle>
          <AlertDialogDescription>Расчёты, сделанные с этим судном, не изменятся: у каждого своя копия его данных.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Удалить</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
