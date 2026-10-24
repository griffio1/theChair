# Vercel deployment

## Project settings

- Import `griffio1/theChair` into the team's chosen Vercel account.
- Framework preset: **Next.js**.
- Root Directory: **web**.
- Enable **Include source files outside of the Root Directory in the Build Step**.
  The API routes import the repo's server, engine, analyzer, github and shared folders.
- Install command: `npm ci`; build command: `npm run build`.
- Keep the default Next.js output directory.
- Production branch: `main`. Workspace and team-access changes are developed in
  `agent/codex/workspaces` and `agent/codex/secure-team` respectively.

The local production build passed on Node 24.19.0 with Next.js 15.5.28.

## Environment variables

Add these to the Vercel project for the intended deployment environment. Copy
values from the ignored `web/.env.local`; do not commit or paste the file into
logs. Server credentials must not use a `NEXT_PUBLIC_` prefix.

| Variable                        | Value/source                                                         |
| ------------------------------- | -------------------------------------------------------------------- |
| `SUPABASE_URL`                  | Shared Supabase URL                                                  |
| `SUPABASE_SERVICE_KEY`          | Shared secret/service key, server only                               |
| `NEXT_PUBLIC_SUPABASE_URL`      | Same shared URL                                                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key; this is the name the browser client reads           |
| `LLM_PROVIDER`                  | `groq`                                                               |
| `GROQ_API_KEY`                  | Shared Groq key                                                      |
| `GROQ_MODEL`                    | Copy the configured local model                                      |
| `GEMINI_API_KEY`                | Carter's Gemini key                                                  |
| `GEMINI_MODEL`                  | `gemini-3.8-flash`                                                   |
| `EXTRACTOR`                     | `auto`                                                               |
| `GITHUB_TOKEN`                  | Repository-scoped token with Contents read/write                     |
| `GITHUB_REPO`                   | `griffio1/theChair`                                                  |
| `GITHUB_WEBHOOK_SECRET`         | Agree on a shared value with Parag before enabling GitHub deliveries |

`THECHAIR_API_URL`, `THECHAIR_AGENT`, and `THECHAIR_DEVELOPER` configure the local
MCP server and hook. They are not needed by the hosted dashboard. Keep local MCP
pointing at the intended shared API. Carter explicitly switched his local MCP
connection to `https://the-chair-peach.vercel.app`; a fresh MCP `get_contracts`
connection to that deployment returned all nine approved contracts.

## Workspace team extension

Deploy the workspace-teams API and UI together after applying
`web/sql/workspace-teams.sql`. The migration is installed in the shared project.
Each workspace now manages repository credentials and its own webhook secret
through **Repository & agents**; global GitHub secrets no longer route requests.
See [the rollout and Parag handoff](WORKSPACE-TEAMS.md).

## First deployment

The home page redirects to the workspace sign-in flow. Workspace routes enforce
membership; original ledger routes require membership in the explicitly bound
team workspace. Only owners can approve changes. MCP and hook clients require
their private `THECHAIR_AGENT_TOKEN`; GitHub deliveries require a signature.

Before using the new workspaces, apply `web/sql/workspaces.sql` followed by
`web/sql/secure-team.sql` to Supabase and
allow the deployment's `/workspaces` URL in Supabase Auth redirect settings.
See `web/WORKSPACES.md` for identity, invitation, and verification details.

1. Connect Vercel and select the account/team that should own the project.
2. Set the project settings and environment variables above.
3. Check signed-out `/` redirects to `/workspaces`, anonymous `/api/contracts`
   returns 401, and a member of the bound team can open `/team`. Use a configured
   MCP client to verify `auth-login` is still available with the private token.
4. Coordinate the production promotion and webhook configuration with Parag.

The webhook endpoint will be `https://<deployment>/api/github/webhook`, with push
events, JSON content type, and the same secret as `GITHUB_WEBHOOK_SECRET`.
GitHub requires repository webhook administration access to configure it. This
setup does not change webhook settings automatically.

## References

- [Vercel monorepo source-file settings](https://vercel.com/docs/monorepos/monorepo-faq)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Deploying from the CLI](https://vercel.com/docs/projects/deploy-from-cli)
