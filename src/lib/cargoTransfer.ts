// A vessel's cargo onto a platform (spec 2026-11-06, 13): what a saved
// vessel calculation's trip carries, unit by unit, copied into the
// platform's list as «приход». A copy, not a link: the vessel's plan
// changed, the trip is taken over again and replaces what it brought.
import type { Project } from '@/store/projects'
import { placedByItem } from './cargoTable'
import { itemWithConv } from './itemUnits'
import { isPlatform } from './objectKind'
import type { CargoItem, CargoSource } from './packing'
import { tripsOfProject } from './trips'
import { convertLength, type Unit } from './units'

export interface TripCargoLine {
  // The cargo as the vessel's calculation has it.
  item: CargoItem
  // Its units the trip places.
  units: number
}

export interface VesselTrip {
  // From 0, as the vessel's trip tabs count from 1.
  trip: number
  lines: TripCargoLine[]
}

// The vessel calculations cargo can be taken from: every saved one but the
// open one, and no platform's.
export function vesselSources(projects: readonly Project[], openId: string | null): Project[] {
  return projects.filter((p) => p.id !== openId && !isPlatform(p.deck))
}

// Each trip the vessel's own screen shows, with every cargo it places and
// how many units of it. What fits in no trip isn't in any.
export function vesselTrips(project: Project): VesselTrip[] {
  return tripsOfProject(project).map((t, trip) => {
    const placed = placedByItem(t.placed)
    return {
      trip,
      lines: project.items.flatMap((item) => {
        const units = placed.get(item.id)?.units ?? 0
        return units > 0 ? [{ item, units }] : []
      }),
    }
  })
}

// The weight of the lines, kg; cargo without a weight adds nothing.
export function linesWeightKg(lines: readonly TripCargoLine[]): number {
  return lines.reduce((sum, l) => sum + (l.item.weight !== undefined && l.item.weight > 0 ? l.item.weight * l.units : 0), 0)
}

// The cargo the platform takes: in its deck's unit, with ids of its own,
// as many units as the trip carries, arriving, its source noted.
export function takenOverItems(lines: readonly TripCargoLine[], fromUnit: Unit, toUnit: Unit, source: CargoSource, newId: () => string): CargoItem[] {
  const conv = (v: number) => convertLength(v, fromUnit, toUnit)
  return lines.map(({ item, units }) => ({ ...itemWithConv(item, conv), id: newId(), quantity: units, platformStatus: 'incoming', from: source }))
}

// The cargo this trip brought before: from this calculation, or from one
// of the same name — a file opened again is a calculation with a new id.
// The panel names it and lets it stay (two vessels' calculations can share
// a name).
export function takenBefore(items: readonly CargoItem[], source: Pick<Project, 'id' | 'name'>, trip: number): CargoItem[] {
  return items.filter((it) => it.from !== undefined && it.from.trip === trip && (it.from.projectId === source.id || it.from.projectName === source.name))
}
