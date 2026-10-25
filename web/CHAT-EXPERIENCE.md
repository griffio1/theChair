# Chat startup, bubbles and reactions

Returning members land in their last workspace conversation. Only workspace/chat
UUIDs are saved under a per-user localStorage key; messages and access decisions
are never restored from localStorage. A missing/deleted chat falls back to an
available chat. Accounts with no workspaces see workspace creation.

The restored message request runs alongside workspace-list/detail requests.
Independent authenticated database reads run in parallel. Conversation content
can render before sidebar details finish. Team messages also render independently
of contracts/conflicts, which no longer hold the conversation loading state open.
Membership/JWT/RLS checks remain in place. A skeleton represents messages still
being fetched; there is no promise of zero network latency or zero cold-start time.

Workspace messages have separate bubbles; your messages align right. Team chat
uses clear bubbles with a separate AI tint. Styling follows light, dark and Pride
themes. Image selection, drag/drop, clipboard paste and enlargement are unchanged.

## Reactions

Hover over a message for 550 ms to reveal an animated six-emoji picker. **React**
also opens it with keyboard/touch; Escape closes it. Reduced-motion preferences
disable animations. Click your existing reaction to remove it. Counts update
after the server confirms and synchronize to teammates every five seconds.
Hovering a count shows the names of current members who reacted.

The approved `workspace-reactions-read` and `workspace-reaction-set` APIs cover
workspace conversations and team chat (including activity cards). `conversationId`
is the workspace chat UUID or the literal `team`. Reads summarize the latest 200
messages. Writes specify the desired `active` boolean, so retries do not toggle
unexpectedly. Only a member's own reactions can be changed; database RPCs validate
message/conversation/workspace scope and direct browser writes are denied.

## Deployment and verification

Run `web/sql/chat-reactions.sql` after the existing migrations; Carter confirmed
successful application. No environment changes are needed. Deploy the web app
with both new route handlers and refresh existing browser tabs.

```powershell
npm --prefix web test
node --env-file=web/.env.local --import tsx web/scripts/check-workspaces.ts
```

PostgreSQL tests cover reaction ownership, retries, cross-conversation isolation,
revoked membership and anonymous access. The live disposable-account check also
verifies shared counts, team/workspace separation and existing invitations/roles.
Its parallel authenticated startup requests completed in 282 ms in a warm local
API check against Supabase; this is not a cold-start or browser-paint benchmark.
Carter manually confirmed faster opening, clear bubbles, smooth delayed hover,
and reaction add/remove behavior in the local browser.
