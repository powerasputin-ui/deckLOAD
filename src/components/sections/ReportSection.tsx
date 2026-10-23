'use client'

import { Download, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelBlock } from '@/components/shell/SectionPanel'

// «Отчёт» (spec 13, stage 2): the PDF. Stage 5 adds the preview and the page
// list (8.8). The orange «Скачать PDF» stays the one in the top bar; here the
// button is an ordinary one.
export function ReportSection({ hasCargo, onExportPdf, onSaveFile }: { hasCargo: boolean; onExportPdf: () => void; onSaveFile: () => void }) {
  return (
    <>
      <PanelBlock title="План погрузки в PDF">
        <p className="text-sm text-ink-2">
          Схема палубы, учёт по грузам, крепление и остойчивость — для передачи на судно. Если рейсов несколько, в документ
          попадает открытый рейс.
        </p>
        {!hasCargo && <p className="text-sm text-ink-2">Сначала добавьте груз.</p>}
        <Button variant="outline" className="w-full" onClick={onExportPdf} disabled={!hasCargo}>
          <Download className="mr-1.5 h-4 w-4" />
          Скачать PDF
        </Button>
      </PanelBlock>
      <PanelBlock title="Файл расчёта">
        <p className="text-sm text-ink-2">Чтобы открыть расчёт позже или на другом компьютере.</p>
        <Button variant="outline" className="w-full" onClick={onSaveFile}>
          <Save className="mr-1.5 h-4 w-4" />
          Сохранить файл…
        </Button>
      </PanelBlock>
    </>
  )
}
