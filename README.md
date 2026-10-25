# theChair

**Git merges code. theChair merges intent.**

When teammates use different AI coding agents, their code can merge cleanly and
still disagree: a backend returns `userId` while a frontend reads `user_id`.
theChair keeps approved API agreements in a shared workspace, checks an agent's
plan before it edits, and checks changed source after a GitHub push. Conflicts
include the affected file, evidence and a suggested change.

Owners approve agreements; developers apply source fixes and verify them with
another check. Approval does not automatically rewrite application code.

## Demo

- Hosted app: **https://the-chair-peach.vercel.app** (sign-in and workspace membership required).
- Existing team: **Test67 → Team agreements & AI chat**.
- [Three-minute demo and recovery commands](demo/RUNBOOK.md).

## What's built

- Private workspaces, persistent conversations, invitations and owner/member roles.
- Workspace-scoped contracts, AI discussion, agent credentials and repository connections.
- MCP `get_contracts`, `preflight`, and `propose_contract_change`; Claude Code edit hook.
- Signed GitHub push analysis, Gemini extraction with deterministic fallback,
  duplicate-delivery handling and shared conflict cards.
- Private image attachments, drag/drop and paste, shared reactions, and Light,
  Dark and Pride appearance. Images are for teammates to view; AI image analysis
  is not part of this feature.

See [workspace setup](web/WORKSPACE-TEAMS.md), [images](web/CHAT-IMAGES.md),
and [chat/reactions](web/CHAT-EXPERIENCE.md) for access rules and verification.

## Local setup

Use Node.js 20+ and the committed lockfiles. From the repository root:

```powershell
npm ci
npm --prefix web ci
npm --prefix mcp ci
# Only if this private file does not already exist:
Copy-Item .env.example web/.env.local
```

Fill in the ignored env file privately. Supply the Supabase URL, server secret,
browser publishable/anon key, Groq key and Gemini key/model. Set
`LLM_PROVIDER=groq` and `EXTRACTOR=auto`; `EXTRACTOR=deterministic` is the offline
extractor option. Confirm the Gemini model in Google's model list when configuring
a new environment.

The browser key goes in `NEXT_PUBLIC_SUPABASE_ANON_KEY` (this variable also accepts
a Supabase publishable key). Never put a server secret in a `NEXT_PUBLIC_` variable.
Set `THECHAIR_API_URL` to the API your agents use; `THECHAIR_PUBLIC_URL` supplies
public invitation links when developing locally.

The shared hackathon database already has all migrations applied. **Do not rerun
old migrations just to start the app.** For another database, see the migration
order and explicit legacy-workspace binding in [workspace setup](web/WORKSPACE-TEAMS.md).

```powershell
npm --prefix web run dev
# In a second terminal, for the tiny fixture backend:
npm run demo:server
```

Open http://localhost:3000, sign in, and select your workspace. The demo backend
listens on port 4000. Its login contract is separate from Supabase account sign-in.

## Connect agents and GitHub

An owner opens **Team agreements & AI chat → Repository & agents** and creates an
agent credential. Store the one-time value privately in the MCP/hook environment.
Credentials are scoped to one workspace, expire after 30 days, and cannot approve
agreements or manage connections.

Codex (`~/.codex/config.toml`; use an absolute path):

```toml
[mcp_servers.thechair]
command = "npx"
args = ["tsx", "/ABSOLUTE/PATH/theChair/mcp/server.ts"]
env = { THECHAIR_API_URL = "https://the-chair-peach.vercel.app", THECHAIR_AGENT = "codex", THECHAIR_DEVELOPER = "carter", THECHAIR_AGENT_TOKEN = "<private-agent-credential>" }
```

Restart Codex and call `get_contracts`. Claude Code can register the same server
with its own credential and `THECHAIR_AGENT=claude-code`. The hook in
`.claude/settings.json` is picked up automatically; give it `THECHAIR_API_URL`,
`THECHAIR_DEVELOPER` and its private `THECHAIR_AGENT_TOKEN` environment variables.
It can also check committed contracts offline.

An owner connects `owner/repository`, a repository-scoped GitHub token with
Contents read/write and repository administrator access, and a random webhook
secret of at least 32 characters. In GitHub Settings → Webhooks, use the displayed
URL, JSON content type, push events and the same secret. Connecting in theChair
does not create the GitHub webhook automatically.

Repository credentials come from the server-only workspace connection table.
Global `GITHUB_TOKEN`/`GITHUB_WEBHOOK_SECRET` are not substitutes for this connection.
`GITHUB_REPO` identifies theChair's own repository for demo-source exclusions.
Use `agent/<tool>/<topic>` branch names to identify the pushing agent.

For Vercel, use the existing project, Root Directory `web`, Next.js preset, and
include files outside the root directory in the build. Set the server/browser
environment variables on that project. Parag manages the shared deployment.

## Validate

```powershell
npm test
npm run typecheck
npm --prefix web test
npx tsc --noEmit -p web/tsconfig.json
npm --prefix web run build
```

Stop the local Next.js dev server before building: both use `web/.next`.
Live checks create disposable accounts/workspaces and remove their own data.
Point them only at the API and Supabase project configured together in your
private env. `WORKSPACE_CHECK_URL` overrides the default localhost API.

```powershell
node --env-file=web/.env.local --import tsx web/scripts/check-workspaces.ts
node --env-file=web/.env.local --import tsx web/scripts/check-workspace-teams.ts
node --env-file=web/.env.local --import tsx web/scripts/check-chat-images.ts
node --env-file=web/.env.local --import tsx analyzer/check-gemini.ts
```

## Layout and ownership

| Path | Purpose | Owner |
|---|---|---|
| `web/` | Workspace UI, API routes, migrations and checks | Carter |
| `github/`, `analyzer/`, `demo/` | Push pipeline, extraction and fixtures | Carter |
| `server/`, `engine/` | Ledger, AI adapter, approvals and contract checks | Parag |
| `mcp/`, `hooks/` | Agent connection and edit hook | Parag |
| `shared/`, `contracts/`, `AGENTS.md`, `DECISIONS.md` | Interfaces and agreements | Both |

Read [AGENTS.md](AGENTS.md) before editing. Call `get_contracts` and `preflight`;
contract changes require a human-approved proposal.

## Scope and data

This hackathon MVP detects API contract mismatches; it is not a general proof of
application correctness. Deterministic extraction supports limited source
patterns. Push processing is asynchronous: check Vercel logs and redeliver a
webhook if processing fails after acceptance.

Changed source goes to Gemini when enabled, and team AI conversations go to the
configured chat provider. Use code/data your team is authorized to send. Secrets
belong in private configuration, never in chat, screenshots or commits. Share
invitation links manually; the app does not send invitation emails.
