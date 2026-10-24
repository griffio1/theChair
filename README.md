# theChair

Git merges code. theChair merges intent.

Teams mixing AI coding agents (Claude Code, Codex) get conflicts git can't see: one agent writes `userId`, the other reads `user_id`. theChair keeps a ledger of the API contracts the team agreed on in the **main chat**, checks agents **before** they write (MCP `preflight` + a Claude Code hook) and **after** they push (GitHub webhook), and posts every conflict into the chat with a plain-English explanation and a one-click fix.

## Layout and owners

| Path | What | Owner |
|---|---|---|
| `shared/types.ts` | The frozen interface. Change only with both builders + a DECISIONS.md line | Parag + Carter |
| `contracts/` | Approved contracts as JSON (committed by the approve route) | Parag + Carter |
| `engine/` | Deterministic diff + preflight verdicts + AGENTS.md writer | Parag (A) |
| `server/` | Ledger (Supabase REST), LLM adapter, main chat, approve, GitHub helpers | Parag (A) |
| `mcp/` | Local stdio MCP server: `get_contracts`, `preflight`, `propose_contract_change` | Parag (A) |
| `hooks/` | Claude Code PreToolUse hook that blocks contract-breaking edits | Parag (A) |
| `web/` | Next.js dashboard (main chat + contracts) and API route handlers | Carter (B) |
| `github/` | Push webhook pipeline | Carter (B) |
| `analyzer/` | Gemini extractor (JSON schema, SHA cache) + deterministic fallback | Carter (B) |
| `demo/` | Tiny login app the demo runs on | Carter (B) |

## Status

Working and tested here (`npm test`, 20 tests): diff engine, preflight verdicts, AGENTS.md rewriting, deterministic extractor on the demo app, and the Claude Code hook (simulated: blocks the `user_id` edit, allows harmless ones, works offline against `contracts/*.json`).

Written but **not yet run** (no network to install packages in the build sandbox): the Next.js app and routes, the MCP server, Supabase calls, Groq/Gemini calls, GitHub calls. Expect small fixes on first run; that's what the hour-3 checkpoint is for.

## Workspaces

Each workspace has its own team dashboard, contracts, AI chat, agent credentials
and repository connection. See [workspace team setup](web/WORKSPACE-TEAMS.md)
for migrations, access rules and connection instructions.

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
claude mcp add thechair \
  -e THECHAIR_API_URL=http://localhost:3000 -e THECHAIR_AGENT=claude-code -e THECHAIR_DEVELOPER=<name> \
  -- npx tsx mcp/server.ts
```

The hook in `.claude/settings.json` is picked up automatically; set `THECHAIR_API_URL`, `THECHAIR_DEVELOPER`, and the private `THECHAIR_AGENT_TOKEN` in its environment so authenticated checks show on the dashboard. Add the same private token to the MCP launcher's environment.

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.thechair]
command = "npx"
args = ["tsx", "/ABSOLUTE/PATH/thechair/mcp/server.ts"]
env = { THECHAIR_API_URL = "http://localhost:3000", THECHAIR_AGENT = "codex", THECHAIR_DEVELOPER = "<name>", THECHAIR_AGENT_TOKEN = "<private-agent-credential>" }
```

Pass: both agents can call `get_contracts` and get `auth-login` back. Register a
30-day agent credential with `web/scripts/configure-agent.ts` as described in
`web/WORKSPACES.md`. Store the raw token only in ignored env/private configuration
files. Agent credentials cannot approve contract changes.

### GitHub webhook

Deploy `web/` to Vercel (root directory `web`), then in the repo: Settings → Webhooks → `https://<app>.vercel.app/api/github/webhook`, content type JSON, secret = `GITHUB_WEBHOOK_SECRET`, events: push. `GITHUB_TOKEN` needs contents read/write on this repo only. Branches follow `agent/<tool>/<topic>` so cards say which agent pushed.

## Demo (3 min)

1. **Main chat:** "login returns userId and token" → AI proposes the contract → Approve.
2. **Beat 1, Claude Code:** asked to rename the response to snake_case → the hook blocks it in its own terminal with the contract line and the fix.
3. **Beat 2, Codex:** told to read `user_id` from "old notes" and push → webhook catches it → red card in the chat with file and line.
4. **Approve fix** → AGENTS.md + contract committed → card turns green.

## Data note

Changed files are sent to the Gemini API for shape extraction, and chat messages to Groq. Free tiers may use prompts to improve the providers' products. Don't point theChair at code you can't share.
