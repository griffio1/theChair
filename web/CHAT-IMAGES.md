# Private chat images

Workspace conversations and the team dashboard support **Add images**, a preview,
removal before sending, image-only messages, and click-to-enlarge viewing. Limits:
four PNG/JPEG/WebP images per message, 3 MiB per input file, still images up to
25 megapixels. The server strips metadata, resizes to at most 4096×4096, and stores
WebP. Captions and filenames are rendered as text. Existing text chat is preserved.

Images are shared with human workspace members. They are **not sent to the AI for
image analysis**. Team image posts use a separate route and do not trigger an AI
reply. Text-only team messages still use the existing AI route.

## Deployment

1. Run `web/sql/chat-images.sql` after the existing workspace migrations. Carter
   confirmed successful application to the shared Supabase project.
2. Deploy the web app from this commit. No new environment variables are required.
   Sharp is now a direct web dependency; install using the committed lockfile.
3. Refresh the app and try an image in both kinds of chat and all three themes.

The migration creates the private `chair-chat-images` bucket, metadata table,
message image columns and an authenticated RPC that validates image ownership
and consumes attachments atomically with the message. Existing rows are preserved.
Approved contracts: `workspace-image-upload` v1, `workspace-image-read` v1,
`workspace-chat-send` v2, and `workspace-team-image-send` v1.

The read endpoint returns raw `image/webp` bytes, not JSON. It checks the current
member session and database RLS before reading storage through the server key.
Responses forbid shared caching. The browser uses revocable blob URLs rather
than public or signed storage URLs. Unsent drafts are visible only to their
uploader and expire after 24 hours. Subsequent uploads clean up that uploader's
expired unattached drafts. No background cleanup schedule is installed; inactive
users' abandoned objects and objects left by failed cleanup need storage maintenance.
Do not add browser-access policies to this bucket.

Retries with the same upload/message ID deduplicate; changed message payloads
cannot silently replace an existing send. Only the uploader may attach an image,
and only once, inside the original workspace. Removing a draft from the composer
does not immediately delete the stored upload; it expires as described above.

## Verification

```powershell
npm --prefix web test
node --env-file=web/.env.local --import tsx web/scripts/check-chat-images.ts
```

The live check creates and deletes disposable users, workspaces, messages and
storage objects. It verifies real uploads, normalization, private bucket access,
draft privacy, workspace isolation, concurrent upload/send retries, both chat
types, persisted history, text compatibility and loss of access after membership
revocation. PostgreSQL tests cover direct RLS and RPC abuse as well.

Browser automation is unavailable in this session; visual review is manual.
The existing Next.js dependency tree still reports two npm audit findings through
PostCSS (one moderate, one high). They predate this feature; the suggested automatic
fix is a Next.js major upgrade, which is not included in this attachment change.
