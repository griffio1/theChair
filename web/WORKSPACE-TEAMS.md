# Workspace team dashboards

Project info, Team chat, Agreements, Issues, People and Connections share one
workspace layout. `/workspaces` lists your workspaces; readable links such as
`/workspaces/collegelarper/teamchat` reopen the selected view. Clicking the
project name in the breadcrumb opens Project info. Existing UUID and query links
still work and become readable links after membership is verified.
`/team` remains an alias for the original Test67 workspace. Light, Dark and Pride
use the shared appearance preference.

Owners can edit the project name, a Markdown description, up to four private
images, and a hackathon deadline in **Project info**. The name can change without
breaking its URL. Duplicate project names receive a unique suffix. The editor
includes formatting buttons and a preview; uploads support paste and drop. All
members can view saved information. Concurrent edits return a conflict instead
of overwriting another owner's save. Deadlines are stored in UTC and displayed
in each user's local time; the countdown is recalculated after a tab resumes.

**Account**, beside the profile at the bottom left, edits display name, optional
nickname, email and password using Supabase Auth. A nickname takes precedence in
member lists, reactions and new messages; old messages retain their original
author names. Email changes follow the project's confirmation settings. Password
changes support the current password and reauthentication codes. Passwords and
codes are never stored in browser storage by this feature.

## Access and data

All original ledger tables now carry a required `workspace_id`. The migration
attributes existing rows to the explicitly approved Test67 binding; it does not
copy or delete that history. Contract IDs/versions and extraction caches are
unique within a workspace. New workspaces start with empty team ledgers.

Browser APIs verify Supabase membership before installing a request-local server
workspace context. Every ledger read, insert, update and cache operation requires
that context; concurrent requests cannot share it. Direct database reads enforce
membership with RLS, and dashboard queries/realtime subscriptions additionally
filter the selected workspace. AI history, contract proposals, file claims,
conflicts and approval publishing use the same context.

Owners approve changes and manage connections. Members can read and chat. Agent
credentials select their workspace automatically and cannot approve or manage
connections. Tokens expire after 30 days; revocation or loss of the issuing
owner's membership disables them. Raw agent tokens are shown once; hashes are
stored in Supabase. Existing Test67 agent credentials continue to work.

## Repository and agent setup

In the workspace sidebar, open **Connections**, then **Repository & agents**:

1. Enter `owner/repository`, a GitHub token and a webhook secret of at least
   32 characters. GitHub must confirm the token's account has repository admin
   and push access. Give the token Contents read/write permission as well;
   GitHub's account permissions are not proof of the token's endpoint permissions.
2. In that GitHub repository's Settings > Webhooks, configure the displayed URL,
   JSON content type, push events and the same secret. Connecting in theChair
   does not create or change GitHub webhook settings automatically.
3. Create a named agent credential. Copy the one-time value privately into
   `THECHAIR_AGENT_TOKEN` in that agent's MCP/hook environment; set
   `THECHAIR_API_URL` to this deployment and restart the agent.

Each repository belongs to one workspace. Credentials can be rotated by saving
that same repository again; a different project requires a different workspace.
The server-only connection table stores GitHub tokens and webhook secrets with
no direct browser grants, including for owners. API responses expose only
connection metadata. Webhooks select a connection by GitHub's numeric repository
ID and verify its HMAC before any background work. No workspace header or shared
environment token can redirect a webhook or approval into another repository.

Reference: [GitHub token permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).

## Deployment and current handoff

The shared Supabase project has these migrations applied: `workspaces.sql`,
`secure-team.sql`, `workspace-teams.sql`, `workspace-roles.sql`, `chat-images.sql`,
`chat-reactions.sql`, then the production set `production-limits.sql`,
`webhook-jobs.sql` and `approval-publishing.sql`, followed by `account-profiles.sql`
and `project-info.sql`.
Carter confirmed the profile migration succeeded. It synchronizes names without
changing roles or chat history. Do not rerun older migrations.
For a separate database, first install `supabase/schema.sql` and `workspaces.sql`,
create the intended owner's workspace, and review the explicit destination UUID
in `secure-team.sql` before continuing. Its Test67 binding is specific to the
shared hackathon database; never assign existing data to an arbitrary account.
Deploy this branch's API and UI together after the migration. Older server code
cannot insert ledger rows without the new required workspace ID. Do not run the
old `secure-team.sql` again after the workspace migration; it restores the old
single-team access policies.

Carter explicitly approved the four new integration contracts and backend
ownership exception. Approved JSON contracts and AGENTS.md are synchronized;
the same four approvals are recorded in Test67's ledger.

Parag connected Test67 to `griffio1/thechair` and configured its webhook.
A real GitHub push caught the rehearsal's `data.user_id` mismatch. The recovery
push restores `data.userId`; see [the runbook](../demo/RUNBOOK.md). Other workspaces
need their own repository connection. Global credentials are not silently reused.

Vercel still needs its existing Supabase and LLM/extractor credentials. Repository
credentials now come from the workspace connection table. `GITHUB_REPO` is only
used to recognize theChair's own source tree for its demo-file exclusions.

## Verification

`node --env-file=web/.env.local --import tsx web/scripts/check-project-info.ts`
checks the real project APIs with disposable accounts and a private image, then
removes only its test records and storage objects. No existing projects are edited.

Root and web suites cover extraction, PostgreSQL isolation,
concurrent server contexts, AI context/proposal isolation and credential controls.
Root and web TypeScript checks pass, including the evidence assertion in
`engine/diff.test.ts:68` that Carter explicitly authorized fixing. The production
build also passes.

Live disposable-account checks pass for separate ledgers and claims, scoped
agents, revocation, owner/member restrictions, signed webhook ping routing,
existing chat/invitation flows and original Test67 protections. All disposable
accounts/workspaces were removed. Integration scripts do not publish GitHub
commits; separate real push rehearsals use isolated demo branches. Carter manually
confirmed uploads, paste/drop, reactions, bubbles and faster conversation loading.
Browser automation is unavailable; review the latest recovery states manually.

```powershell
npm test
npm --prefix web test
node --env-file=web/.env.local --import tsx web/scripts/check-workspace-teams.ts
node --env-file=web/.env.local --import tsx web/scripts/check-workspaces.ts
node --env-file=web/.env.local --import tsx web/scripts/check-team-access.ts
```

## Invitations and shared ownership

`workspace-roles.sql` is installed after the three earlier migrations. Carter
approved `workspace-member-role` v1. Under **People & invites**, owners can use
**Make owner** after a teammate accepts an invitation. Owners can connect
repositories, manage agent credentials, invite members and approve agreements.
The database serializes role changes and rejects removal of the last owner.
Demotion immediately removes owner-only API access; issued agent credentials
also stop working when the issuer is no longer an owner.

Invitations created locally use `THECHAIR_PUBLIC_URL` when set, otherwise the
configured public `THECHAIR_API_URL`. Hosted requests use their own origin unless
an explicit public URL is configured. The same rule supplies webhook setup URLs.
Links keep the invitation token in the fragment, and invitations still require
matching verified email. The UI warns if only a localhost link is available.
No invitation emails are sent automatically.

The hosted AI chat and Gemini extractor were exercised successfully. The demo
backend returns userId and token on port 4000. Real GitHub push analysis is now
connected. Visual theme/mobile checks remain manual.

Private image attachments are available in both workspace and team chats. See
[chat image setup and verification](CHAT-IMAGES.md) for the applied migration,
limits, privacy rules and the disposable live check. Images are for teammate
viewing; AI image analysis is not part of this feature.

Chat now restores the last conversation and renders messages independently of
sidebar/ledger loading. [Chat experience notes](CHAT-EXPERIENCE.md) cover the
applied reactions migration, hover picker, message bubbles and verification.
