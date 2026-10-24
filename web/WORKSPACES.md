# Workspace rollout

Carter is implementing the workspace UI and, at Carter's explicit request, its
storage, sign-in, and membership work too. Parag continues deployment work.
The legacy dashboard and agent workflows remain the existing single-team app.
New authenticated collaboration is at `/workspaces`.

## Current implementation

`/workspaces` supports Supabase account sign-up/confirmation/sign-in/sign-out,
creating/listing/switching workspaces, separate persistent chats, member lists,
owner-created invitations, and verified-email invitation acceptance. Chat history
refreshes every five seconds and shows the latest 200 messages. Failed messages
retain their draft and retry with the same client ID to avoid duplication.

Invitations use links the owner copies and shares; **no invitation email is sent**.
Links expire after seven days, and replacing a pending invitation invalidates its
old link. Only a verified account matching the invited email can accept. The
database stores token hashes, not the raw invitation tokens.

The new API uses the caller's Supabase access token and publishable key, never the
service key. Database permissions and RLS enforce membership even when callers
access Supabase directly. Mutations use functions with fixed search paths,
validated identities, atomic workspace creation, and duplicate-safe acceptance.

The scoped contract/conflict tables are empty until workspace-aware agent
integration is implemented. **The existing AI assistant, MCP checks, webhook,
approvals, and global ledger are still in the legacy dashboard.** New chats are
team conversations, not AI contract-proposal chats. No existing team data is
copied into a new workspace. This is not yet a migration of the legacy app into
a fully isolated multi-tenant agent service.

The legacy dashboard and workspace screens share `components/appearance-picker.tsx` and the
existing `thechair:theme` preference. Both support Light, Dark, and Pride.

## Approved APIs

These eight proposals were submitted with theChair's `propose_contract_change`
and explicitly approved by Carter in this session. All show approved in the
ledger. GitHub publication via the approval route failed with a token Contents
write 403; their approved records and generated AGENTS.md list are included in
this branch instead. Supabase Auth supplies identity; the demo's
`POST /api/auth/login` contract is unchanged.

| Proposal                | Route                                                    | Request                     | Response                                                           |
| ----------------------- | -------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| workspace-list          | GET /api/workspaces                                      | —                           | `{ workspaces }`                                                   |
| workspace-create        | POST /api/workspaces                                     | `{ name }`                  | `{ workspace, chat }`                                              |
| workspace-detail        | GET /api/workspaces/:workspaceId                         | —                           | `{ workspace, chats, members, invitations, contracts, conflicts }` |
| workspace-chat-create   | POST /api/workspaces/:workspaceId/chats                  | `{ title }`                 | `{ chat }`                                                         |
| workspace-chat-messages | GET /api/workspaces/:workspaceId/chats/:chatId/messages  | —                           | `{ messages }`                                                     |
| workspace-chat-send     | POST /api/workspaces/:workspaceId/chats/:chatId/messages | `{ body, clientMessageId }` | `{ messages }`                                                     |
| workspace-invite        | POST /api/workspaces/:workspaceId/invitations            | `{ email }`                 | `{ invitation }`                                                   |
| workspace-invite-accept | POST /api/invitations/accept                             | `{ token }`                 | `{ workspaceId }`                                                  |

Nested representations are defined in `web/lib/workspace-types.ts`:

- Workspace: `id`, `name`, `role` (`owner` or `member`), `createdAt`.
- Chat: `id`, `workspaceId`, `title`, `createdAt`.
- Member: `userId`, `displayName`, `role`, `joinedAt`. Do not list all Auth users.
- Invitation: `id`, `email`, `status`, `expiresAt`; creation additionally returns
  a one-time `inviteUrl` for the owner to copy. Creating an invitation does not
  imply an email was delivered. Store only a token hash server-side.
- Message: `id`, `chatId`, `workspaceId`, `author` (`userId`, `name`, `type`),
  `body`, `createdAt`.
- Contracts/conflicts: existing shared representations, restricted to the
  selected workspace. Never return the current global ledger under a new
  workspace name.
- Failures: `{ error: string }` with 400 validation, 401 session missing/expired,
  403 permission denied, 404 unavailable resource, or 409 conflict. Never send
  database errors or credentials to the browser. Responses must not be cached
  between users.

## Storage and identity requirements

1. New workspace, membership, conversation, message, and invitation tables with
   RLS enabled before exposing them. Use Supabase Auth's user ID, not a display
   name, as the membership identity.
2. Creating a workspace atomically creates owner membership and General chat.
3. Every read/write checks membership. A chat must belong to its path's workspace;
   changing an ID in a URL must not reveal or mutate another team's data.
4. Only owners create invitations. Acceptance verifies the signed-in, confirmed
   email matches the invitation, checks expiry, and atomically joins the member.
   Retries must not create duplicate members or messages.
5. Account sign-in, sign-up confirmation, sign-out, expired sessions, empty lists,
   failed sends, and browser refresh must all have usable UI states.
6. Scope contract checks, approval writes, Realtime subscriptions, LLM context,
   webhook routing, and agent credentials before claiming isolated team support.
   Existing global anonymous reads and unauthenticated mutation routes are not
   a secure multi-workspace backend.
7. Existing global data requires an agreed destination workspace and owners;
   do not automatically expose it to every new account or guess its ownership.
8. Apply a reviewed SQL migration in the actual Supabase project and verify with
   two distinct accounts plus an anonymous session. A build alone is insufficient
   to verify membership enforcement.

Implementation references: [Supabase Auth sign-up](https://supabase.com/docs/reference/javascript/auth-signup),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), and
[database functions](https://supabase.com/docs/guides/database/functions).

## Installation and verification

1. Run `web/sql/workspaces.sql` in the existing Supabase project's SQL Editor.
   The migration is additive and can be reapplied. It does not alter legacy tables
   or their access policies. Do not mistake new workspace RLS for protection of
   the old anonymous dashboard.
2. Keep Supabase email confirmation enabled. In Auth URL Configuration, allow
   `http://localhost:3000/workspaces` and the intended Vercel app's `/workspaces`
   URL so confirmation links return to the app. Configure a reliable email sender
   for real signups if the project is still using Supabase's test sender.
3. Start the web app. Run the disposable-account integration test below. It creates
   confirmed test accounts through the admin API without sending email and removes
   only its own workspace/user IDs afterward. Never run it against an unrelated
   API/database combination.
4. Sign up with two real team accounts and exercise the invitation flow. Existing
   legacy display names are not accounts and do not automatically grant membership.

## UI reconciliation

Merged Parag's `dad23f0` from main: conflict evidence starts with the breaking line,
and the hook skips test/macOS metadata files. These changes are in engine/hooks;
they do not replace the dashboard or Pride styles. No Vercel project settings
were changed by this branch; Parag continues to manage deployment.

## Checks

At implementation time: production build and web TypeScript passed; root tests
passed 34 checks, and web tests passed 13 checks. Root `npm run typecheck` fails
in Parag's newly merged `engine/diff.test.ts:68`: `out[0].evidence` is optional.
Parag can assert that evidence exists before mapping it. This branch does not
edit his engine code. Browser automation was unavailable, so visual interaction
checks still need a human browser review.

The migration was installed in the shared Supabase project, and the real
integration check passed against the local API with disposable accounts:
workspace/chat creation, message persistence, membership sharing, matching-email
invitation acceptance, retry deduplication, and outsider isolation. All temporary
test data was removed. Hosted routes still require deployment of this branch.

```powershell
node web/node_modules/typescript/bin/tsc -p web/tsconfig.json --noEmit --incremental false
npm --prefix web test
npm test
node --env-file=web/.env.local --import tsx web/scripts/check-workspaces.ts
```

Manual checks: create two workspaces and two chats, write different messages,
switch and reload, invite a second account, verify only its invited workspace is
visible, test modal Escape/focus, mobile layouts, and all three appearances.
Confirm the legacy dashboard still shows the original conversation and contracts.
