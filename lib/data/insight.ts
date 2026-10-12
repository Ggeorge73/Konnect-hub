import type { AuditEntry, Phase, Project, Rag, Session } from '../domain/types';
import {
  canManageProject,
  canSeeFinancials,
  canSeeProject,
  canSeeVisibility,
  isClientRole,
} from '../domain/permissions';
import {
  actualToDate,
  burnSeries,
  computeEvm,
  dollarsToCents,
  milestoneProgress,
  percentComplete,
  phaseBaseline,
  plannedValue,
  earnedValue,
  type BurnPoint,
  type Cents,
  type EvBaselineEntry,
  type EvmResult,
} from '../domain/evm';
import {
  canSeePortfolio,
  CRITICAL_RISK_SCORE,
  evmAccess,
  keyMilestones,
  nextActions,
  ragOverrideError,
  RAG_TEXT,
  suggestRag,
  topRisks,
  type ActionRow,
  type DashboardSettings,
  type Milestone,
  type RagSuggestion,
} from '../domain/dashboard';
import { deriveRaid, type RaidView } from '../domain/raid';
import { canSeeDeliverable } from '../domain/deliverables';
import { isPassed } from '../domain/gates';
import { GATE_NAMES } from '../domain/templates';
import { db } from './memory';
import { logActivity, requireVisibleProject, writeAudit } from './gates';
import { ForbiddenError, ValidationError } from './errors';

/**
 * Executive one-pager, earned value and portfolio dashboard (KH-25, KH-26, KH-28). Demo store.
 * Budget, actual cost and EVM money are internal (Admin / Delivery Lead) unless the Lead shares the
 * budget view with the client; other internal roles get SPI/CPI ratios only.
 */

export const isoDay = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Actual cost (cents) of a project up to and including `asOf` (YYYY-MM-DD).
 *
 * TODO(Sprint 4, time tracking): switch this hook to Σ approved time entries × the person's cost
 * rate (profile_rates) for entries dated on or before `asOf`. Until then AC comes from the seeded
 * `insight.actuals` array. Everything else (EVM, burn chart, PDF, portfolio) reads AC through here.
 */
export function actualCostFor(projectId: string, asOf: string): Cents {
  return actualToDate(actualsFor(projectId), asOf);
}

function actualsFor(projectId: string) {
  return db()
    .insight.actuals.filter((a) => a.projectId === projectId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function phasesOf(projectId: string): Phase[] {
  return db()
    .phases.filter((p) => p.projectId === projectId)
    .sort((a, b) => a.gate - b.gate);
}

/** Weighted milestones (deliverable-linked ones complete on acceptance), else linear across phases. */
export function baselineFor(project: Project): EvBaselineEntry[] {
  const d = db();
  const ms = d.insight.milestones.filter((m) => m.projectId === project.id);
  if (ms.length)
    return ms.map((m) => ({
      ...m,
      percentComplete: milestoneProgress(m, d.deliverables.find((x) => x.id === m.deliverableId)?.status),
    }));
  return phaseBaseline(
    phasesOf(project.id).map((p) => ({ ...p, passed: isPassed(p.status) })),
    project.startDate,
    project.targetDate,
  );
}

export interface ProjectEvm extends EvmResult {
  percentComplete: number;
  asOf: string;
}

export function projectEvm(project: Project, asOf: string): ProjectEvm {
  const entries = baselineFor(project);
  const bac = dollarsToCents(project.bac);
  return {
    ...computeEvm({
      bac,
      pv: plannedValue(bac, entries, asOf),
      ev: earnedValue(bac, entries),
      ac: actualCostFor(project.id, asOf),
    }),
    percentComplete: percentComplete(entries),
    asOf,
  };
}

export function settingsFor(projectId: string): DashboardSettings {
  const d = db();
  let s = d.insight.settings.find((x) => x.projectId === projectId);
  if (!s) {
    s = { projectId, shareBudget: false };
    d.insight.settings.push(s);
  }
  return s;
}

function raidViews(projectId: string, now: Date): RaidView[] {
  return db()
    .raid.filter((e) => e.projectId === projectId)
    .map((e) => deriveRaid(e, now));
}

function suggestionFor(project: Project, evm: Pick<EvmResult, 'spi' | 'cpi'>, now: Date): RagSuggestion {
  const raid = raidViews(project.id, now);
  return suggestRag({ spi: evm.spi, cpi: evm.cpi, risks: raid, issues: raid });
}

function currentGate(projectId: string) {
  const phases = phasesOf(projectId);
  const cur = phases.find((p) => !isPassed(p.status)) ?? phases[phases.length - 1];
  const gate = cur?.gate ?? 1;
  return { gate, name: GATE_NAMES[gate as 1] ?? `Gate ${gate}` };
}

// ---------------------------------------------------------------------------
// Project one-pager
// ---------------------------------------------------------------------------

/** EVM on the dashboard. Money fields are null when the viewer may only see ratios. */
export interface DashboardEvm {
  bac: Cents | null;
  pv: Cents | null;
  ev: Cents | null;
  ac: Cents | null;
  eac: Cents | null;
  vac: Cents | null;
  spi: number | null;
  cpi: number | null;
  spiWarning: boolean;
  cpiWarning: boolean;
  percentComplete: number;
}

export interface DashboardRisk {
  id: string;
  title: string;
  score: number;
  band: Rag | null;
  ownerName: string;
  escalate: boolean;
}

export interface DashboardView {
  projectId: string;
  projectKey: string;
  projectName: string;
  clientName: string;
  leadName: string;
  asOf: string;
  rag: Rag;
  ragReason?: string;
  /** Rule-based suggestion. Internal viewers only. */
  suggested: RagSuggestion | null;
  canOverride: boolean;
  shareBudget: boolean;
  /** 'full' = money + ratios, 'ratios' = SPI/CPI only, 'none' = hidden. */
  evmAccess: 'full' | 'ratios' | 'none';
  evm: DashboardEvm | null;
  /** Planned vs. actual cumulative (cents). Only with full EVM access. */
  burn: BurnPoint[] | null;
  phases: Phase[];
  milestones: Milestone[];
  topRisks: DashboardRisk[];
  actions: (ActionRow & { href: string })[];
}

export async function getDashboard(s: Session, key: string, now: Date = new Date()): Promise<DashboardView> {
  const d = db();
  const project = requireVisibleProject(s, key);
  const asOf = isoDay(now);
  const client = isClientRole(s.user.role);
  const settings = settingsFor(project.id);
  const access = evmAccess(s.user, {
    canSeeFinancials: canSeeFinancials(s.user),
    shareBudget: settings.shareBudget,
  });
  const full = projectEvm(project, asOf);
  const money = access === 'full';
  const evm: DashboardEvm | null =
    access === 'none'
      ? null
      : {
          bac: money ? full.bac : null,
          pv: money ? full.pv : null,
          ev: money ? full.ev : null,
          ac: money ? full.ac : null,
          eac: money ? full.eac : null,
          vac: money ? full.vac : null,
          spi: full.spi,
          cpi: full.cpi,
          spiWarning: full.spiWarning,
          cpiWarning: full.cpiWarning,
          percentComplete: full.percentComplete,
        };

  const raid = raidViews(project.id, now).filter((e) => canSeeVisibility(s.user, e.visibility));
  const items = d.items.filter(
    (i) => i.projectId === project.id && !i.deletedAt && canSeeVisibility(s.user, i.visibility),
  );
  const deliverables = d.deliverables.filter(
    (x) => x.projectId === project.id && canSeeDeliverable(s.user, x),
  );
  const phases = phasesOf(project.id);
  const name = (id?: string | null) => d.profiles.find((p) => p.id === id)?.name ?? '—';
  const base = client ? `/portal/${project.key}` : `/projects/${project.key}`;
  const hrefFor = (a: ActionRow) =>
    a.kind === 'item'
      ? `${base}${client ? '' : '/board'}?item=${a.ref}`
      : a.kind === 'deliverable'
        ? client
          ? base
          : `${base}/deliverables`
        : client
          ? base
          : `${base}/raid`;

  return {
    projectId: project.id,
    projectKey: project.key,
    projectName: project.name,
    clientName: d.orgs.find((o) => o.id === project.clientOrgId)?.name ?? '—',
    leadName: name(project.leadId),
    asOf,
    rag: project.rag,
    ragReason: project.ragReason,
    suggested: client ? null : suggestionFor(project, full, now),
    canOverride: canManageProject(s.user, project),
    shareBudget: settings.shareBudget,
    evmAccess: access,
    evm,
    burn: money
      ? burnSeries(
          full.bac,
          baselineFor(project),
          actualsFor(project.id),
          project.startDate,
          project.targetDate,
          asOf,
        )
      : null,
    phases,
    milestones: keyMilestones(
      {
        sprints: d.sprints.filter((sp) => sp.projectId === project.id),
        phases,
        deliverables,
      },
      asOf,
    ),
    topRisks: topRisks(raid).map((r) => ({
      id: r.id,
      title: r.title,
      score: r.score!,
      band: r.band,
      ownerName: name(r.ownerId),
      escalate: r.escalate,
    })),
    actions: nextActions({ items, deliverables, raid }, asOf).map((a) => ({ ...a, href: hrefFor(a) })),
  };
}

function requireManager(s: Session, key: string): Project {
  const project = requireVisibleProject(s, key);
  if (!canManageProject(s.user, project))
    throw new ForbiddenError('Only the project Lead or an Admin can change the dashboard.');
  return project;
}

/** Lead/Admin override of the RAG status. A reason is required; every change is audited. */
export async function overrideRag(
  s: Session,
  key: string,
  input: { rag: Rag; reason: string },
  ip?: string,
): Promise<Pick<Project, 'rag' | 'ragReason'>> {
  const project = requireManager(s, key);
  const err = ragOverrideError(input.reason);
  if (err) throw new ValidationError(err);
  const before = { rag: project.rag, ragReason: project.ragReason };
  project.rag = input.rag;
  project.ragReason = input.reason.trim();
  const after = { rag: project.rag, ragReason: project.ragReason };
  writeAudit(s, 'project.rag_override', 'project', project.id, before, after, ip);
  logActivity(s, project.id, 'project.rag', `RAG status set to ${RAG_TEXT[input.rag]}`);
  return after;
}

/** Lead/Admin toggles whether clients see budget/EVM on the portal dashboard. Audited. */
export async function setShareBudget(
  s: Session,
  key: string,
  shareBudget: boolean,
  ip?: string,
): Promise<DashboardSettings> {
  const project = requireManager(s, key);
  const settings = settingsFor(project.id);
  const before = settings.shareBudget;
  settings.shareBudget = shareBudget;
  settings.updatedBy = s.user.id;
  settings.updatedAt = new Date().toISOString();
  if (before !== shareBudget)
    writeAudit(
      s,
      'dashboard.share_budget',
      'project',
      project.id,
      { shareBudget: before },
      { shareBudget },
      ip,
    );
  return settings;
}

/** Audits a PDF export of the one-pager. */
export function recordDashboardExport(s: Session, projectId: string, variant: string, ip?: string) {
  writeAudit(s, 'dashboard.export_pdf', 'project', projectId, undefined, { variant }, ip);
}

/** Dashboard-related audit entries for a project (Lead/Admin). */
export async function listDashboardAudit(s: Session, key: string): Promise<AuditEntry[]> {
  const project = requireManager(s, key);
  return db()
    .audit.filter(
      (a) =>
        a.entity === 'project' &&
        a.entityId === project.id &&
        (a.action.startsWith('project.rag') || a.action.startsWith('dashboard.')),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export interface PortfolioRow {
  id: string;
  key: string;
  name: string;
  clientOrgId: string;
  clientName: string;
  leadId: string;
  leadName: string;
  rag: Rag;
  ragReason?: string;
  suggestedRag: Rag;
  gate: number;
  gateName: string;
  spi: number | null;
  cpi: number | null;
  /** Null for viewers without financial access. */
  vac: Cents | null;
  spiWarning: boolean;
  cpiWarning: boolean;
  criticalRisks: number;
  percentComplete: number;
}

export interface PortfolioView {
  asOf: string;
  money: boolean;
  rows: PortfolioRow[];
  clients: { id: string; name: string }[];
  leads: { id: string; name: string }[];
}

export async function getPortfolio(s: Session, now: Date = new Date()): Promise<PortfolioView> {
  if (!canSeePortfolio(s.user)) throw new ForbiddenError('The portfolio dashboard is for Konnector staff.');
  const d = db();
  const asOf = isoDay(now);
  const money = canSeeFinancials(s.user);
  const projects = d.projects.filter((p) => !p.deletedAt && canSeeProject(s.user, p, d.members));
  const rows = projects.map((p): PortfolioRow => {
    const evm = projectEvm(p, asOf);
    const raid = raidViews(p.id, now);
    const g = currentGate(p.id);
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      clientOrgId: p.clientOrgId,
      clientName: d.orgs.find((o) => o.id === p.clientOrgId)?.name ?? '—',
      leadId: p.leadId,
      leadName: d.profiles.find((u) => u.id === p.leadId)?.name ?? '—',
      rag: p.rag,
      ragReason: p.ragReason,
      suggestedRag: suggestRag({ spi: evm.spi, cpi: evm.cpi, risks: raid, issues: raid }).rag,
      gate: g.gate,
      gateName: g.name,
      spi: evm.spi,
      cpi: evm.cpi,
      vac: money ? evm.vac : null,
      spiWarning: evm.spiWarning,
      cpiWarning: evm.cpiWarning,
      criticalRisks: raid.filter(
        (r) => r.kind === 'risk' && r.status !== 'closed' && (r.score ?? 0) >= CRITICAL_RISK_SCORE,
      ).length,
      percentComplete: evm.percentComplete,
    };
  });
  const uniq = (pairs: [string, string][]) =>
    [...new Map(pairs).entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  return {
    asOf,
    money,
    rows: rows.sort((a, b) => a.key.localeCompare(b.key)),
    clients: uniq(rows.map((r) => [r.clientOrgId, r.clientName])),
    leads: uniq(rows.map((r) => [r.leadId, r.leadName])),
  };
}
