import type { Repo, ProjectSummary, ItemFilters, SearchResult } from './repo';
import type { Comment, Session, WorkItem, Project, ActivityEvent } from '../domain/types';
import { buildPhases, buildSeed, DEMO_PROJECT_KEY, type Db } from './seed';
import { newId } from './ids';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import {
  canComment,
  canCreateProject,
  canEditItems,
  canManageProject,
  canSeeProject,
  canSeeVisibility,
  isClientRole,
  redactProfile,
  redactProject,
} from '../domain/permissions';
import { canTransition, STATUS_LABEL } from '../domain/workflow';
import { GATE_NAMES } from '../domain/templates';
import { recordStatusChange } from './pulse-history';
import { onCommentAdded, onItemCreated, onItemUpdated } from './notify';
import { restrictedRefusal, RESTRICTED_REFUSED } from '../domain/capacity';
import { memoryTemplates } from './templates-admin';

const g = globalThis as unknown as { __khDb?: Db };
export const db = (): Db => (g.__khDb ??= buildSeed());
export const resetDb = () => {
  g.__khDb = buildSeed();
};

const now = () => new Date().toISOString();

function visibleProjects(s: Session): Project[] {
  const d = db();
  return d.projects.filter((p) => canSeeProject(s.user, p, d.members));
}

function requireProject(s: Session, id: string): Project {
  const p = visibleProjects(s).find((x) => x.id === id || x.key === id);
  if (!p) throw new NotFoundError('Project not found');
  return p;
}

function visibleItem(s: Session, w: WorkItem) {
  return !w.deletedAt && canSeeVisibility(s.user, w.visibility);
}

function log(s: Session, projectId: string, action: string, detail: string, itemId?: string) {
  const ev: ActivityEvent = {
    id: newId('ac'),
    projectId,
    itemId,
    actorId: s.user.id,
    action,
    detail,
    at: now(),
  };
  db().activity.push(ev);
}

function audit(
  s: Session,
  action: string,
  entity: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
) {
  db().audit.push({
    id: newId('au'),
    actorId: s.user.id,
    action,
    entity,
    entityId,
    before,
    after,
    at: now(),
  });
}

/** SEC-02: a non-U.S. person can't be the assignee of an item in a restricted project (audited). */
function checkAssignee(s: Session, project: Project, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const msg = restrictedRefusal(
    project,
    db().profiles.find((p) => p.id === assigneeId),
  );
  if (!msg) return;
  audit(s, RESTRICTED_REFUSED, 'project', project.id, undefined, {
    userId: assigneeId,
    via: 'assignee',
    message: msg,
  });
  throw new ValidationError(msg);
}

function summarize(s: Session, p: Project): ProjectSummary {
  const d = db();
  const items = d.items.filter(
    (i) => i.projectId === p.id && !i.deletedAt && canSeeVisibility(s.user, i.visibility),
  );
  const work = items.filter((i) => i.type !== 'epic' && i.type !== 'feature');
  const done = work.filter((i) => i.status === 'done' || i.status === 'accepted').length;
  const phases = d.phases.filter((ph) => ph.projectId === p.id).sort((a, b) => a.gate - b.gate);
  const current =
    phases.find((ph) => ph.status !== 'approved' && ph.status !== 'approved_with_conditions') ??
    phases[phases.length - 1];
  const nextSprint = d.sprints
    .filter((sp) => sp.projectId === p.id && sp.status !== 'completed')
    .sort((a, b) => a.endDate.localeCompare(b.endDate))[0];
  return {
    ...redactProject(s.user, p),
    clientName: d.orgs.find((o) => o.id === p.clientOrgId)?.name ?? '—',
    leadName: d.profiles.find((u) => u.id === p.leadId)?.name ?? '—',
    currentGate: current?.gate ?? 1,
    currentGateName: current ? GATE_NAMES[current.gate] : 'Mobilize',
    percentComplete: work.length ? Math.round((done / work.length) * 100) : 0,
    openCritical: items.filter(
      (i) => i.priority === 'critical' && i.status !== 'done' && i.status !== 'accepted',
    ).length,
    itemCount: items.length,
    nextMilestone: nextSprint
      ? { name: `${nextSprint.name} ends`, date: nextSprint.endDate }
      : { name: 'Target date', date: p.targetDate },
  };
}

function applyFilters(items: WorkItem[], f: ItemFilters) {
  const q = f.q?.trim().toLowerCase();
  return items.filter(
    (i) =>
      (!f.projectId || i.projectId === f.projectId) &&
      (!f.type?.length || f.type.includes(i.type)) &&
      (!f.status?.length || f.status.includes(i.status)) &&
      (!f.assigneeId?.length || f.assigneeId.includes(i.assigneeId ?? 'unassigned')) &&
      (!f.label?.length || f.label.some((l) => i.labels.includes(l))) &&
      (!f.phaseId || i.phaseId === f.phaseId) &&
      (f.sprintId === undefined || (i.sprintId ?? null) === f.sprintId) &&
      (!f.visibility || i.visibility === f.visibility) &&
      (!f.updatedSince || i.updatedAt >= f.updatedSince) &&
      (!q ||
        i.title.toLowerCase().includes(q) ||
        i.key.toLowerCase() === q ||
        i.description.toLowerCase().includes(q)),
  );
}

export const memoryRepo: Repo = {
  async listOrgs(s) {
    const d = db();
    if (isClientRole(s.user.role))
      return d.orgs.filter((o) => o.id === s.user.orgId || o.type === 'internal');
    if (s.user.role === 'associate') return d.orgs.filter((o) => o.type === 'internal');
    return d.orgs;
  },

  async listPeople(s) {
    const d = db();
    const visible = isClientRole(s.user.role)
      ? d.profiles.filter((p) => p.orgId === s.user.orgId || p.orgId === 'org_konnector')
      : d.profiles;
    return visible.map((p) => redactProfile(s.user, p));
  },

  async listProjects(s) {
    return visibleProjects(s)
      .filter((p) => !p.deletedAt)
      .map((p) => summarize(s, p));
  },

  async getProjectBundle(s, key) {
    const d = db();
    const project = requireProject(s, key);
    const people = await this.listPeople(s);
    return {
      project: redactProject(s.user, project),
      client: d.orgs.find((o) => o.id === project.clientOrgId)!,
      phases: d.phases.filter((p) => p.projectId === project.id).sort((a, b) => a.gate - b.gate),
      criteria: d.criteria.filter((c) => c.phaseId.startsWith(project.id + '_')),
      sprints: d.sprints.filter((sp) => sp.projectId === project.id),
      members: d.members.filter((m) => m.projectId === project.id),
      people,
    };
  },

  async createProject(s, input) {
    if (!canCreateProject(s.user))
      throw new ForbiddenError('Only Admins and Delivery Leads can create projects.');
    const d = db();
    const key = input.key.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key))
      throw new ValidationError('Key must be 2–10 letters or digits, starting with a letter.');
    if (d.projects.some((p) => p.key === key)) throw new ValidationError(`Key ${key} is already used.`);
    if (!d.orgs.some((o) => o.id === input.clientOrgId && o.type === 'client'))
      throw new ValidationError('Unknown client.');
    // ADM-01: built-in or Admin-made (custom) templates; archived ones can't start projects.
    const template = memoryTemplates().find((t) => t.id === input.templateId && !t.archivedAt);
    if (!template) throw new ValidationError(`Unknown template ${input.templateId}.`);
    // KH-36: restricted projects only allow U.S. persons, the lead included (mirrors the 0011 trigger).
    if (input.restricted && !d.profiles.find((u) => u.id === input.leadId)?.usPerson)
      throw new ValidationError('A restricted project needs a U.S.-person lead.');
    const project: Project = {
      id: newId('p'),
      key,
      name: input.name.trim(),
      clientOrgId: input.clientOrgId,
      leadId: input.leadId,
      startDate: input.startDate,
      targetDate: input.targetDate,
      methodology: input.methodology,
      contractType: input.contractType,
      bac: input.bac,
      description: input.description,
      status: 'active',
      restricted: Boolean(input.restricted),
      rag: 'green',
      estimateUnit: 'points',
      templateId: input.templateId,
      nextItemNumber: 1,
      createdAt: now(),
    };
    const { phases, criteria } = buildPhases(project.id, input.templateId, 1, template);
    d.projects.push(project);
    d.phases.push(...phases);
    d.criteria.push(...criteria);
    d.members.push({
      projectId: project.id,
      userId: input.leadId,
      projectRole: 'Delivery Lead',
      allocationPct: 50,
    });
    if (input.leadId !== s.user.id && s.user.role === 'delivery_lead')
      d.members.push({
        projectId: project.id,
        userId: s.user.id,
        projectRole: 'Delivery Lead',
        allocationPct: 0,
      });
    log(s, project.id, 'project.created', `Project ${key} created from template`);
    audit(s, 'project.create', 'project', project.id, undefined, project);
    return project;
  },

  async listItems(s, f) {
    const d = db();
    const allowed = new Set(visibleProjects(s).map((p) => p.id));
    if (f.projectId) {
      const p = requireProject(s, f.projectId);
      f = { ...f, projectId: p.id };
    }
    return applyFilters(
      d.items.filter((i) => allowed.has(i.projectId) && visibleItem(s, i)),
      f,
    ).sort((a, b) => a.position - b.position);
  },

  async getItem(s, key) {
    const d = db();
    const item = d.items.find((i) => i.key === key || i.id === key);
    if (!item || !visibleItem(s, item)) throw new NotFoundError('Item not found');
    requireProject(s, item.projectId);
    const linksRaw = d.links.filter((l) => l.fromId === item.id || l.toId === item.id);
    const links = linksRaw
      .map((l) => {
        const other = d.items.find((i) => i.id === (l.fromId === item.id ? l.toId : l.fromId));
        return other && visibleItem(s, other)
          ? { ...l, other: { id: other.id, key: other.key, title: other.title, status: other.status } }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    return {
      item,
      comments: d.comments
        .filter((c) => c.entityId === item.id && canSeeVisibility(s.user, c.visibility))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      activity: d.activity.filter((a) => a.itemId === item.id).sort((a, b) => b.at.localeCompare(a.at)),
      links,
      children: d.items.filter((c) => c.parentId === item.id && visibleItem(s, c)),
      parent: item.parentId
        ? (d.items.find((p) => p.id === item.parentId && visibleItem(s, p)) ?? null)
        : null,
    };
  },

  async createItem(s, input) {
    const project = requireProject(s, input.projectId);
    const clientRequest = isClientRole(s.user.role);
    if (!canEditItems(s.user) && !(clientRequest && s.user.role !== 'client_viewer'))
      throw new ForbiddenError('You cannot create items in this project.');
    if (!input.title.trim()) throw new ValidationError('Title is required.');
    checkAssignee(s, project, input.assigneeId);
    const d = db();
    const stored = d.projects.find((p) => p.id === project.id)!;
    const n = stored.nextItemNumber++;
    const t = now();
    const item: WorkItem = {
      id: newId('wi'),
      projectId: project.id,
      number: n,
      key: `${project.key}-${n}`,
      type: clientRequest ? 'client_request' : input.type,
      title: input.title.trim(),
      description: input.description ?? '',
      status: input.status ?? 'backlog',
      priority: input.priority ?? 'medium',
      assigneeId: input.assigneeId ?? null,
      reporterId: s.user.id,
      phaseId: input.phaseId ?? null,
      sprintId: input.sprintId ?? null,
      parentId: input.parentId ?? null,
      estimate: input.estimate ?? null,
      dueDate: input.dueDate ?? null,
      labels: input.labels ?? [],
      visibility: clientRequest ? 'shared' : (input.visibility ?? 'internal'),
      acceptanceCriteria: [],
      position:
        Math.max(0, ...d.items.filter((i) => i.projectId === project.id).map((i) => i.position)) + 1000,
      createdAt: t,
      updatedAt: t,
    };
    if (item.status === 'accepted') throw new ValidationError('New items cannot start as Accepted.');
    d.items.push(item);
    log(s, project.id, 'item.created', `${item.key} created`, item.id);
    onItemCreated(s, item);
    return item;
  },

  async updateItem(s, id, patch) {
    const d = db();
    const item = d.items.find((i) => i.id === id || i.key === id);
    if (!item || !visibleItem(s, item)) throw new NotFoundError('Item not found');
    const project = requireProject(s, item.projectId);
    const { offlineAcceptanceNote, ...fields } = patch;
    const onlyStatus = Object.keys(fields).every((k) => k === 'status' || k === 'position');
    if (!canEditItems(s.user) && !(isClientRole(s.user.role) && onlyStatus))
      throw new ForbiddenError('You cannot edit this item.');
    if (fields.status && fields.status !== item.status) {
      const r = canTransition(item.status, fields.status, { role: s.user.role, offlineAcceptanceNote });
      if (!r.ok) throw new ForbiddenError(r.reason);
    }
    if (fields.assigneeId && fields.assigneeId !== item.assigneeId)
      checkAssignee(s, project, fields.assigneeId);
    const before = { ...item };
    Object.assign(item, fields, { updatedAt: now() });
    if (fields.status && fields.status !== before.status) {
      // Team Pulse (AGL-01): keep status history for agile metrics.
      recordStatusChange(d, item, before.status, s.user.id, item.updatedAt);
      log(
        s,
        item.projectId,
        fields.status === 'accepted' ? 'item.accepted' : 'item.status',
        `${item.key} moved to ${STATUS_LABEL[fields.status]}${offlineAcceptanceNote ? ` (offline acceptance: ${offlineAcceptanceNote})` : ''}`,
        item.id,
      );
      if (fields.status === 'accepted')
        audit(s, 'acceptance.decide', 'work_item', item.id, before.status, 'accepted');
    } else {
      const changed = Object.keys(fields).filter((k) => k !== 'position');
      if (changed.length)
        log(s, item.projectId, 'item.updated', `${item.key}: ${changed.join(', ')} updated`, item.id);
    }
    if (fields.visibility && fields.visibility !== before.visibility)
      audit(s, 'visibility.change', 'work_item', item.id, before.visibility, fields.visibility);
    onItemUpdated(s, before, item);
    return item;
  },

  async bulkUpdate(s, ids, patch) {
    const out: WorkItem[] = [];
    for (const id of ids) out.push(await this.updateItem(s, id, patch));
    return out;
  },

  async addComment(s, { itemId, body, visibility }) {
    if (!canComment(s.user)) throw new ForbiddenError('Viewers cannot comment.');
    const d = db();
    const item = d.items.find((i) => i.id === itemId || i.key === itemId);
    if (!item || !visibleItem(s, item)) throw new NotFoundError('Item not found');
    requireProject(s, item.projectId);
    if (!body.trim()) throw new ValidationError('Comment cannot be empty.');
    const mentions = d.profiles.filter((p) => body.includes(`@${p.name.split(' ')[0]}`)).map((p) => p.id);
    const c: Comment = {
      id: newId('cm'),
      entityType: 'work_item',
      entityId: item.id,
      projectId: item.projectId,
      authorId: s.user.id,
      body: body.trim(),
      visibility: isClientRole(s.user.role) ? 'shared' : visibility,
      mentions,
      createdAt: now(),
    };
    d.comments.push(c);
    log(s, item.projectId, 'comment.added', `Comment on ${item.key}`, item.id);
    onCommentAdded(s, item, c);
    return c;
  },

  async listActivity(s, projectId, limit = 20) {
    const p = requireProject(s, projectId);
    const d = db();
    return d.activity
      .filter((a) => a.projectId === p.id)
      .filter((a) => {
        if (!isClientRole(s.user.role) || !a.itemId) return true;
        const it = d.items.find((i) => i.id === a.itemId);
        return it ? it.visibility === 'shared' : false;
      })
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
  },

  async search(s, q, f = {}) {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const d = db();
    const projects = visibleProjects(s);
    const byId = new Map(projects.map((p) => [p.id, p]));
    const out: SearchResult[] = [];
    for (const p of projects)
      if (p.name.toLowerCase().includes(term) || p.key.toLowerCase() === term)
        out.push({ kind: 'project', id: p.id, title: p.name, subtitle: p.key, href: `/projects/${p.key}` });
    const items = applyFilters(
      d.items.filter((i) => byId.has(i.projectId) && visibleItem(s, i)),
      { ...f, q: undefined },
    ).filter(
      (i) =>
        i.title.toLowerCase().includes(term) ||
        i.key.toLowerCase() === term ||
        i.description.toLowerCase().includes(term),
    );
    for (const i of items.slice(0, 50))
      out.push({
        kind: 'item',
        id: i.id,
        title: `${i.key} ${i.title}`,
        subtitle: `${STATUS_LABEL[i.status]} · ${byId.get(i.projectId)!.name}`,
        href: `/projects/${byId.get(i.projectId)!.key}/board?item=${i.key}`,
      });
    for (const c of d.comments
      .filter(
        (c) =>
          byId.has(c.projectId) &&
          canSeeVisibility(s.user, c.visibility) &&
          c.body.toLowerCase().includes(term),
      )
      .slice(0, 20)) {
      const it = d.items.find((i) => i.id === c.entityId);
      if (it && visibleItem(s, it))
        out.push({
          kind: 'comment',
          id: c.id,
          title: c.body.slice(0, 80),
          subtitle: `Comment on ${it.key}`,
          href: `/projects/${byId.get(c.projectId)!.key}/board?item=${it.key}`,
        });
    }
    return out;
  },

  async deleteDemoProject(s) {
    const d = db();
    const p = d.projects.find((x) => x.key === DEMO_PROJECT_KEY);
    if (!p) return;
    if (!canManageProject(s.user, p) && s.user.role !== 'admin')
      throw new ForbiddenError('Only Admins or the project Lead can delete the demo.');
    p.deletedAt = now();
    audit(s, 'project.soft_delete', 'project', p.id);
  },
};

export type { Db };
export { STATUS_LABEL };
export const _internal = { summarize };
export type { Comment };
