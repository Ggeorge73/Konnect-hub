export type OrgType = 'internal' | 'client';
export type Role =
  | 'admin'
  | 'delivery_lead'
  | 'team_member'
  | 'associate'
  | 'client_sponsor'
  | 'client_member'
  | 'client_viewer';
export type Visibility = 'internal' | 'shared';
export type Methodology = 'hybrid' | 'scrum' | 'kanban' | 'waterfall';
export type ContractType = 'fixed_fee' | 'time_materials' | 'retainer';
export type Rag = 'green' | 'amber' | 'red';
export type GateType = 1 | 2 | 3 | 4 | 5;
export type PhaseStatus =
  'not_started' | 'active' | 'ready_for_review' | 'approved' | 'approved_with_conditions' | 'rejected';
export type ItemType = 'epic' | 'feature' | 'story' | 'task' | 'bug' | 'change_request' | 'client_request';
export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type ItemStatus =
  'backlog' | 'ready' | 'in_progress' | 'in_review' | 'client_review' | 'done' | 'accepted';

export interface Organization {
  id: string;
  name: string;
  type: OrgType;
  logoUrl?: string;
}

export interface Profile {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: Role;
  mfaEnabled: boolean;
  usPerson: boolean;
  title?: string;
  skills?: string[];
  timezone?: string;
  hoursPerWeek?: number;
  /** Admin-only column. Never serialize to non-admins. */
  costRate?: number;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  clientOrgId: string;
  leadId: string;
  startDate: string;
  targetDate: string;
  methodology: Methodology;
  contractType: ContractType;
  /** Budget at completion. Internal only. */
  bac: number;
  description: string;
  status: 'active' | 'on_hold' | 'closed';
  restricted: boolean;
  rag: Rag;
  ragReason?: string;
  estimateUnit: 'points' | 'hours';
  templateId: string;
  nextItemNumber: number;
  createdAt: string;
  deletedAt?: string | null;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  projectRole: string;
  allocationPct: number;
}

export interface Phase {
  id: string;
  projectId: string;
  gate: GateType;
  name: string;
  status: PhaseStatus;
  startDate?: string;
  endDate?: string;
}

export interface GateCriterion {
  id: string;
  phaseId: string;
  text: string;
  done: boolean;
  doneBy?: string;
  doneAt?: string;
}

export interface Sprint {
  id: string;
  projectId: string;
  phaseId: string;
  name: string;
  startDate: string;
  endDate: string;
  goal: string;
  status: 'planned' | 'active' | 'completed';
  capacityHours?: number;
}

export interface AcceptanceCriterion {
  id: string;
  text: string;
  status: 'pending' | 'accepted' | 'rejected';
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

export interface WorkItem {
  id: string;
  projectId: string;
  number: number;
  key: string;
  type: ItemType;
  title: string;
  description: string;
  status: ItemStatus;
  priority: Priority;
  assigneeId?: string | null;
  reporterId: string;
  phaseId?: string | null;
  sprintId?: string | null;
  parentId?: string | null;
  estimate?: number | null;
  dueDate?: string | null;
  labels: string[];
  visibility: Visibility;
  acceptanceCriteria: AcceptanceCriterion[];
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ItemLink {
  id: string;
  fromId: string;
  toId: string;
  type: 'blocks' | 'relates' | 'duplicates';
}

export interface Comment {
  id: string;
  entityType: 'work_item' | 'raid' | 'deliverable' | 'gate_review';
  entityId: string;
  projectId: string;
  authorId: string;
  body: string;
  visibility: Visibility;
  mentions: string[];
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  projectId: string;
  itemId?: string;
  actorId: string;
  action: string;
  detail: string;
  at: string;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  at: string;
}

export interface Session {
  user: Profile;
  org: Organization;
}

/**
 * KH-47 "View as client" preview. Set on the Session while an Admin previews the portal as a
 * client role and org; `user`/`org` are then the previewed client, and every write is refused.
 */
export interface Impersonation {
  adminId: string;
  adminName: string;
  role: Role;
  orgId: string;
  orgName: string;
  /** The representative client profile the preview renders as. */
  asUserId: string;
  asUserName: string;
  startedAt: string;
  readOnly: true;
}

// Declaration merge (append-only edit): the optional preview marker on Session.
export interface Session {
  impersonation?: Impersonation;
}
