import { create } from 'zustand'
import type { VesselStepId } from '@/lib/vesselSteps'

// Which «Судно» blocks the user has opened, per calculation, for this
// session (spec 8.1, revision 2026-10-30). Unset for a calculation until the
// user first opens or folds a block — till then the section opens on its
// own pick each time it is entered, and nothing moves while it is open.
type OpenSteps = Partial<Record<VesselStepId, boolean>>

interface VesselStepsState {
  byProject: Record<string, OpenSteps>
  set: (projectId: string, open: OpenSteps) => void
}

export const useVesselSteps = create<VesselStepsState>((set) => ({
  byProject: {},
  set: (projectId, open) => set((s) => ({ byProject: { ...s.byProject, [projectId]: open } })),
}))

// «Настроить в разделе „Судно“» from a check: its block opens, the others
// stay as the user left them.
export function openVesselStep(projectId: string, step: VesselStepId) {
  const { byProject, set } = useVesselSteps.getState()
  set(projectId, { ...byProject[projectId], [step]: true })
}
