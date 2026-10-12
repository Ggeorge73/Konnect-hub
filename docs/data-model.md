# Data model and access rules

Schema: `supabase/migrations/0001_core.sql`. Demo data: `supabase/seed.sql`. Tests: `supabase/tests/run-rls-tests.sh`.

## Entities

| Area          | Tables                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| People        | `organizations` (internal or client), `profiles` (one per `auth.users` row: org, role, MFA, US-person), `profile_rates` (cost rate, admin only)                                                  |
| Projects      | `projects` (key, client org, lead, methodology, contract, RAG, restricted, template, `next_item_number`, soft delete), `project_financials` (BAC, admin and lead only), `project_members`        |
| Governance    | `phases` (gates 1 to 5), `gate_criteria`, `gate_reviews` (decision, conditions, reason, decided by/at, IP), `deliverables`, `deliverable_items`                                                  |
| Delivery      | `sprints`, `work_items` (key such as `EHR-7`, type, status, priority, visibility, `position`, labels, full-text `search_vector`), `acceptance_criteria`, `item_links`, `comments`, `attachments` |
| RAID and time | `raid_entries` (score is probability times impact; `escalate` when 15 or more), `time_entries`, `allocations`, `status_reports`                                                                  |
| Feeds         | `notifications`, `notification_prefs`, `activity` (project feed), `audit_log` (append-only)                                                                                                      |

Every project-scoped table has its own `project_id` column. Composite foreign keys keep it consistent with the parent row, so RLS can filter on `project_id` directly without joins.

## Who sees what (RLS)

Every table in `public` has RLS enabled. `anon` has no table access. The rules mirror `lib/domain/permissions.ts`.

| Role           | Projects                                               | Internal rows* | Budget (`project_financials`) | Cost rates | Writes                                                                   |
| -------------- | ------------------------------------------------------ | -------------- | ----------------------------- | ---------- | ------------------------------------------------------------------------ |
| admin          | all, including soft-deleted                            | yes            | all                           | yes        | everything                                                               |
| delivery_lead  | projects they lead, plus projects they are a member of | yes            | projects they can see         | no         | items, sprints, RAID; manages own projects (phases, members, financials) |
| team_member    | assigned projects                                      | yes            | no                            | no         | items, sprints, RAID, own time                                           |
| associate      | assigned projects                                      | yes            | no                            | no         | as team_member                                                           |
| client_sponsor | every project of their org                             | no             | no                            | no         | shared comments, accept work, gate decisions                             |
| client_member  | every project of their org                             | no             | no                            | no         | shared comments, accept work                                             |
| client_viewer  | every project of their org                             | no             | no                            | no         | none (read-only)                                                         |

\* Internal rows are rows with `visibility = 'internal'` in work_items, comments, attachments, raid_entries, deliverables, status_reports and activity. Clients also don't see time entries, allocations or the audit log. A shared comment or attachment stays hidden if its parent item is internal.

Restricted projects are hidden from internal users who are not US persons, even if they are members. Clients see only projects of their own org.

## Rules enforced in the database

- **Accepted status.** Use `transition_work_item(item_id, to_status, offline_note default null)`. Client sponsors and members can accept. A lead or admin can accept only with a non-empty offline note, which is written to `audit_log` as `item.offline_acceptance`. Client viewers can never move items. A trigger rejects any direct `INSERT` or `UPDATE` that sets `accepted`.
- **Item keys.** Insert work items without `number` or `key`. A trigger takes the next `projects.next_item_number` atomically and sets `key`. Both are immutable afterwards.
- **New projects.** Use `create_project_from_template(key, name, client_org_id, lead_id, template_id, methodology, contract_type, bac, ...)`. It creates the project, its financials, the lead's membership, 5 phases and the template's gate criteria.
- **Client requests.** Clients can't insert `work_items` directly. Client sponsors and members call `create_client_request(project_id, title, description, priority)` (`0004_client_request_rpc.sql`), which always creates a shared `client_request` in the backlog.
- **RAID.** A risk can't be closed without a `closure_note`.
- **Audit log.** `audit_log` rejects `UPDATE`, `DELETE` and `TRUNCATE`, even from the table owner.
- **Profiles.** Users can edit their own profile but cannot change their role, org, email, US-person flag or MFA flag.
- **Gate reviews.** Only a client sponsor can insert a gate review. A rejection needs a reason, and an approval with conditions needs the conditions.
- **Re-auth.** `decide_gate` and `decide_deliverable_criterion` need a `reauth_events` row from the last 15 minutes. Only the server writes one, with `record_reauth(user_id, at)` (`0009_shield_reauth_mfa.sql`): it is not executable by `anon` or `authenticated`, and the app calls it as its own login role at the start of the decision transaction, after verifying the signed re-auth cookie.
- **MFA flag.** After a TOTP verify, `mark_mfa_enabled()` sets the caller's own `profiles.mfa_enabled`. It needs an `aal2` JWT and never touches another row; direct updates of the flag stay blocked.

## Data path

`getRepo()` and the domain stores (`raidStore()`, `sprintStore()`, `gateStore()`, `deliverableStore()`, `acceptanceRecordStore()`) all pick Postgres + RLS when `DATABASE_URL` is set and either `KH_DATA=postgres` or Supabase is configured, otherwise the in-memory demo store. Each Postgres call runs in one transaction that sets `role authenticated`, then the JWT claims. The contract suites in `lib/data/contract*.ts` run against both stores.

Helper functions available to policies and the app: `current_profile_role()`, `current_org_id()`, `is_admin()`, `is_internal()`, `is_client()`, `can_see_project(id)`, `visible_project_ids()`, `can_manage_project(id)`, `can_see_financials(id)`.
