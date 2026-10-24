# AGENTS.md

Rules for every AI coding agent working in this repo (Claude Code reads this via CLAUDE.md).

## Before you edit
1. Call the theChair MCP tool `get_contracts` at the start of every session.
2. Call `preflight` before editing any file that defines or calls an HTTP API. Pass your intent, the paths you will touch, and the request/response fields you will use.
3. If `preflight` returns `block`, do not write the code. Apply the suggested fix or ask your developer.
4. To change a contract, call `propose_contract_change`. Never change a contract shape on your own.

## Ownership
Only the owner of a directory edits it. Everyone else asks in the main chat.

| Directory | Owner |
|---|---|
| /server, /engine, /mcp, /hooks | Parag (Builder A, Claude Code) |
| /web, /github, /analyzer, /demo | Carter (Builder B, Codex) |
| /shared, /contracts, AGENTS.md, DECISIONS.md | Parag + Carter, agree first |

## Conventions
- Branches: `agent/<tool>/<topic>`, e.g. `agent/claude-code/auth-backend`.
- JSON fields are camelCase.
- Pull before every session. Merge small and often.

## Current contracts
<!-- THECHAIR:CONTRACTS:START -->
- `POST /api/auth/login` (auth-login v1): request `{ email: string, password: string }` → response `{ userId: string, token: string }`
- `POST /api/workspaces/:workspaceId/integrations/agents` (workspace-agent-create v1): request `{ label: string }` → response `{ credential: object, token: string }`
- `POST /api/workspaces/:workspaceId/integrations/agents/:credentialId/revoke` (workspace-agent-revoke v1): request `{  }` → response `{ credential: object }`
- `POST /api/workspaces/:workspaceId/chats` (workspace-chat-create v1): request `{ title: string }` → response `{ chat: object }`
- `GET /api/workspaces/:workspaceId/chats/:chatId/messages` (workspace-chat-messages v1): request `{  }` → response `{ messages: array }`
- `POST /api/workspaces/:workspaceId/chats/:chatId/messages` (workspace-chat-send v1): request `{ body: string, clientMessageId: string }` → response `{ messages: array }`
- `POST /api/workspaces` (workspace-create v1): request `{ name: string }` → response `{ workspace: object, chat: object }`
- `GET /api/workspaces/:workspaceId` (workspace-detail v1): request `{  }` → response `{ workspace: object, chats: array, members: array, invitations: array, contracts: array, conflicts: array }`
- `GET /api/workspaces/:workspaceId/integrations` (workspace-integrations v1): request `{  }` → response `{ repository: unknown, credentials: array, webhookUrl: string }`
- `POST /api/invitations/accept` (workspace-invite-accept v1): request `{ token: string }` → response `{ workspaceId: string }`
- `POST /api/workspaces/:workspaceId/invitations` (workspace-invite v1): request `{ email: string }` → response `{ invitation: object }`
- `GET /api/workspaces` (workspace-list v1): request `{  }` → response `{ workspaces: array }`
- `POST /api/workspaces/:workspaceId/integrations/repository` (workspace-repository-connect v1): request `{ repository: string, token: string, webhookSecret: string }` → response `{ repository: object }`
<!-- THECHAIR:CONTRACTS:END -->
