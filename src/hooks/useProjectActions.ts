'use client'

import { useRef } from 'react'
import { toast } from 'sonner'
import type { VesselTemplate } from '@/lib/vesselTemplates'
import { clearCalculatorHistory, DEMO_DECK, undoCalculator, useCalculator } from '@/store/calculator'
import { useProjects } from '@/store/projects'
import { deckForVessel, isDefaultCalculationName } from '@/lib/vesselDeck'

// What is done to the calculation as a whole from the page: its file, clearing
// it, and a new one for a library vessel. The rest of the calculation's menu
// works on the projects store itself (ProjectMenu). Moved out of page.tsx as
// it was (spec 12.3).
export function useProjectActions({
  prevOverloadedZoneCountRef,
}: {
  // The load-zone overload toast's baseline: clearing starts it over.
  prevOverloadedZoneCountRef: React.MutableRefObject<number>
}) {
  const saveSnapshot = useProjects((s) => s.saveSnapshot)
  const getActiveProject = useProjects((s) => s.getActive)
  const importProject = useProjects((s) => s.importProject)
  const createProject = useProjects((s) => s.createProject)
  const renameProject = useProjects((s) => s.renameProject)
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleExportJson = () => {
    const active = getActiveProject()
    if (!active) {
      toast.error('Нет активного расчёта для экспорта')
      return
    }
    const json = JSON.stringify(active, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const slug = active.name.trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'project'
    const date = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `deckload-${slug}-${date}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success('Проект скачан')
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(reader.result))
      } catch {
        toast.error('Файл повреждён или это не JSON')
        return
      }
      const id = importProject(parsed)
      if (!id) {
        toast.error('Файл не похож на проект DeckLoad')
        return
      }
      toast.success('Проект импортирован')
    }
    reader.onerror = () => toast.error('Не удалось прочитать файл')
    reader.readAsText(file)
  }


  const handleNewCalculation = () => {
    useCalculator.setState({
      deck: { ...DEMO_DECK },
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      selectedPinIds: [],
      selectedAutoKeys: [],
      selectedManualIds: [],
      mode: 'auto',
      activeStampId: null,
      stampRotated: false,
    })
    clearCalculatorHistory()
    prevOverloadedZoneCountRef.current = 0
    toast.success('Текущий расчёт очищен')
  }

  // «Судно из библиотеки» (spec 8.1), as a new calculation: the vessel's
  // deck and data (deckForVessel), cargo empty. See src/lib/vesselTemplates.ts
  // for which of its figures are real and which estimated.
  //
  // Writes go through saveSnapshot (the PROJECT'S own persisted data),
  // never useCalculator.setState directly — createProject() switches
  // activeId, which schedules the page's "load project into calculator"
  // effect to run on the next commit and overwrite the calculator store from
  // projects.find(activeId)'s CURRENT data. Calling useCalculator.setState
  // synchronously here would just get clobbered by that effect a moment
  // later (confirmed live — vessel came back undefined). Updating the
  // project itself first means the load effect picks up the vessel data on
  // its own, instead of fighting it.
  const handleNewCalculationForVessel = (tpl: VesselTemplate) => {
    const newId = createProject(tpl.label)
    saveSnapshot({
      id: newId,
      deck: deckForVessel(tpl, { width: 0, length: 0, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 }),
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      mode: 'auto',
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    })
    toast.success(`Создан расчёт для «${tpl.label}»`)
    // A vessel whose sources disagree on deck strength gets no limit picked
    // for it: the choice waits in its card, and the zones check warns until
    // it's made. It used to be a toast that vanished after 20 seconds.
  }

  // The same vessel applied to the open calculation: its deck replaced, its
  // cargo kept (spec 8.1). A calculation still named as created takes the
  // vessel's name. «Отменить» puts back the deck and the name; Ctrl+Z, the
  // deck.
  const handleApplyVesselToCurrent = (tpl: VesselTemplate) => {
    const active = getActiveProject()
    const oldName = active?.name
    useCalculator.getState().applyVesselToDeck(tpl)
    const renamed = !!active && isDefaultCalculationName(active.name)
    if (renamed) renameProject(active.id, tpl.label)
    toast.success(`Судно «${tpl.label}» применено`, {
      action: {
        label: 'Отменить',
        onClick: () => {
          undoCalculator()
          if (renamed && oldName) renameProject(active.id, oldName)
        },
      },
    })
  }

  return { importInputRef, handleExportJson, handleImportFile, handleNewCalculation, handleNewCalculationForVessel, handleApplyVesselToCurrent }
}
