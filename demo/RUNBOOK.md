# theChair: three-minute demo

## Before presenting

1. Sign in at https://the-chair-peach.vercel.app. Select Test67, then
   **Team agreements & AI chat**. Keep chat and Contracts ready.
2. Confirm `auth-login v1`: `POST /api/auth/login`, request `email/password`,
   response `userId/token`. Call MCP `get_contracts` from the agent terminal.
3. Confirm the workspace repository connection and GitHub webhook. Use the
   existing connection; avoid rotating keys during the presentation.
4. Run `npm run demo:server` in another terminal. Check the fixture:

   ```powershell
   Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/auth/login -ContentType application/json -Body '{"email":"ada@example.com","password":"hunter2"}'
   ```

   These fixture credentials illustrate the agreement; this is not theChair's
   real account authentication.
5. Increase browser/terminal font size. Close secret-bearing env/config tabs.
   Keep the rehearsal conflict visible and localhost ready as a fallback.

## 0:00–0:25 — The problem

“Two developers, two AI agents, one API. Git can merge their files even when
their assumptions disagree. Our backend returns `userId`. If another agent reads
`user_id`, the app breaks without a merge conflict. theChair makes the agreement
visible to both people and agents.”

Point to the approved login contract. A proposal becomes an agreement only after
a human owner approves it. Avoid creating a duplicate proposal on stage.

## 0:25–1:10 — Beat 1: catch it before an edit

Ask the agent:

> Call theChair's preflight for a plan to read `user_id` and `token` from POST
> `/api/auth/login` in `demo/web/Login.tsx`, sending `email` and `password`.
> Do not edit anything.

The result must block the mismatch and recommend `userId`. Explain that the
Claude Code hook is an additional check before an edit and can use committed
contracts offline. Show the file/field evidence.

## 1:10–2:00 — Beat 2: catch an unchecked push

“The second protection is independent of whether an agent followed the first.
We deliberately pushed a broken fixture. GitHub delivered the real webhook.”

Show the conflict for `agent/codex/beat-2-rehearsal-20261024`:
`demo/web/Login.tsx`, line 18, `data.user_id`. The user's greeting sees `undefined`.

For a fresh live delivery, push the existing fixture to a new branch:

```powershell
$demoRun = Get-Date -Format 'yyyyMMdd-HHmmss'
git push origin "db77090220086b28e1dd7fd363cb6a68a7609540:refs/heads/agent/codex/demo-broken-$demoRun"
```

This does not alter your working tree or `main`. Wait for the new card: HTTP 202
alone does not prove analysis finished. Never merge a broken fixture.

## 2:00–2:40 — Beat 3: repair and verify

“An owner can approve the agreement. Approval records the decision; the developer
still fixes the source. Then we check the actual code again.”

Show `data.userId` in the corrected source. The recovery commit is
`2b5d3c84838c9238b535bf2a7ee3a3d4e0d71380`, on
`agent/codex/beat-3-recovery-20261024`.

To trigger a fresh clean check:

```powershell
$demoRun = Get-Date -Format 'yyyyMMdd-HHmmss'
git push origin "2b5d3c84838c9238b535bf2a7ee3a3d4e0d71380:refs/heads/agent/codex/demo-fixed-$demoRun"
```

Show **All clear** for the corrected push. This verifies the changed fixture
against the API contract. Previous conflict cards remain as history; a later
push does not silently delete them.

## 2:40–3:00 — Close

“Shared intent before the edit, independent checking after the push, and evidence
the whole team can discuss. It works across Codex and Claude Code, with private
workspaces and human approval.”

If time remains, show a teammate's reaction or pasted image. Keep the main story
on the contract mismatch and verified repair.

## Recovery

| Symptom | Action |
|---|---|
| MCP unauthorized | Owner creates a new agent credential; update private launcher config and restart. Never display the token. |
| No new card | Check GitHub Recent deliveries and Vercel logs. Confirm repository identity and matching webhook secret; redeliver after fixing the cause. |
| Gemini unavailable | Use `EXTRACTOR=deterministic` for the supported fixture and explain the fallback. |
| Chat send times out | Check the conversation before retrying: AI text may already have been saved. |
| Hosted deployment pending | Use a known-good deployment or localhost with the same database. Don't migrate or rotate credentials on stage. |
| Network fails | Walk through the saved real conflict and recovery events; explicitly call them rehearsal evidence. |

Rehearsal branches contain old snapshots and are demo artifacts, not release
branches. Do not merge them into `main`.
