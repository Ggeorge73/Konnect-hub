# Konnect Hub user guide

One page per role. Find yours:

- Konnector staff: [Konnector Admin](#konnector-admin) · [Delivery Lead](#delivery-lead) · [Team Member](#team-member) · [Associate](#associate)
- Client users: [Client Sponsor](#client-sponsor) · [Client Member](#client-member) · [Client Viewer](#client-viewer)

Two ideas apply to everyone:

- **Internal or shared.** Every item, comment, file and RAID entry is either **Internal** (lock chip: Konnector only) or **Shared** (visible in the client portal). New Konnector content is internal until you share it.
- **Accepted means the client accepted it.** Only a client user moves work to Accepted. A Lead can record an offline acceptance, with a note that goes to the audit log.

---

## Konnector Admin

You run the workspace. Everything you change in the Admin console is recorded in the audit log with your name, the time and your IP address.

**Sign in.** Use your email link or password, then your authenticator app code (MFA is required for all Konnector staff).

**Admin console (`/admin`).**

| Card                      | What you do there                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branding and setup        | Re-run the setup wizard to change the workspace name and logo, add a client or invite people.                                                                                                                                                                                                                                                                                  |
| Users                     | Switch between Konnector staff and client users. Change a role from the Role menu (Konnector users can only hold Konnector roles, client users client roles). **Deactivate** someone who left: they can no longer sign in, and their history stays. **Re-send invite** emails a fresh sign-in link. You cannot change your own role or deactivate yourself; ask another Admin. |
| Pending invites → Invites | Paste one or more emails, pick the organization and the role, and press **Send invites**. Each person gets a magic link; their account is created with that role. Re-send or revoke from the list.                                                                                                                                                                             |
| Client organizations      | Add a client, rename it, upload its logo (PNG, JPG, GIF or WebP, up to 2 MB). The logo appears in that client's portal.                                                                                                                                                                                                                                                        |
| Project templates         | The three built-in templates are read-only. **Create from this** copies a template so you can edit each gate's exit criteria and the RAID categories. New templates appear in the New project dialog at once. Archive a template you no longer want; projects that used it are unaffected.                                                                                     |
| Workflows                 | Pick a project, rename its board columns and set WIP limits (a column turns amber on the board when it has more cards than its limit). The seven statuses stay in their order, and **Accepted** cannot be renamed or limited, because only the client sets it.                                                                                                                 |
| Custom fields             | Add text, number, date or select fields. They appear on every work item and as optional columns in the list view. **Shared** fields show to clients on shared items; **Internal** ones never leave Konnector. Archive instead of deleting.                                                                                                                                     |
| Audit log                 | Filter by person, action and date; open **Changes** to see before and after.                                                                                                                                                                                                                                                                                                   |
| Demo project              | Delete the sample "Demo — Clinic EHR Go-Live" project when your team is ready.                                                                                                                                                                                                                                                                                                 |

**Also yours:** cost rates in the People directory, every project's budget, and "View as client" previews.

---

## Delivery Lead

You run the projects you lead.

1. **Create a project** (Portfolio → **New project**): name, key (e.g. `ACME`), client, template, dates, methodology, contract type and budget. The five gates and their exit criteria are created for you. Healthcare clients see a "Do not store patient data" banner.
2. **Plan the work** on the Board, List, Backlog and Timeline tabs. Create items with **c**, search with **/**, move cards with the mouse or the keyboard (Space to pick up, arrows to move, Space to drop).
3. **Fill in custom fields** in the item panel (Custom fields section) when your workspace uses them.
4. **Share deliberately.** Switch an item, comment or file to **Shared** only when the client should see it. Files on an internal comment always stay internal.
5. **Attach files** in the item panel (**Attach file**, up to 25 MB: PDF, images, text, CSV or Office files) or on a comment (**Attach to comment**). Choose Internal or Shared before uploading. You can delete files you uploaded.
6. **Run the gates.** Tick exit criteria, then **Ready for gate review**; the Client Sponsor is notified and approves in the portal.
7. **Keep the RAID log current**; risks scoring 15 or more are flagged for steering. You can attach evidence to a RAID entry from its edit dialog.
8. **Report.** Edit the weekly status report draft and publish it to the portal; check the executive dashboard and EVM.
9. **Approve time** for your projects (Timesheet → Approvals).

You cannot change workspace settings, roles or templates; ask an Admin.

---

## Team Member

You work on the projects you are assigned to.

- **My Work** lists everything assigned to you across projects.
- Open an item from the board or list (the side panel has a shareable link). Edit fields, acceptance criteria and custom fields; comment (Internal by default, with @Name mentions); attach files; log time.
- Move cards across the board; you cannot set **Accepted** (that is the client's decision).
- Add RAID entries when you spot a risk or an issue.
- Submit your weekly timesheet for your Lead to approve.

You do not see budgets or cost rates and cannot edit gates or invite clients.

---

## Associate

You are a contractor working through Konnector. You work exactly like a Team Member, **only on the projects you are assigned to**. You do not see other projects, the client list, rates or budgets. Restricted (export-controlled) projects are open only to U.S. persons.

---

## Client Sponsor

You represent your organization and sign off the work. You use the **portal** (`/portal`), which shows only your organization's projects and only what Konnector has shared with you.

- **Needs your approval** (top of the portal): gates and deliverables waiting for you. Each approval asks you to confirm your identity again; your decision is recorded with your name, the time and your IP address.
- **Gates:** approve, approve with conditions (each condition becomes a tracked item) or reject with reasons.
- **Deliverables:** accept or reject each acceptance criterion; rejecting one reopens the related work.
- **Items:** open a shared item to read it, comment, accept it (status Accepted) and see its custom fields.
- **Files:** download shared files from the item panel. Files you upload are always shared with Konnector (up to 25 MB).
- **Requests:** **Submit a request** creates a Client Request for the Konnector team.
- **Reports and dashboards:** published weekly status reports, the milestones timeline and the dashboard (budget figures only if your Lead shares them).

---

## Client Member

Like a Client Sponsor, without gate approvals: you can read shared work, comment, upload and download files, accept deliverables and items assigned to you, and submit requests.

---

## Client Viewer

Read-only portal access: projects, shared items and files, gate progress, published reports and milestones. You cannot comment, upload, approve or accept.

---

Questions or access problems: contact your Konnector Delivery Lead, or ask a Konnector Admin to re-send your invite.
