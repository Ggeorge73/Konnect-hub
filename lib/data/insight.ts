import type { AuditEntry, Phase, Project, Rag, Session, Sprint, Visibility, WorkItem } from '../domain/types';
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
  type ActualCost,
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
import { approvedTimeActuals, mergeActuals } from '../domain/ledger';
import { db } from './memory';
import { logActivity, requireVisibleProject, writeAudit } from './gates';
import { ForbiddenError, ValidationError } from './errors';
import { isPostgresEnabled } from './index';
import { postgresInsightStore } from './insight-postgres';

/**
 * Executive one-pager, earned value and portfolio dashboard (KH-25, KH-26, KH-28).
 * Budget, actual cost and EVM money are internal (Admin / Delivery Lead) unless the Lead shares the
 * budget view with the client; other internal roles get SPI/CPI ratios only.
 *
 * `InsightStore` has two implementations, picked like getRepo(): the demo store below and the
 * Postgres + RLS store in insight-postgres.ts. Both load the same `DashboardInputs` and share the
 * pure assembly (`assembleDashboard`, `portfolioRow`), so the redaction rules live in one place.
 * Shared behaviour: lib/data/contract-insight.ts.
 */

export const isoDay = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Actual cost (cents) of a project up to and including `asOf` (YYYY-MM-DD).
 *
 * Sprint 4 (TIME-01): AC = Σ approved time entries × the person's internal cost rate
 * (Admin-only profile cost rate), in integer cents, on each entry's date. The seeded / imported
 * `insight.actuals` are only a fallback for dates BEFORE the project's first approved entry (the
 * cutover, see mergeActuals in lib/domain/ledger.ts): before the cutover AC is the seeded actuals,
 * from the cutover on it is seeded actuals dated before the cutover + approved time. A project
 * with no approved time keeps its seeded actuals. Draft, submitted and rejected time never count.
 * Everything else (EVM, burn chart, PDF, portfolio) reads AC through here. On Postgres the same
 * time-based sum is public.project_actual_cost() (0012_ledger.sql).
 */
export function actualCostFor(projectId: string, asOf: string): Cents {
  return actualToDate(actualsFor(projectId), asOf);
}

function actualsFor(projectId: string) {
  const d = db();
  const seeded = d.insight.actuals.filter((a) => a.projectId === projectId);
  const rate = (userId: string) => d.profiles.find((p) => p.id === userId)?.costRate;
  const fromTime = approvedTimeActuals(
    d.ledger.timeEntries.filter((e) => e.projectId === projectId),
    rate,
  );
  return mergeActuals(seeded, fromTime);
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

/** What EVM is computed from: BAC (cents), the time-phased baseline, and actual cost per day. */
export interface EvmInputs {
  bac: Cents;
  baseline: EvBaselineEntry[];
  actuals: ActualCost[];
}

export function evmFrom({ bac, baseline, actuals }: EvmInputs, asOf: string): ProjectEvm {
  return {
    ...computeEvm({
      bac,
      pv: plannedValue(bac, baseline, asOf),
      ev: earnedValue(bac, baseline),
      ac: actualToDate(actuals, asOf),
    }),
    percentComplete: percentComplete(baseline),
    asOf,
  };
}

function memEvmInputs(project: Project): EvmInputs {
  return {
    bac: dollarsToCents(project.bac),
    baseline: baselineFor(project),
    actuals: actualsFor(project.id),
  };
}

export function projectEvm(project: Project, asOf: string): ProjectEvm {
  return evmFrom(memEvmInputs(project), asOf);
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

const suggestionFor = (evm: Pick<EvmResult, 'spi' | 'cpi'>, raid: RaidView[]): RagSuggestion =>
  suggestRag({ spi: evm.spi, cpi: evm.cpi, risks: raid, issues: raid });

/** The first phase not yet passed (or the last one), sorted by gate. */
export function currentGate(phases: Pick<Phase, 'gate' | 'status'>[]) {
  const sorted = [...phases].sort((a, b) => a.gate - b.gate);
  const cur = sorted.find((p) => !isPassed(p.status)) ?? sorted[sorted.length - 1];
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

/** Everything one dashboard is built from, as the viewer may see it (store-specific loading). */
export interface DashboardInputs {
  project: Project;
  clientName: string;
  nameOf: (id?: string | null) => string;
  shareBudget: boolean;
  /** Full EVM inputs; money is masked per evmAccess() in assembleDashboard. */
  evm: EvmInputs;
  phases: Phase[];
  sprints: Pick<Sprint, 'name' | 'endDate'>[];
  /** Deliverables the viewer may see (canSeeDeliverable). */
  deliverables: {
    id: string;
    name: string;
    status: string;
    dueDate: string | null;
    visibility: Visibility;
  }[];
  /** The project's RAID entries as the store returns them (all of them for internal viewers). */
  raid: RaidView[];
  /** Work items the viewer may see. */
  items: Pick<WorkItem, 'key' | 'title' | 'status' | 'dueDate'>[];
}

/** Builds the one-pager for the viewer: the single place where money and internal rows are redacted. */
export function assembleDashboard(s: Session, inp: DashboardInputs, now: Date): DashboardView {
  const { project } = inp;
  const asOf = isoDay(now);
  const client = isClientRole(s.user.role);
  const access = evmAccess(s.user, {
    canSeeFinancials: canSeeFinancials(s.user),
    shareBudget: inp.shareBudget,
  });
  const full = evmFrom(inp.evm, asOf);
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

  const raid = inp.raid.filter((e) => canSeeVisibility(s.user, e.visibility));
  const phases = [...inp.phases].sort((a, b) => a.gate - b.gate);
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
    clientName: inp.clientName,
    leadName: inp.nameOf(project.leadId),
    asOf,
    rag: project.rag,
    ragReason: project.ragReason,
    suggested: client ? null : suggestionFor(full, inp.raid),
    canOverride: canManageProject(s.user, project),
    shareBudget: inp.shareBudget,
    evmAccess: access,
    evm,
    burn: money
      ? burnSeries(full.bac, inp.evm.baseline, inp.evm.actuals, project.startDate, project.targetDate, asOf)
      : null,
    phases,
    milestones: keyMilestones({ sprints: inp.sprints, phases, deliverables: inp.deliverables }, asOf),
    topRisks: topRisks(raid).map((r) => ({
      id: r.id,
      title: r.title,
      score: r.score!,
      band: r.band,
      ownerName: inp.nameOf(r.ownerId),
      escalate: r.escalate,
    })),
    actions: nextActions({ items: inp.items, deliverables: inp.deliverables, raid }, asOf).map((a) => ({
      ...a,
      href: hrefFor(a),
    })),
  };
}

async function memGetDashboard(s: Session, key: string, now: Date = new Date()): Promise<DashboardView> {
  const d = db();
  const project = requireVisibleProject(s, key);
  return assembleDashboard(
    s,
    {
      project,
      clientName: d.orgs.find((o) => o.id === project.clientOrgId)?.name ?? '—',
      nameOf: (id) => d.profiles.find((p) => p.id === id)?.name ?? '—',
      shareBudget: settingsFor(project.id).shareBudget,
      evm: memEvmInputs(project),
      phases: phasesOf(project.id),
      sprints: d.sprints.filter((sp) => sp.projectId === project.id),
      deliverables: d.deliverables.filter((x) => x.projectId === project.id && canSeeDeliverable(s.user, x)),
      raid: raidViews(project.id, now),
      items: d.items.filter(
        (i) => i.projectId === project.id && !i.deletedAt && canSeeVisibility(s.user, i.visibility),
      ),
    },
    now,
  );
}

function requireManager(s: Session, key: string): Project {
  const project = requireVisibleProject(s, key);
  if (!canManageProject(s.user, project))
    throw new ForbiddenError('Only the project Lead or an Admin can change the dashboard.');
  return project;
}

async function memOverrideRag(
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

async function memSetShareBudget(
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

async function memRecordDashboardExport(s: Session, projectId: string, variant: string, ip?: string) {
  writeAudit(s, 'dashboard.export_pdf', 'project', projectId, undefined, { variant }, ip);
}

async function memListDashboardAudit(s: Session, key: string): Promise<AuditEntry[]> {
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

async function memGetPortfolio(s: Session, now: Date = new Date()): Promise<PortfolioView> {
  if (!canSeePortfolio(s.user)) throw new ForbiddenError('The portfolio dashboard is for Konnector staff.');
  const d = db();
  const asOf = isoDay(now);
  const money = canSeeFinancials(s.user);
  const projects = d.projects.filter((p) => !p.deletedAt && canSeeProject(s.user, p, d.members));
  const rows = projects.map((p) =>
    portfolioRow(p, {
      clientName: d.orgs.find((o) => o.id === p.clientOrgId)?.name ?? '—',
      leadName: d.profiles.find((u) => u.id === p.leadId)?.name ?? '—',
      evm: projectEvm(p, asOf),
      raid: raidViews(p.id, now),
      phases: phasesOf(p.id),
      money,
    }),
  );
  return assemblePortfolio(rows, asOf, money);
}

/** One portfolio row. `raid` is every entry of the project (portfolio viewers are internal). */
export function portfolioRow(
  p: Project,
  x: {
    clientName: string;
    leadName: string;
    evm: ProjectEvm;
    raid: RaidView[];
    phases: Pick<Phase, 'gate' | 'status'>[];
    money: boolean;
  },
): PortfolioRow {
  const { evm, raid } = x;
  const g = currentGate(x.phases);
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    clientOrgId: p.clientOrgId,
    clientName: x.clientName,
    leadId: p.leadId,
    leadName: x.leadName,
    rag: p.rag,
    ragReason: p.ragReason,
    suggestedRag: suggestionFor(evm, raid).rag,
    gate: g.gate,
    gateName: g.name,
    spi: evm.spi,
    cpi: evm.cpi,
    vac: x.money ? evm.vac : null,
    spiWarning: evm.spiWarning,
    cpiWarning: evm.cpiWarning,
    criticalRisks: raid.filter(
      (r) => r.kind === 'risk' && r.status !== 'closed' && (r.score ?? 0) >= CRITICAL_RISK_SCORE,
    ).length,
    percentComplete: evm.percentComplete,
  };
}

export function assemblePortfolio(rows: PortfolioRow[], asOf: string, money: boolean): PortfolioView {
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

// ---------------------------------------------------------------------------
// Store selection (KH-51)
// ---------------------------------------------------------------------------

export interface InsightStore {
  getDashboard(s: Session, key: string, now?: Date): Promise<DashboardView>;
  /** Lead/Admin override of the RAG status. A reason is required; every change is audited. */
  overrideRag(
    s: Session,
    key: string,
    input: { rag: Rag; reason: string },
    ip?: string,
  ): Promise<Pick<Project, 'rag' | 'ragReason'>>;
  /** Lead/Admin toggles whether clients see budget/EVM on the portal dashboard. Audited. */
  setShareBudget(s: Session, key: string, shareBudget: boolean, ip?: string): Promise<DashboardSettings>;
  /** Audits a PDF export of the one-pager. */
  recordDashboardExport(s: Session, projectId: string, variant: string, ip?: string): Promise<void>;
  /** Dashboard-related audit entries for a project (Lead/Admin), newest first. */
  listDashboardAudit(s: Session, key: string): Promise<AuditEntry[]>;
  getPortfolio(s: Session, now?: Date): Promise<PortfolioView>;
}

export const memoryInsightStore: InsightStore = {
  getDashboard: memGetDashboard,
  overrideRag: memOverrideRag,
  setShareBudget: memSetShareBudget,
  recordDashboardExport: memRecordDashboardExport,
  listDashboardAudit: memListDashboardAudit,
  getPortfolio: memGetPortfolio,
};

/** The active Insight store: Postgres + RLS when getRepo() would pick Postgres, else the demo store. */
export const insightStore = (): InsightStore =>
  isPostgresEnabled() ? postgresInsightStore() : memoryInsightStore;

export const getDashboard: InsightStore['getDashboard'] = (...a) => insightStore().getDashboard(...a);
export const overrideRag: InsightStore['overrideRag'] = (...a) => insightStore().overrideRag(...a);
export const setShareBudget: InsightStore['setShareBudget'] = (...a) => insightStore().setShareBudget(...a);
export const recordDashboardExport: InsightStore['recordDashboardExport'] = (...a) =>
  insightStore().recordDashboardExport(...a);
export const listDashboardAudit: InsightStore['listDashboardAudit'] = (...a) =>
  insightStore().listDashboardAudit(...a);
export const getPortfolio: InsightStore['getPortfolio'] = (...a) => insightStore().getPortfolio(...a);
