# Vercel deployment

## Project settings

- Import `griffio1/theChair` into the team's chosen Vercel account.
- Framework preset: **Next.js**.
- Root Directory: **web**.
- Enable **Include source files outside of the Root Directory in the Build Step**.
  The API routes import the repo's server, engine, analyzer, github and shared folders.
- Install command: `npm ci`; build command: `npm run build`.
- Keep the default Next.js output directory.
- Production branch: `main`. Scheduled GitHub Actions only run from `main`.

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
| `THECHAIR_PUBLIC_URL`           | `https://the-chair-peach.vercel.app`; invitation and webhook links   |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`| Turnstile public site key; rebuild after changing it                 |
| `CRON_SECRET`                   | Private random value, 32+ characters; guards the job runner          |

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

## Public signup and recovery

Production signup refuses to run without CAPTCHA configuration.

1. Create a Cloudflare Turnstile widget in **Managed** mode for the deployment
   hostname. Put its site key in `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and redeploy.
2. In Supabase Auth → Attack Protection, enable CAPTCHA, choose Turnstile and
   paste the widget secret there. The secret never goes in Vercel or the repo.
3. In Supabase Auth, configure production SMTP, set the site URL, and allow the
   deployment's `/workspaces` and `/recover` redirect URLs. Email confirmation
   is required; confirm signup and recovery emails arrive before launch.

## Scheduled check retries

GitHub pushes are saved to a private queue and processed by
`GET /api/internal/jobs`, which requires `Authorization: Bearer <CRON_SECRET>`
and returns `{ processed, failed }`. The `Retry saved code checks` workflow
calls it every five minutes once configured:

- Vercel: `CRON_SECRET` as above.
- GitHub Actions secret `THECHAIR_JOB_SECRET`: the same value.
- Repository variables `THECHAIR_JOB_URL=https://the-chair-peach.vercel.app/api/internal/jobs`
  and `THECHAIR_JOB_RUNNER_ENABLED=true`. Without the flag the workflow skips.

A failed run means a saved check failed; inspect the private job table and the
Vercel logs. Usage caps are enforced in the database; see the header of
`web/sql/production-limits.sql` for the current limits.

## First deployment

The home page is the public landing page; signed-in work happens under
`/workspaces`. Workspace routes enforce
membership; original ledger routes require membership in the explicitly bound
team workspace. Only owners can approve changes. MCP and hook clients require
their private `THECHAIR_AGENT_TOKEN`; GitHub deliveries require a signature.

For a new database, apply the migrations in the order listed in
[workspace setup](WORKSPACE-TEAMS.md#deployment-and-current-handoff). The shared
project already has all of them; do not rerun them.
See `web/WORKSPACES.md` for identity, invitation, and verification details.

1. Connect Vercel and select the account/team that should own the project.
2. Set the project settings and environment variables above.
3. Check signed-out `/` shows the landing page, anonymous `/api/contracts`
   returns 401, and a member of the bound team can open `/team`. Use a configured
   MCP client to verify `auth-login` is still available with the private token.
   Walk through signup, recovery, chat, images, reactions, themes and a phone-width
   layout in a browser.
4. Coordinate the production promotion and webhook configuration with Parag.

The webhook endpoint will be `https://<deployment>/api/github/webhook`, with push
events, JSON content type, and the same secret as `GITHUB_WEBHOOK_SECRET`.
GitHub requires repository webhook administration access to configure it. This
setup does not change webhook settings automatically.

## References

- [Vercel monorepo source-file settings](https://vercel.com/docs/monorepos/monorepo-faq)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Deploying from the CLI](https://vercel.com/docs/projects/deploy-from-cli)
