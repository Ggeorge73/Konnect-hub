# Build Prompt: Konnect Hub — Konnector's Project Delivery Platform

> **How to use:** create an empty folder (or GitHub repo, e.g. `konnect-hub`), save this file in it as `CLAUDE.md`, open Claude Code there, and build **one phase at a time** (Section 9). After each phase: run it, review it, then ask for the next phase.

---

## 1. Project Overview

**Konnect Hub** is Konnector LLC's own project delivery management platform: a board-based work tracker like Jira or Azure DevOps, rebuilt around how Konnector actually delivers. The name is a working title and should live in one config value.

Konnector LLC (Atlanta, Georgia) is a technology delivery partner. It plans, supplies, delivers and sustains technology for government agencies and growing organizations: **on time, on budget, and accepted**. Every engagement runs on the **Konnect Delivery Framework**: five gates (Mobilize → Plan → Execute → Accept → Transition) with Agile sprints running *inside* each phase, and a client sign-off at every gate.

**Analogy for the builder:** Jira is a workshop full of tools; Konnect Hub is a construction site office. It has the work board on the wall, and it also has the inspection checklist, the client's sign-off sheet, the risk register and the budget tracker in one room, where the client can walk in and see progress.

**What makes it different from Jira / Azure DevOps (build these as first-class features, not add-ons):**

1. **Gates are built in.** The five Konnect gates are part of every project, with exit criteria and in-app client sign-off.
2. **"Accepted" is a status, not a feeling.** Every deliverable carries acceptance criteria, and only the client can mark it Accepted.
3. **Clients work in the same tool.** A scoped client portal shows curated progress, approvals and comments. Internal notes stay internal.
4. **Governance in the box.** It includes a RAID log (5×5 risk matrix, ROAM status, aging alerts), an executive one-page dashboard (RAG, milestones, top 3 risks, budget burn, next 30 days) and earned value (SPI/CPI/EAC).
5. **Hybrid by design.** Sprints and Kanban boards live inside gated phases, so Agile and Waterfall work share one RAID log and one dashboard.
6. **Bench-aware capacity.** It shows which internal staff and associates are allocated where, with a warning above 80% load.

**What it replaces:** spreadsheets, email approvals, separate status decks, and paid Jira and Smartsheet seats.

**Scale assumptions (design for these, test at 2×):**
- 10–40 internal users (staff and associate contractors); 5–25 client organizations; 3–15 users per client
- Up to 60 active projects; up to 10,000 work items per project; 200,000 work items in total
- Up to 150 concurrent users; boards with 500 visible cards must stay smooth

**Core domain logic:** Portfolio → Client → Project → Phase (one of the 5 gates) → Sprint (optional) → Work Item (Epic → Feature → Story/Task/Bug) → Deliverable (bundles items + acceptance criteria) → Gate Review (client sign-off).

---

## 2. User Roles & Access (RBAC + tenant isolation)

| # | Role | Org | Can do | Cannot do |
|---|---|---|---|---|
| 1 | **Konnector Admin** | Konnector | Everything: workspace settings, users, clients, templates, billing fields, audit log | — |
| 2 | **Delivery Lead** | Konnector | Create and run projects they lead; manage boards, sprints, RAID, budget, gates; invite client users to their projects | Change workspace settings; see projects they aren't on (unless Admin) |
| 3 | **Team Member** | Konnector | Work on assigned projects: items, comments, time, RAID entries | Edit budget or gates; invite clients |
| 4 | **Associate** (contractor) | Konnector | Same as Team Member, **only** on projects explicitly assigned | See rates, budget, or other projects; see the client list |
| 5 | **Client Sponsor** | Client | See their organization's projects in the portal; **approve or reject gates and deliverables**; comment; view dashboards | See internal-only items, internal comments, rates or costs (unless the Lead shares a budget view) |
| 6 | **Client Member** | Client | View shared items; comment; accept deliverables assigned to them; create requests | Approve gates |
| 7 | **Client Viewer** | Client | Read-only portal access | Comment or approve |

Rules:
- **Tenant isolation is mandatory.** A client user must never see another client's data. Enforce it in the database (Postgres Row Level Security), not just in the UI.
- Every work item, comment, file and RAID entry has a **visibility** flag: `internal` (default for Konnector-created) or `shared` (visible in the client portal). Show a clear lock icon or "Internal" chip.
- Budget, rates and cost fields are internal-only by default.
- Admins can impersonate a role in "View as client" preview mode, which is read-only and logged.

---

## 3. Core Features

### 3.1 Workspace, clients and projects
- Portfolio home: all projects as cards or a table showing client, lead, current gate, RAG status, % complete, next milestone, budget burn, and open critical risks.
- Create a project from a **template** (default: "Konnect Delivery Framework — Hybrid"; also "Kanban Support Retainer" and "Advisory Engagement"). The template seeds the five phases, gate exit criteria, default columns and RAID categories.
- Project fields: name, key (e.g. `ACME`), client org, delivery lead, start and target dates, methodology (Hybrid / Scrum / Kanban / Waterfall), contract type (Fixed-fee milestones / Time & Materials / Retainer), budget (BAC), and description.
- A project overview tab shows the gate tracker strip across the top (5 steps; current one highlighted), key metrics, recent activity and upcoming milestones.

### 3.2 Work items (the engine)
- Types: **Epic, Feature, Story, Task, Bug, Change Request, Client Request**, each with its own icon and colour.
- Fields: key (`ACME-142`), title, rich-text description (Tiptap), type, status, priority (Critical/High/Medium/Low), assignee, reporter, phase, sprint, estimate (story points or hours, chosen per project), due date, labels, parent/child links, "blocks / blocked by" links, attachments, visibility, and acceptance criteria (checklist).
- Status workflow is configurable per project. Default: **Backlog → Ready → In Progress → In Review → Client Review → Done → Accepted**. The **Accepted** state can only be set by a client user or by a Lead recording a logged offline acceptance.
- Item detail opens as a side panel (deep-linkable URL) with comments (@mentions, internal or shared toggle), activity history, linked items, time logged and attachments.
- Bulk edit (status, assignee, sprint, labels); keyboard shortcuts (`c` create, `/` search, `j/k` navigate, `e` edit); quick-add inline on boards.

### 3.3 Boards and views
- **Kanban board:** drag and drop (dnd-kit), swimlanes (by assignee, epic, priority, or none), WIP limits per column (column header turns amber when exceeded), quick filters, and card density toggle.
- **Sprint board and backlog:** create sprints within a phase, drag items from backlog into sprints, capacity bar per sprint (planned vs. available hours), start and complete sprint (moves unfinished items forward).
- **List or table view:** sortable, groupable, column chooser, inline edit, saved views.
- **Timeline (Gantt-style):** phases as bands, gates as diamonds, epics and milestones as bars, dependency arrows, a "today" line, and drag to reschedule. Critical-path highlight is Phase 3.
- **Search:** global search (`/`) across items, projects and comments, with filters (type, status, assignee, label, phase, sprint, visibility, updated date). Saved filters are shareable.

### 3.4 Konnect Delivery Framework: gates and acceptance (signature feature)
- Every project has 5 phases: **Mobilize, Plan, Execute, Accept, Transition**. Each has editable **exit criteria** (checklist) seeded from the template:
  - Mobilize: charter and acceptance criteria approved
  - Plan: baseline schedule and budget approved
  - Execute: each increment demonstrated and accepted
  - Accept: UAT passed; go-live readiness signed
  - Transition: stabilization targets met; handover signed
- **Gate review flow:** the Lead marks the phase "Ready for gate review". The system checks exit criteria (blocking any unchecked item, unless the Lead adds an override note) and assembles a **Gate Pack** (summary, completed criteria, linked deliverables, open risks, budget status). The Client Sponsor is notified, then **Approves**, **Approves with conditions** (conditions become tracked items) or **Rejects** (with reasons). The decision is time-stamped, name-stamped and stored in the audit log, and the next phase unlocks.
- **Deliverables:** a named bundle of work items plus acceptance criteria, an owner and a due date. A client reviewer accepts or rejects each criterion, and the deliverable becomes Accepted when all criteria pass. A rejection reopens the linked items automatically.
- Gate history is exportable as a PDF "Acceptance Record" with Konnector branding.

### 3.5 RAID log (Risks, Assumptions, Issues, Dependencies)
- One RAID register per project, with tabs for Risks | Assumptions | Issues | Dependencies | Decisions.
- **Risks:** category (Schedule, Cost, Resource, Technical, Vendor, Regulatory, Reputational), probability (1–5), impact (1–5), score, owner, mitigation plan, residual score, status, and ROAM (Resolved, Owned, Accepted, Mitigated). An interactive **5×5 heat map** links to filtered lists.
- **Issues:** severity, owner, SLA (Critical 48 hours, Major 5 business days), and aging. Any issue open more than 10 days with no update is flagged and escalated by notification to the Lead and Admin.
- **Rules:** a risk scoring 15 or higher (P×I) auto-flags as "Escalate to steering". A risk cannot be closed without a closure note.
- RAID items can link to work items. RAID items are internal by default but can be shared with the client individually.

### 3.6 Dashboards and reporting
- **Project executive one-pager:** RAG status (auto-suggested from rules and overridable with a reason), key milestones, top 3 risks, budget burn (planned vs. actual), SPI and CPI, gate progress, and next-30-days actions. It is printable and exports to PDF.
- **Earned value:** BAC, PV, EV, AC, SPI, CPI, EAC = AC + (BAC − EV)/CPI, and VAC. EV is computed from % complete of weighted deliverables or milestones. Show warnings when SPI < 0.85 or CPI < 0.9.
- **Agile metrics:** velocity (last 6 sprints), sprint burndown, cumulative flow, cycle time, and throughput.
- **Portfolio dashboard (internal only):** all projects with RAG, gate, budget variance, critical risks and lead; filter by client, lead and status.
- **Weekly status report:** a generated draft (scope, schedule, budget, risks, decisions needed, next steps) that the Lead edits and then publishes to the client portal and email.
- Charts use Recharts, styled to the theme, with values on hover and colour-blind-safe palettes.

### 3.7 Client portal
- Same app, separate scoped experience at `/portal`, with Konnector branding plus the client's logo.
- Shows: projects, gate tracker, shared items (read and comment), deliverables awaiting acceptance (prominent "Needs your approval" inbox), published status reports, shared RAID items, milestones timeline, and a "Submit a request" form that creates a Client Request item.
- Never shows internal items, internal comments, costs (unless shared), associates' rates, or other clients.

### 3.8 Resource and bench capacity
- People directory: internal staff and associates with role, skills (tags), certifications, location/time zone, availability (hours per week), and "U.S. person" flag (for restricted work).
- Allocation grid: person × week with project allocation hours; turns amber above 80% and red above 100% of capacity.
- Project staffing: assign people to a project with a role and allocation percentage.
- Projects marked **Restricted** (e.g. defense/export-controlled) only allow people flagged as U.S. persons. Enforce this at assignment.

### 3.9 Time tracking (for T&M and EVM actual cost)
- Log time on work items (hours, date, note, billable flag); weekly timesheet view; Lead approval.
- Internal cost rate per person (Admin-only) feeds Actual Cost (AC). Export approved time to CSV for invoicing.

### 3.10 Notifications and collaboration
- In-app notification center plus email (Resend). Notification events include mentions, assignments, status changes on watched items, gate approvals requested or decided, deliverables awaiting acceptance, SLA breaches, and risks escalated.
- Per-user preferences per event type (in-app / email / daily digest / off).
- Real-time updates on boards and item panels (another user's move appears without refresh), with presence avatars on an open item.

### 3.11 Admin, audit and data
- Admin console: users, roles, client orgs, invites (magic link), project templates, workflow and status configuration, custom fields (text, number, date, select), and branding.
- **Audit log** (append-only): logins, permission changes, gate decisions, acceptance decisions, visibility changes, exports, and deletions — who, what, when, and from where.
- **Exports:** CSV/Excel for any list view; PDF for dashboards, status reports, and acceptance records; full project JSON export.
- Soft delete with 30-day restore; Admin hard delete only.

### 3.12 Onboarding and empty states
- First-run wizard: set workspace name and logo → create first client → create first project from template → invite team.
- Every empty view has a helpful empty state with one clear next action (e.g. empty RAID: "No risks logged yet. Projects that log risks early recover faster. Add the first risk").
- A seeded **demo project** ("Demo — Clinic EHR Go-Live") with sample items, sprints, risks and a passed gate, which can be deleted with one click.

### 3.13 AI assist (Phase 5)
- Using the Claude API (Anthropic): draft the weekly status report from the week's activity; suggest risks from stalled items and slipping dates; summarize a long comment thread; turn meeting notes into work items (with a preview before creating).
- AI never writes directly. Every suggestion is a draft a human accepts. AI is off by default per project and never sends internal-only data to client-visible outputs.

---

## 4. Technical Requirements

### Architecture
- **Frontend:** Next.js (App Router) + TypeScript + **MUI v6** with a custom theme (Section 8), dnd-kit (drag and drop), Tiptap (rich text), Recharts (charts), TanStack Query (server state), and react-hook-form + zod (forms).
- **Backend and data:** **Supabase**, providing Postgres, Auth, Row Level Security, Realtime and Storage. This keeps tenant isolation in the database and gives real-time boards without a separate socket server. Use Next.js server actions and route handlers for business logic; use Postgres functions for gate and acceptance transitions so rules can't be bypassed.
- **Migrations:** SQL migrations in `/supabase/migrations`; seed script for the demo project.
- **Deployment:** Vercel (app) + Supabase (managed), with separate dev and production projects. Environment variables are documented in `.env.example`.

### Integrations
- **Email:** Resend (transactional + daily digest), using a Konnector sending domain (`konnectortech.com`).
- **Auth:** Supabase Auth with email magic link and password; **MFA (TOTP) required for all Konnector users**, optional for clients. Google and Microsoft OAuth are in Phase 4. SAML SSO is V2.
- **Files:** Supabase Storage, with a private bucket per client organization, signed URLs, a 25 MB per-file limit and a virus-scan hook placeholder.
- **AI:** Anthropic Claude API (Phase 5), with the key held server-side only.
- **Calendar:** ICS feed of milestones and gate reviews per project (Phase 3).
- **Error and uptime monitoring:** Sentry; Vercel Analytics.

### Security & Compliance
- RLS policies on **every** table, with automated tests proving that a client user of Org A gets zero rows from Org B.
- Encryption in transit (HTTPS/HSTS) and at rest (Supabase default).
- Session timeout: 12 hours for internal users, 7 days for clients with re-auth for approvals. **Gate and acceptance approvals require a fresh re-auth (within 15 minutes)** and record name, timestamp and IP, which makes the sign-off defensible.
- **No PHI in V1:** show a banner at project creation for healthcare clients stating "Do not store patient data in Konnect Hub". HIPAA readiness (signed BAA with Supabase on an eligible plan, access logging) is a later decision.
- Restricted projects: U.S.-person assignment rule (Section 3.8) as a basic export-control guard.
- Accessibility: WCAG 2.1 AA, full keyboard support for boards (move a card with keyboard), visible focus, 4.5:1 contrast in both themes, and reduced-motion support.
- Rate limiting on auth and public endpoints; security headers (CSP, HSTS, X-Frame-Options).
- Backups: Supabase daily backups with point-in-time recovery on production; documented restore steps in `/docs/runbook.md`.

### Performance Targets
- Portfolio page with 60 projects: under 1.5 seconds to interactive.
- Board with 500 cards: initial render under 2 seconds; drag-and-drop at 60 fps (virtualize long columns).
- Item side panel opens in under 300 ms (prefetch on hover).
- Real-time update appears for other users within 2 seconds.
- Search returns in under 500 ms on 200,000 items (Postgres full-text search with indexes).

---

## 5. Data Model (Key Entities)

- `organizations` (Konnector + each client; type: internal | client)
- `profiles` (user, org, role, MFA status, U.S.-person flag, cost rate — Admin-only column)
- `projects` (org/client, key, lead, methodology, contract type, BAC, dates, status, restricted flag, rag + rag_reason)
- `project_members` (project, user, project role, allocation %)
- `phases` (project, gate type 1–5, status: not_started | active | ready_for_review | approved | approved_with_conditions | rejected, dates)
- `gate_criteria` (phase, text, done, done_by, done_at)
- `gate_reviews` (phase, requested_by, decided_by, decision, conditions, reason, decided_at, ip)
- `sprints` (project, phase, name, start, end, goal, status)
- `work_items` (project, key number, type, title, description, status, priority, assignee, reporter, phase, sprint, parent, estimate, due, visibility, position for ordering, search vector)
- `item_links` (from, to, type: blocks | relates | duplicates)
- `acceptance_criteria` (item or deliverable, text, status: pending | accepted | rejected, decided_by, decided_at, note)
- `deliverables` (project, phase, name, owner, due, status) + `deliverable_items`
- `raid_entries` (project, kind: risk | assumption | issue | dependency | decision, fields per kind, probability, impact, score, roam, owner, sla_due, visibility, status, closure_note)
- `comments` (entity, author, body, visibility, mentions)
- `attachments` (entity, storage path, size, uploaded_by, visibility)
- `time_entries` (item, user, date, hours, billable, approved_by)
- `allocations` (user, project, week, hours)
- `status_reports` (project, period, content JSON, status: draft | published, published_at)
- `notifications` + `notification_prefs`
- `audit_log` (actor, action, entity, before/after JSON, ip, at) — insert-only
- `templates`, `workflows` (statuses + allowed transitions), `custom_fields`, `custom_field_values`, `saved_views`

---

## 6. Success Criteria

- A Delivery Lead can create a project from the template and have the 5 phases, criteria and board ready in **under 2 minutes**.
- A Client Sponsor can find and approve a pending gate from their email notification in **3 clicks or fewer**.
- Automated tests prove **zero cross-tenant data leakage** across all tables (RLS test suite passes in CI).
- Internal-only items never appear in any portal view, export or notification to client users (covered by tests).
- Performance targets in Section 4 are met with the seeded 10,000-item load-test dataset.
- axe-core reports zero serious or critical accessibility issues on the main screens in both themes.
- EVM figures match a hand-calculated test case to the cent.
- Within 60 days of launch, Konnector runs **100% of active engagements** in Konnect Hub, with no separate status decks.

---

## 7. Repository Conventions

- `app/` (routes: `(internal)` and `portal`), `components/`, `features/` (one folder per domain: boards, gates, raid, dashboards…), `lib/` (supabase clients, permissions, evm math), `supabase/` (migrations, seed, RLS tests), `docs/`.
- Strict TypeScript; ESLint + Prettier; Vitest for unit tests (EVM math, permission helpers, workflow rules); Playwright for end-to-end tests (create project → move card → request gate → client approves).
- GitHub Actions CI runs lint, typecheck, unit tests, RLS tests and the Playwright smoke test on every pull request.
- Conventional commits; a short `README.md` covering setup, environment variables, seeding, and how to add a project template.

---

## 8. Design System — "Konnector Glass"

The look is a **dark, glassmorphic navy control room** (inspired by Vision UI Dashboard PRO's style), carrying Konnector's navy and teal brand. It should feel premium and calm, never noisy. A light theme is also required for client users and printing.

| Token | Dark (default internal) | Light (default portal) |
|---|---|---|
| Background | Deep navy gradient `#060B1F` → `#0B1F3A` | `#F5F7FA` |
| Glass surface | `rgba(17, 28, 68, 0.72)` + `backdrop-filter: blur(18px)` + 1px border `rgba(255,255,255,0.08)` | `#FFFFFF` + border `#E2E8F0` |
| Primary accent (teal) | `#14B8A6` | `#0F9488` |
| Secondary accent | Electric blue `#3B82F6` (links, focus) | `#2563EB` |
| Text | `#F8FAFC` / muted `#A0AEC0` | `#0F172A` / muted `#475569` |
| RAG status | Green `#22C55E`, Amber `#F59E0B`, Red `#EF4444` — always paired with a text label or icon, never colour alone | same |
| Radius | 16px cards, 12px inputs, 8px chips | same |
| Font | Inter (UI), JetBrains Mono (item keys, numbers in tables) | same |

Layout and signature details:
- **Floating glass sidenav** (collapsible to icons): Portfolio, My Work, Projects, Boards, Timeline, RAID, Dashboards, People, Reports, Admin. The project switcher sits at the top and the user/org at the bottom.
- **Top bar:** breadcrumbs, global search (`/`), quick-create button, notifications bell, theme toggle, avatar.
- **Gate tracker strip:** five connected nodes with the current gate glowing teal and passed gates showing check marks. It appears on every project page and is the visual signature of the product.
- **Portfolio home hero:** a subtle **slow-spinning dot-matrix globe** (Three.js or a lightweight canvas, under 60 KB, paused when `prefers-reduced-motion` is set) behind the key metric cards, nodding to Konnector's global delivery reach.
- Cards: glass panels with soft inner glow on hover; type icon, key, title, assignee avatar, priority marker, points, and an "Internal" lock chip when relevant.
- Motion: 150–200 ms ease-out transitions; card lift on drag; no bouncing.
- Fully responsive. Board and item views work on tablet. On phones, My Work, the item panel, approvals and the notifications inbox must be fully usable; full board editing is desktop-first.
- Empty states use simple line illustrations in the accent colours.

---

## 9. Build Sequence (do one phase per session; stop and summarize at the end of each)

- **Phase 1 — Foundation and boards (MVP):** Supabase setup, auth with MFA for internal users, organizations and roles, RLS with tests, theme and layout shell, projects (from the hybrid template), work items, Kanban board with drag and drop, list view, item side panel, comments with internal/shared visibility, global search, and the demo seed.
- **Phase 2 — Konnect Delivery Framework:** phases and gate criteria, gate review and client approval flow (with re-auth), deliverables and acceptance criteria, sprints and backlog, timeline view, and the RAID log with 5×5 heat map and SLA aging.
- **Phase 3 — Visibility:** executive one-pager, EVM, Agile metrics, portfolio dashboard, weekly status report (manual draft), PDF exports, email notifications and preferences, real-time updates and presence, and ICS calendar feeds.
- **Phase 4 — Clients and capacity:** client portal polish (approval inbox, request form, branding), people directory, allocation grid, restricted-project rule, time tracking and timesheets, audit log viewer, CSV/Excel exports, Google and Microsoft sign-in, and the onboarding wizard.
- **Phase 5 — Intelligence and hardening:** Claude-powered status report drafts, risk suggestions, notes-to-items, critical path on the timeline, load testing at 2× scale, a security review, and documentation.

---

## 10. Out of Scope (V1)

- Native mobile apps (responsive web only)
- Invoicing and payments (time export to CSV only)
- SAML SSO and SCIM provisioning
- Git, CI or code-repository integrations (GitHub links can be pasted into items)
- Built-in chat or video (comments and notifications only)
- Storing PHI, classified, or CUI data
- Multi-language support
- Public API and webhooks (V2)
