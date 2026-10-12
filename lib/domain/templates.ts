import type { GateType } from './types';

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  phases: { gate: GateType; name: string; criteria: string[] }[];
  raidCategories: string[];
}

export const GATE_NAMES: Record<GateType, string> = {
  1: 'Mobilize',
  2: 'Plan',
  3: 'Execute',
  4: 'Accept',
  5: 'Transition',
};

const KDF_PHASES: ProjectTemplate['phases'] = [
  { gate: 1, name: 'Mobilize', criteria: ['Project charter approved', 'Acceptance criteria approved'] },
  { gate: 2, name: 'Plan', criteria: ['Baseline schedule approved', 'Baseline budget approved'] },
  { gate: 3, name: 'Execute', criteria: ['Each increment demonstrated and accepted'] },
  { gate: 4, name: 'Accept', criteria: ['UAT passed', 'Go-live readiness signed'] },
  { gate: 5, name: 'Transition', criteria: ['Stabilization targets met', 'Handover signed'] },
];

const RAID = ['Schedule', 'Cost', 'Resource', 'Technical', 'Vendor', 'Regulatory', 'Reputational'];

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: 'kdf-hybrid',
    name: 'Konnect Delivery Framework — Hybrid',
    description: 'Five gated phases with Agile sprints inside Execute.',
    phases: KDF_PHASES,
    raidCategories: RAID,
  },
  {
    id: 'kanban-retainer',
    name: 'Kanban Support Retainer',
    description: 'Continuous flow support with light gates for onboarding and handover.',
    phases: KDF_PHASES.map((p) =>
      p.gate === 3 ? { ...p, criteria: ['Monthly service review accepted'] } : p,
    ),
    raidCategories: RAID,
  },
  {
    id: 'advisory',
    name: 'Advisory Engagement',
    description: 'Discovery and recommendation work with client sign-off on each report.',
    phases: KDF_PHASES.map((p) => (p.gate === 3 ? { ...p, criteria: ['Findings report accepted'] } : p)),
    raidCategories: RAID,
  },
];

export const DEFAULT_TEMPLATE_ID = 'kdf-hybrid';
export const getTemplate = (id: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
