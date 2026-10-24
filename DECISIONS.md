# DECISIONS.md

Every change to /shared, /contracts or AGENTS.md gets a line here after both builders agree in chat.

| Date | Decision | Agreed by |
|---|---|---|
| 2026-10-24 | Interface frozen: shared/types.ts, auth-login v1 contract, route list | Parag, Carter |
| 2026-10-24 | Main chat on Groq (`gpt-oss-120b`, free tier). Extractor on Gemini Flash. Both behind server/llm.ts; Ollama as offline fallback. | Parag, Carter |
| 2026-10-24 | Main chat replaces the activity feed; conflict and contract cards appear inline in the thread. | Parag, Carter |
| 2026-10-24 | Claude Code PreToolUse hook (was S2) is a must-have; it checks the proposed edit content, not just declared intent. | Parag, Carter |
