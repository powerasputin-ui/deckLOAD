'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { downloadSavedData } from '@/store/projects'

// What shows instead of a blank page when the page fails to render
// (src/app/error.tsx; global-error.tsx when the root layout itself fails):
// a copy of the calculations saved in the browser to take first — if what
// is saved is what the page trips over, every reload trips over it again —
// and a way to try again. The copy is the whole record as stored, not a
// project file «Импорт» reads: it keeps the data, it doesn't restore it.
export function ErrorScreen({ error, retry }: { error: unknown; retry: () => void }) {
  const [nothingSaved, setNothingSaved] = useState(false)
  const detail =
    error instanceof Error
      ? [error.message, (error as Error & { digest?: string }).digest].filter(Boolean).join(' · ')
      : String(error)
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Не удалось показать расчёт</h1>
      <p className="text-sm text-ink-2">
        В программе произошла ошибка. Сначала скачайте копию расчётов, сохранённых в браузере, чтобы они не потерялись,
        затем попробуйте снова.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setNothingSaved(!downloadSavedData('deckload-backup'))}>
          Скачать копию расчётов
        </Button>
        <Button onClick={() => retry()}>Попробовать снова</Button>
      </div>
      {nothingSaved && (
        <p role="status" className="text-sm text-ink-2">
          В браузере нет сохранённых расчётов.
        </p>
      )}
      {detail && (
        <details className="text-xs text-ink-2">
          <summary>Подробности</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono">{detail}</pre>
        </details>
      )}
    </main>
  )
}
