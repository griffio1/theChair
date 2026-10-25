# Production handoff for Claude

Date: 2026-10-24. Branch: `agent/codex/production-ready`.
Carter requested an immediate checkpoint to conserve usage. Do not expand scope.
Public launch and merge to main remain pending the configuration below.

## Completed

- Public landing page, privacy notice, recovery flow and CAPTCHA controls; existing themes preserved.
- Usage limits, private durable webhook queue, retry worker and resumable approval publishing.
- Atomic Git publication, complete new-branch checks, extraction cache reuse across retries.
- AI timeouts, safe errors, bounded proposal validation, image cleanup recovery.
- Security headers and nonce CSP, CI, dependency checks and optional scheduled retries.
- Support address: paragsahani60@gmail.com.

Carter confirmed these migrations applied, in order: `production-limits.sql`, `webhook-jobs.sql`, `approval-publishing.sql`. Read-only probes of their three tables returned 200. Do not rerun older migrations.

Validation: root 81 tests passed; web 72 tests passed; root TypeScript passed. MCP lists all three tools and live get_contracts succeeds. Dependency audits reported zero vulnerabilities. Production build compiled and passed its type checks; consult the final build result in the session/CI. No browser end-to-end test of the new landing/auth flow was performed.

## Before public launch

1. Configure a Cloudflare Managed Turnstile widget for the deployment hostname. Put its public key in Vercel `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; put its secret in Supabase Auth CAPTCHA settings and enable Turnstile enforcement there. Production signup intentionally refuses missing configuration. Rebuild after setting the public key.
2. Verify Supabase production SMTP, site URL, allowed `/workspaces` and `/recover` redirect URLs, email confirmation, signup and recovery emails. Email confirmation is currently required; SMTP and CAPTCHA enforcement remain unverified.
3. Generate a private random secret of at least 32 characters. Set Vercel `CRON_SECRET` and GitHub Actions `THECHAIR_JOB_SECRET` to that same value. Set repository variable `THECHAIR_JOB_URL=https://the-chair-peach.vercel.app/api/internal/jobs` and `THECHAIR_JOB_RUNNER_ENABLED=true`. The workflow is disabled without that flag and schedules run from the default branch after merge. Check failed jobs and workflow alerts.
4. Rotate credentials previously shared in conversation before public release. Never commit or print `.env.local` or tokens.
5. Verify browser signup, recovery, membership, chat, images, reactions, themes and mobile layout; then review CI and merge/deploy with Parag. Set required CI branch protection, monitoring and backup/restore procedures.
6. Update README and deployment documentation for the new setup. The new private GET `/api/internal/jobs` contract `{processed, failed}` was proposed and explicitly approved by Carter; its app-ledger approval/publication may still need completion through the normal flow.

## Known limitations

- Text-only AI chat retries after an AI failure can duplicate the human message; adding an idempotency field requires a contract change.
- No self-service account/data deletion; support handles requests manually.
- Ambiguous saved approval publications can require operator review; retry the same approval to recover rather than bypassing its lease.
- Regex extraction has limited coverage. Unsupported or incomplete checks must not be described as proof that all code is correct.
- No Vercel, GitHub secret, SMTP or CAPTCHA settings were changed by this implementation. This is a tested code checkpoint, not a certification of production readiness.

User authorized the server approval/AI fixes and MCP timeout change despite normal directory ownership. Continue following AGENTS.md and coordinate any further ownership exceptions. Keep all local secrets private.
