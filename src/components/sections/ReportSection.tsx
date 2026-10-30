'use client'

import { useState } from 'react'
import { CircleX, Download, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { PagePreview } from '@/components/report/PagePreview'
import type { PlanPdfModel } from '@/lib/exportPdf'
import { fmtTonnes } from '@/lib/utils'
import { cn } from '@/lib/utils'

// «Отчёт» (spec 8.8): what the PDF will be — a trip's sheet as it will
// print, the sheets one per trip and the totals, what goes in, and a word
// when the calculation has errors (they print too; the PDF still
// downloads). The orange «Скачать PDF» stays the one in the top bar; here
// the button is an ordinary one. Without cargo there is nothing to print.
export function ReportSection({
  hasCargo,
  hasErrors,
  model,
  cargoHead,
  onExportPdf,
  onSaveFile,
}: {
  hasCargo: boolean
  hasErrors: boolean
  // The PDF's sheets, worked out while the section is open.
  model: PlanPdfModel | null
  cargoHead: string[]
  onExportPdf: () => void
  onSaveFile: () => void
}) {
  const [chosen, setChosen] = useState(0)
  const trips = model?.trips ?? []
  const shown = Math.min(chosen, Math.max(0, trips.length - 1))
  return (
    <>
      <PanelBlock title="План погрузки в PDF">
        {!hasCargo ? (
          <p className="text-sm text-ink-2">Сначала добавьте груз.</p>
        ) : (
          <>
            <p className="text-sm text-ink-2">
              По листу на рейс: схема палубы, груз, сводка с проверками и остойчивостью, крепление и подписи. Последний лист — итого по
              операции.
            </p>
            {hasErrors && (
              <p role="status" className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-bg px-3 py-2 text-sm text-danger">
                <CircleX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                В расчёте есть ошибки: они будут видны в PDF
              </p>
            )}
            {model && trips[shown] && <PagePreview vessel={model.vessel} name={model.name} sheet={trips[shown]} cargoHead={cargoHead} />}
            {model && (
              <ul className="space-y-0.5" aria-label="Листы PDF">
                {trips.map((t, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      aria-pressed={i === shown}
                      onClick={() => setChosen(i)}
                      className={cn(
                        'flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        i === shown && 'bg-accent font-medium'
                      )}
                    >
                      <span>{t.title}</span>
                      <span className="text-xs tabular-nums text-ink-2">
                        {t.units} ед. · {fmtTonnes(t.weightKg)} т
                      </span>
                    </button>
                  </li>
                ))}
                <li className="px-2 py-1.5 text-sm text-ink-2">Итого по операции</li>
              </ul>
            )}
          </>
        )}
        <Button variant="outline" className="w-full" onClick={onExportPdf} disabled={!hasCargo}>
          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Скачать PDF
        </Button>
      </PanelBlock>
      <PanelBlock title="Файл расчёта">
        <p className="text-sm text-ink-2">Чтобы открыть расчёт позже или на другом компьютере.</p>
        <Button variant="outline" className="w-full" onClick={onSaveFile}>
          <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Сохранить файл…
        </Button>
      </PanelBlock>
    </>
  )
}
