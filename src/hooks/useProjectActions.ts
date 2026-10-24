'use client'

import { useRef } from 'react'
import { toast } from 'sonner'
import type { VesselTemplate } from '@/lib/vesselTemplates'
import { clearCalculatorHistory, DEMO_DECK, useCalculator } from '@/store/calculator'
import { useProjects } from '@/store/projects'

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

  // "Судно" header button — creates a fresh calculation with a real
  // vessel's deck size + stability data (lightship/hydrostatics/tanks)
  // already filled in. Cargo is deliberately left empty; see
  // src/lib/vesselTemplates.ts for exactly which fields are real vs.
  // estimated for each vessel.
  //
  // Writes go through saveSnapshot (the PROJECT'S own persisted data),
  // never useCalculator.setState directly — createProject() switches
  // activeId, which schedules the "load project into calculator" effect
  // above (~line 332) to run on the next commit and overwrite the
  // calculator store from projects.find(activeId)'s CURRENT data. Calling
  // useCalculator.setState synchronously here would just get clobbered by
  // that effect a moment later (confirmed live — vessel came back
  // undefined). Updating the project itself first means the load effect
  // picks up the vessel data on its own, instead of fighting it.
  const handleApplyVesselTemplate = (tpl: VesselTemplate) => {
    const newId = createProject(tpl.label)
    saveSnapshot({
      id: newId,
      deck: {
        width: tpl.deck.width,
        length: tpl.deck.length,
        unit: 'm',
        gap: 0.1,
        boardOffset: 0.2,
        // Seed the deck-wide stack-height budget from the vessel's own
        // approved limit (e.g. 3.0 m for a pipe stack, ДВТК п. 2.1.2) — the
        // number was already shown in the picker as a promise, so applying
        // the template must actually make it bind, not just display it.
        clearance: tpl.limits?.maxStackHeightM ?? 0,
        // Same reasoning as clearance above — the picker already shows
        // "груз до N т" as a promise; without binding it here, the app can
        // silently let a user load far past the vessel's own approved
        // total-deck-cargo capacity with zero warning (this WAS the case —
        // maxDeckCargoT existed only as picker text, never checked).
        maxDeckCargoT: tpl.limits?.maxDeckCargoT,
        tenFootContainerCapacity: tpl.limits?.tenFootContainerCapacity,
        vessel: tpl.vessel,
        shipFrame: tpl.shipFrame,
        deckForwardIsPositiveY: tpl.deckForwardIsPositiveY,
        // A non-rectangular real deck silhouette (digitized from a GA
        // drawing) and its real obstacles (hatches, moon pool, etc.) —
        // same "bind the promise, don't just display it" reasoning as
        // clearance/maxDeckCargoT above. Both undefined for a template
        // with only a plain rectangular deck (e.g. Kuznetsov).
        outline: tpl.deck.outline,
        restrictionZones: tpl.restrictionZones,
        // Remembered, so the deck-strength choice (Sidebar «Зоны нагрузки»)
        // knows which vessel's sources to offer, also after a reload.
        vesselTemplateId: tpl.id,
      },
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
    // for it: the choice waits in «Зоны нагрузки» (opened by itself) and the
    // stats say «лимит не выбран» until it's made. It used to be a toast
    // that vanished after 20 seconds, leaving no limit and no reminder.
  }

  return { importInputRef, handleExportJson, handleImportFile, handleNewCalculation, handleApplyVesselTemplate }
}
