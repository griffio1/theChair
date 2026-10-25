---
name: start-demo
description: Run theChair's live judge demo end to end. Use when the user says "start demo", "run the demo", or "demo time".
---

# Live demo

The dashboard (Test67 → Team agreements & AI chat) is on the big screen. The terminal is
the second screen. Keep every message short: judges read it from across the room. Narrate
in one or two plain sentences per beat, no emojis, then show the result. Run every script
step from the repo root:

```
npx tsx .claude/skills/start-demo/demo.ts <step>
```

If any step prints `FAIL`, stop, show the line, and say what to check. Never improvise a
fake result.

## 0. Pre-check (quiet)

Run `check`. If everything is `OK`, say only: "Everything is connected. Starting the demo."
If it prints a `NOTE` about old live-demo branches, run `reset` first, silently.

## 1. Beat 1: the agent is stopped before it writes

Say: "Our team agreed that login returns `userId`. I'm Claude Code, and I've been told to read `user_id` instead. Watch what happens."

1. Call the theChair MCP tool `preflight` with:
   - intent: "Read user_id and token from the login response in demo/web/Login.tsx"
   - paths: `["demo/web/Login.tsx"]`
   - shapes: one consumer shape, `POST /api/auth/login`, file `demo/web/Login.tsx`,
     requestFields `["email","password"]`, responseFields `["user_id","token"]`
   Show the verdict and the fix in two lines.
2. Say: "And if an agent skips that check and edits anyway, the hook catches the edit itself."
   Run `hook`. It hands the real Claude Code hook the exact breaking edit without writing
   anything. Quote the first `HOOK` reason line and the fix. Do not attempt the edit
   yourself: AGENTS.md forbids writing code after a `block`.

Say: "Blocked in the agent's own terminal, before any code was written."

## 2. Beat 2: a different agent pushes it anyway

Say: "Now a Codex agent on another laptop pushes the same mistake straight to GitHub."

1. Run `push`. Keep the `SINCE` value it prints.
2. Run `wait-card <SINCE>`. Present the card as:
   - what breaks (the `CARD` line)
   - where (the `AT` line)
   - the fix (the `FIX` line)
   and say how many seconds it took. Point the judges to the red card in the chat.

## 3. Beat 3: a human approves the fix

Say: "Agents never approve. A person does. Click **Approve fix** on the red card."

Run `wait-approve <ID>` with the `ID` from the card. When it reports approved, say:
"Green. The agreed contract was re-committed to the repo, so every agent reads the same truth on its next call."
Show the `committed` line(s) as printed. Only mention AGENTS.md if a printed commit names it.

## 4. Reset

Run `reset`. It removes the throwaway `agent/codex/live-demo-*` branch; `main` was never
changed. Finish with one line: "That's theChair: agree once, and every agent is held to it."
