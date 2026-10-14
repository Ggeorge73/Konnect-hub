# Konnect Hub runbook

Operational steps for the production deployment: Vercel (app) + Supabase (Postgres, Auth, Storage). Keep a **dev** and a **production** Supabase project and Vercel environment; never point dev at production data.

Contents: [Deploy](#deploy-to-vercel) · [Backups and restore](#backups-and-point-in-time-restore) · [Rotating secrets](#rotating-secrets) · [Scheduled jobs](#scheduled-jobs-cron) · [Incident checklist](#incident-checklist)

---

## Deploy to Vercel

### First deploy

1. **Supabase (production project).**
   - Plan with **Point-in-Time Recovery** (Pro + PITR add-on) and daily backups.
   - Apply the schema: `supabase link --project-ref <ref>` then `supabase db push` (runs `supabase/migrations/*.sql` in order). Do **not** load `supabase/seed.sql` into production.
   - Authentication: enable email (magic link + password) and TOTP MFA; turn **off** "Allow new users to sign up"; set Site URL and the `https://<domain>/auth/callback` redirect; configure Google and Azure providers if used (README, "Supabase").
   - Create the first Admin by hand: invite the user from Authentication → Users, then insert their `profiles` row (org = Konnector, role `admin`) in the SQL editor. Everyone else is invited from **Admin → Invites**.
   - Storage needs no setup: the app creates private buckets on first upload (`kh-org-<org id>` per client, `kh-branding` for logos).
2. **Vercel project.** Import the GitHub repository; framework Next.js; Node 22.
3. **Environment variables** (Production and Preview separately; Preview uses the dev Supabase project): every variable in `.env.example`. Server-only values (`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `REAUTH_SECRET`, `ICS_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`) must never be prefixed `NEXT_PUBLIC_`.
   - `DATABASE_URL`: the Supabase **pooler** string, transaction mode, port 6543.
   - `APP_URL`: `https://hub.konnectortech.com` (links in emails, invites, calendar feeds).
4. **Domain.** Add the custom domain in Vercel; HSTS and the other security headers come from `next.config.ts`.
5. **Email.** Verify `konnectortech.com` in Resend (SPF, DKIM); set `EMAIL_FROM`.
6. **Smoke test** after the first deploy: sign in as the Admin (MFA prompt appears), open `/admin`, invite yourself a test client user, create a project from a template, upload and download a file, then deactivate the test user.

### Every release

1. CI must be green on the pull request (lint, typecheck, unit + contract tests, RLS suite, Playwright).
2. **Migrations first.** If the release adds `supabase/migrations/00NN_*.sql`, apply them to production with `supabase db push` **before** promoting the Vercel deployment. Migrations are additive and the previous app version keeps working on the new schema; if a migration is not, plan a maintenance window.
3. Merge to `main`; Vercel builds and promotes. Watch Sentry and Vercel logs for 15 minutes.
4. **Rollback:** Vercel → Deployments → previous deployment → "Promote to Production". Schema changes are not rolled back automatically: write a forward-fix migration rather than editing an applied one.

---

## Backups and point-in-time restore

Supabase takes **daily backups** on all paid plans; with the **PITR** add-on, WAL is archived continuously and any second within the retention window (7, 14 or 28 days) can be restored. Storage objects (attachments, logos) are **not** included in database backups.

### Before restoring

1. Declare an incident (see checklist) and pick the target time: the last known good moment, in UTC. The append-only `audit_log` helps find it (`select * from audit_log where at > now() - interval '2 hours' order by at`).
2. Stop new writes: promote a deployment that shows a maintenance page, or temporarily remove the production domain alias in Vercel.
3. Export what will be lost: rows written after the target time that you want to replay (`audit_log`, recent `work_items`, `comments`) with `pg_dump --data-only --table=...` against the current database.

### Restore (PITR)

1. Supabase Dashboard → Project → **Database → Backups → Point in Time**.
2. Choose the date and time (UTC) and confirm. The project is unavailable while it restores (minutes to an hour, depending on size).
3. Restoring **replaces** the database in place. Auth users (`auth.users`) are restored to the same point.

### Restore (daily backup, no PITR)

Database → Backups → Scheduled backups → pick the day → Restore. Everything after that backup is lost.

### Restore into a separate project (safer for partial recovery)

1. Create a new Supabase project, or use the "Restore to a new project" option where available.
2. Restore the backup there, then copy the needed rows back with `pg_dump --data-only --table=<t> | psql "$PROD_URL"`. Respect foreign keys (projects → phases → work items → comments/attachments) and never copy `audit_log` rows in a way that rewrites history: `audit_log` is append-only by trigger; inserting old rows needs the owner role and must be noted in the incident report.

### After restoring

1. Check row counts of key tables against expectations; run `select count(*) from audit_log` and confirm the latest entries predate the target time.
2. Re-run the RLS suite against a copy if migrations were involved: `DATABASE_URL=<copy, superuser> npm run test:rls`.
3. Storage: attachments uploaded after the target time still exist in Storage but have no `attachments` row (orphans, harmless). Attachments deleted after the target time have rows but no object; downloads answer "no longer available". List them with the storage API and tell the affected users.
4. Bring the app back, post a summary to users (what time window was lost), and file the incident report.

### Drills

Restore the latest backup into a scratch project **every quarter** and run the smoke test against it; record the time it took.

---

## Rotating secrets

Rotate on a schedule (every 6 months), when someone with access leaves, and immediately after any suspected leak. After changing a Vercel variable, **redeploy** (variables apply to new deployments only).

| Secret                          | How to rotate                                                                                                                              | Effect on users                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → Settings → API → JWT keys / API keys: create a new secret key, set it in Vercel, redeploy, then revoke the old one.             | None.                                                                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page (publishable key). Update Vercel, redeploy, revoke the old key.                                                                  | Open tabs may need a reload.                                          |
| Supabase JWT signing key        | Supabase → Settings → JWT keys → rotate (only with the asymmetric-key flow, which keeps old tokens valid until expiry).                    | Users may need to sign in again.                                      |
| `DATABASE_URL` password         | Supabase → Database → reset the password (or the dedicated login role's password with `alter role ... password`), update Vercel, redeploy. | Brief errors during the switch: do it off-hours.                      |
| `REAUTH_SECRET`                 | New 32+ byte random value (`openssl rand -base64 48`), update, redeploy.                                                                   | Pending approvals ask for re-authentication again.                    |
| `ICS_SECRET`                    | New random value, update, redeploy.                                                                                                        | **Every calendar feed URL stops working**; users copy their new link. |
| `CRON_SECRET`                   | New random value in Vercel **and** in the scheduler (pg_cron job / GitHub secret).                                                         | None if both change together.                                         |
| `RESEND_API_KEY`                | Resend → API keys → create, update Vercel, redeploy, delete the old key.                                                                   | None.                                                                 |
| `ANTHROPIC_API_KEY`             | Anthropic Console → API keys → create, update, redeploy, revoke.                                                                           | None.                                                                 |
| OAuth client secrets            | Google Cloud / Microsoft Entra: add a new secret, paste it in Supabase → Auth → Providers, then delete the old one.                        | None.                                                                 |

Record each rotation (date, who, why) in the security log. A leaked service role key bypasses RLS: rotate it first, then review `audit_log` and Supabase logs for the exposure window.

---

## Scheduled jobs (cron)

Two endpoints must run on a schedule. Both are `POST` and authenticate with the header `x-cron-secret: $CRON_SECRET` (a request without it gets 401 or runs only as the signed-in user).

| Job             | Endpoint                         | Schedule                           | What it does                                                                                                           |
| --------------- | -------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Daily digest    | `POST /api/notifications/digest` | Once a day, 07:00 America/New_York | Emails each user who chose "daily digest" a summary of their unread notifications; sends once per day.                 |
| RAID escalation | `POST /api/raid/escalate`        | Hourly                             | Flags issues open > 10 days with no update and notifies the project Lead and Admins (at most once per 24 h per issue). |

Vercel Cron only sends `GET` requests, so use one of these:

**Supabase pg_cron + pg_net** (recommended, keeps the schedule next to the data). Enable both extensions (Database → Extensions), store the secret in Vault, then:

```sql
select vault.create_secret('<CRON_SECRET>', 'kh_cron_secret');

select cron.schedule('kh-daily-digest', '0 11 * * *', $$
  select net.http_post(
    url := 'https://hub.konnectortech.com/api/notifications/digest',
    headers := jsonb_build_object('x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'kh_cron_secret')));
$$);

select cron.schedule('kh-raid-escalation', '7 * * * *', $$
  select net.http_post(
    url := 'https://hub.konnectortech.com/api/raid/escalate',
    headers := jsonb_build_object('x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'kh_cron_secret')));
$$);
```

(`0 11 * * *` UTC is 07:00 in New York during daylight saving time and 06:00 in winter; adjust if needed.) Check runs with `select * from cron.job_run_details order by start_time desc limit 20;`.

**GitHub Actions** (alternative): a workflow with `on: schedule` that runs `curl -fsS -X POST -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" "$APP_URL/api/raid/escalate"`. GitHub may delay scheduled runs by several minutes.

Failures show in the scheduler's log and as 5xx in Vercel logs. Both jobs are idempotent, so a missed run can be triggered by hand with the same request.

---

## Incident checklist

Severity: **SEV1** data exposure across tenants, data loss or full outage; **SEV2** a core flow broken (sign-in, approvals, board) for many users; **SEV3** degraded or a single client affected.

1. **Declare.** Name an incident lead and a scribe. Open a channel/thread, note the start time (UTC) and severity.
2. **Assess.** Sentry (errors), Vercel (deploys, function logs), Supabase (Database health, Auth logs, API logs), Resend (bounces). What changed last: deploy, migration, secret, provider status pages (status.supabase.com, vercel-status.com)?
3. **Contain.**
   - Bad deploy: promote the previous Vercel deployment.
   - Suspected tenant leak: put the portal behind maintenance, rotate keys if a secret is involved, and preserve evidence (do not delete logs; `audit_log` is append-only).
   - Compromised account: **Admin → Users → Deactivate** (blocks sign-in at Supabase Auth and removes all RLS access), then review that user's `audit_log` entries.
   - Abusive upload: delete the attachment (Admin can delete any file; the deletion is audited); if malware, purge the object from the Storage bucket as well.
4. **Communicate.** Within 1 hour for SEV1/SEV2: tell affected clients' sponsors what happened, what data, what we are doing. Keep updates every 2 hours until resolved.
5. **Recover.** Fix forward or restore (see Backups). Verify with the smoke test and, for access issues, the RLS suite against a copy.
6. **Close.** Note the end time. Within 5 business days write a blameless report: timeline, root cause, impact (which tenants, which data), and actions with owners. For any client data exposure, involve Konnector leadership for contractual and legal notification duties.

Contacts: Supabase support (dashboard → Support, Pro plan SLA), Vercel support, Resend support. Keep the on-call rota and phone numbers in the team's private wiki, not in this repository.
