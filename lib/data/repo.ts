import type {
  ActivityEvent,
  Comment,
  ContractType,
  GateCriterion,
  ItemLink,
  ItemStatus,
  ItemType,
  Methodology,
  Organization,
  Phase,
  Priority,
  Profile,
  Project,
  ProjectMember,
  Session,
  Sprint,
  Visibility,
  WorkItem,
} from '../domain/types';

export interface ProjectSummary extends Project {
  clientName: string;
  leadName: string;
  currentGate: number;
  currentGateName: string;
  percentComplete: number;
  openCritical: number;
  itemCount: number;
  nextMilestone?: { name: string; date: string };
  budgetBurnPct?: number;
}

export interface ProjectBundle {
  project: Project;
  client: Organization;
  phases: Phase[];
  criteria: GateCriterion[];
  sprints: Sprint[];
  members: ProjectMember[];
  people: Profile[];
}

export interface ItemFilters {
  projectId?: string;
  type?: ItemType[];
  status?: ItemStatus[];
  assigneeId?: string[];
  label?: string[];
  phaseId?: string;
  sprintId?: string | null;
  visibility?: Visibility;
  q?: string;
  updatedSince?: string;
}

export interface CreateProjectInput {
  name: string;
  key: string;
  clientOrgId: string;
  leadId: string;
  startDate: string;
  targetDate: string;
  methodology: Methodology;
  contractType: ContractType;
  bac: number;
  description: string;
  templateId: string;
  restricted?: boolean;
}

export interface CreateItemInput {
  projectId: string;
  type: ItemType;
  title: string;
  description?: string;
  status?: ItemStatus;
  priority?: Priority;
  assigneeId?: string | null;
  phaseId?: string | null;
  sprintId?: string | null;
  parentId?: string | null;
  estimate?: number | null;
  dueDate?: string | null;
  labels?: string[];
  visibility?: Visibility;
}

export type ItemPatch = Partial<
  Pick<
    WorkItem,
    | 'title'
    | 'description'
    | 'type'
    | 'status'
    | 'priority'
    | 'assigneeId'
    | 'phaseId'
    | 'sprintId'
    | 'parentId'
    | 'estimate'
    | 'dueDate'
    | 'labels'
    | 'visibility'
    | 'position'
    | 'acceptanceCriteria'
  >
> & { offlineAcceptanceNote?: string };

export interface SearchResult {
  kind: 'item' | 'project' | 'comment';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export interface ItemDetail {
  item: WorkItem;
  comments: Comment[];
  activity: ActivityEvent[];
  links: (ItemLink & { other: Pick<WorkItem, 'id' | 'key' | 'title' | 'status'> })[];
  children: WorkItem[];
  parent?: WorkItem | null;
}

/** Every data access goes through this interface so the Supabase adapter and demo store stay swappable. */
export interface Repo {
  listOrgs(s: Session): Promise<Organization[]>;
  listPeople(s: Session): Promise<Profile[]>;
  listProjects(s: Session): Promise<ProjectSummary[]>;
  getProjectBundle(s: Session, key: string): Promise<ProjectBundle>;
  createProject(s: Session, input: CreateProjectInput): Promise<Project>;
  listItems(s: Session, f: ItemFilters): Promise<WorkItem[]>;
  getItem(s: Session, key: string): Promise<ItemDetail>;
  createItem(s: Session, input: CreateItemInput): Promise<WorkItem>;
  updateItem(s: Session, id: string, patch: ItemPatch): Promise<WorkItem>;
  bulkUpdate(s: Session, ids: string[], patch: ItemPatch): Promise<WorkItem[]>;
  addComment(s: Session, input: { itemId: string; body: string; visibility: Visibility }): Promise<Comment>;
  listActivity(s: Session, projectId: string, limit?: number): Promise<ActivityEvent[]>;
  search(s: Session, q: string, f?: ItemFilters): Promise<SearchResult[]>;
  deleteDemoProject(s: Session): Promise<void>;
}
