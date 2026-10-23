'use client'

import { StatsPanel } from '@/components/calculator/StatsPanel'
import { StabilityPanel } from '@/components/calculator/StabilityPanel'
import { LashingPointsSection, SeparationRulesSection } from '@/components/calculator/Sidebar'

// «Проверки» (spec 13, stage 2): the load statistics, the stability result,
// separation and lashing — today's content. Stage 4 turns it into the single
// list of checks (8.4).
export function ChecksSection({
  stats,
  stability,
  lashing,
}: {
  stats: React.ComponentProps<typeof StatsPanel>
  stability: React.ComponentProps<typeof StabilityPanel>
  lashing: React.ComponentProps<typeof LashingPointsSection>
}) {
  return (
    <>
      <StatsPanel {...stats} />
      <StabilityPanel {...stability} />
      <div className="px-4 py-3">
        <SeparationRulesSection />
      </div>
      <div className="px-4 py-3">
        <LashingPointsSection {...lashing} />
      </div>
    </>
  )
}
