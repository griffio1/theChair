# AgentSync

Git merges code. AgentSync merges intent.

Teams mixing AI coding agents (Claude Code, Codex) get conflicts git can't see: one agent writes `userId`, the other reads `user_id`. AgentSync keeps a ledger of the API contracts the team agreed on in the **main chat**, checks agents **before** they write (MCP `preflight` + a Claude Code hook) and **after** they push (GitHub webhook), and posts every conflict into the chat with a plain-English explanation and a one-click fix.

## Layout and owners

| Path | What | Owner |
|---|---|---|
| `shared/types.ts` | The frozen interface. Change only with both builders + a DECISIONS.md line | Both |
| `contracts/` | Approved contracts as JSON (committed by the approve route) | Both |
| `engine/` | Deterministic diff + preflight verdicts + AGENTS.md writer | A |
| `server/` | Ledger (Supabase REST), LLM adapter, main chat, approve, GitHub helpers | A |
| `mcp/` | Local stdio MCP server: `get_contracts`, `preflight`, `propose_contract_change` | A |
| `hooks/` | Claude Code PreToolUse hook that blocks contract-breaking edits | A |
| `web/` | Next.js dashboard (main chat + contracts) and API route handlers | B |
| `github/` | Push webhook pipeline | B |
| `analyzer/` | Gemini extractor (JSON schema, SHA cache) + deterministic fallback | B |
| `demo/` | Tiny login app the demo runs on | B |

## Status

Working and tested here (`npm test`, 20 tests): diff engine, preflight verdicts, AGENTS.md rewriting, deterministic extractor on the demo app, and the Claude Code hook (simulated: blocks the `user_id` edit, allows harmless ones, works offline against `contracts/*.json`).

Written but **not yet run** (no network to install packages in the build sandbox): the Next.js app and routes, the MCP server, Supabase calls, Groq/Gemini calls, GitHub calls. Expect small fixes on first run; that's what the hour-3 checkpoint is for.

## Setup

```bash
npm install            # root: tsx, typescript (tests + hook)
cd web && npm install  # Next.js dashboard + API
cd ../mcp && npm install
cp .env.example .env   # fill in keys (never commit .env); also copy to web/.env.local
npm test
```

1. **Supabase:** run `supabase/schema.sql` in the SQL editor. It creates the tables, read-only RLS for the dashboard, Realtime, and seeds `auth-login` v1.
2. **Main chat LLM:** `LLM_PROVIDER=groq`, `GROQ_API_KEY` from groq.com (with a q). Switch to `gemini` or `ollama` with one env var.
3. **Extractor:** `GEMINI_API_KEY`, and set `GEMINI_MODEL` to the current Flash model name. `EXTRACTOR=deterministic` skips Gemini entirely.
4. **Run:** `cd web && npm run dev` → http://localhost:3000.

### Connect the agents (hour-3 checkpoint)

Claude Code (from the repo root):

```bash
claude mcp add agentsync \
  -e AGENTSYNC_API_URL=http://localhost:3000 -e AGENTSYNC_AGENT=claude-code -e AGENTSYNC_DEVELOPER=<name> \
  -- npx tsx mcp/server.ts
```

The hook in `.claude/settings.json` is picked up automatically; set `AGENTSYNC_API_URL` and `AGENTSYNC_DEVELOPER` in your shell so blocks show on the dashboard.

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.agentsync]
command = "npx"
args = ["tsx", "/ABSOLUTE/PATH/agentsync/mcp/server.ts"]
env = { AGENTSYNC_API_URL = "http://localhost:3000", AGENTSYNC_AGENT = "codex", AGENTSYNC_DEVELOPER = "<name>" }
```

Pass: both agents can call `get_contracts` and get `auth-login` back.

### GitHub webhook

Deploy `web/` to Vercel (root directory `web`), then in the repo: Settings → Webhooks → `https://<app>.vercel.app/api/github/webhook`, content type JSON, secret = `GITHUB_WEBHOOK_SECRET`, events: push. `GITHUB_TOKEN` needs contents read/write on this repo only. Branches follow `agent/<tool>/<topic>` so cards say which agent pushed.

## Demo (3 min)

1. **Main chat:** "login returns userId and token" → AI proposes the contract → Approve.
2. **Beat 1, Claude Code:** asked to rename the response to snake_case → the hook blocks it in its own terminal with the contract line and the fix.
3. **Beat 2, Codex:** told to read `user_id` from "old notes" and push → webhook catches it → red card in the chat with file and line.
4. **Approve fix** → AGENTS.md + contract committed → card turns green.

## Data note

Changed files are sent to the Gemini API for shape extraction, and chat messages to Groq. Free tiers may use prompts to improve the providers' products. Don't point AgentSync at code you can't share.
