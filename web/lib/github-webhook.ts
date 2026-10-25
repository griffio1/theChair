import { WorkspaceError } from "./workspace-server";

const MAX_WEBHOOK_BYTES = 2_000_000;

// Read the signed body unchanged, but stop buffering at the actual byte limit.
// Content-Length can be absent or incorrect, and string length undercounts UTF-8.
export async function readWebhookBody(req: Request): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) throw new WorkspaceError(400, "Invalid payload");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WEBHOOK_BYTES) {
        await reader.cancel();
        throw new WorkspaceError(413, "Payload too large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(400, "Invalid payload");
  } finally {
    reader.releaseLock();
  }
}
