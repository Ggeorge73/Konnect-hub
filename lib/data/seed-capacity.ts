import type { Profile, Project, ProjectMember } from '../domain/types';
import {
  addWeeks,
  capacityOf,
  defaultAllocations,
  nextWeeks,
  type Allocation,
  type CapacityState,
  type PersonExtras,
} from '../domain/capacity';

/** Certifications and locations of the demo staff (mirrored in supabase/seed.sql, 0011 columns). */
export const SEED_EXTRAS: Record<string, PersonExtras> = {
  u_admin: { certifications: ['PMP', 'SAFe SPC'], location: 'Atlanta, GA' },
  u_lead: { certifications: ['PMP', 'CSM'], location: 'Atlanta, GA' },
  u_team: { certifications: ['ISTQB Foundation'], location: 'Chicago, IL' },
  u_dev: { certifications: ['AWS Developer Associate'], location: 'Raleigh, NC' },
  u_assoc: { certifications: ['HL7 FHIR R4'], location: 'London, UK' },
};

/** The seeded cutover spike: u_dev puts a full 40 h on EHR in the third grid week (48 h = 120%). */
export const SEED_SPIKE = { userId: 'u_dev', projectId: 'p_ehr', weekOffset: 2, hours: 40 };

/**
 * Capacity seed: weekly allocations for every project member (hours per week × allocation %)
 * across the next 12 ISO weeks, capped to each project's window, plus one over-allocated week.
 * Relative to `now` so the grid always has data; supabase/seed.sql does the same with current_date.
 */
export function seedCapacity(
  members: ProjectMember[],
  projects: Project[],
  profiles: Profile[],
  now: Date = new Date(),
): { capacity: CapacityState } {
  const weeks = nextWeeks(now);
  const allocations: Allocation[] = [];
  for (const m of members) {
    const project = projects.find((p) => p.id === m.projectId);
    const person = profiles.find((p) => p.id === m.userId);
    if (!project || !person) continue;
    for (const a of defaultAllocations(capacityOf(person), m.allocationPct, project, weeks))
      allocations.push({
        id: `al_${m.projectId}_${m.userId}_${a.week}`,
        projectId: m.projectId,
        userId: m.userId,
        ...a,
      });
  }
  const spikeWeek = addWeeks(weeks[0], SEED_SPIKE.weekOffset);
  const spike = allocations.find(
    (a) => a.userId === SEED_SPIKE.userId && a.projectId === SEED_SPIKE.projectId && a.week === spikeWeek,
  );
  if (spike) spike.hours = SEED_SPIKE.hours;
  return { capacity: { allocations, extras: structuredClone(SEED_EXTRAS) } };
}
