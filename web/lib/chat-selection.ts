const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function lastConversation(userId: string): { workspaceId: string; chatId: string } | null {
  try {
    const value = JSON.parse(localStorage.getItem(`thechair:last-conversation:${userId}`) ?? "null");
    return value && uuid.test(value.workspaceId) && uuid.test(value.chatId) ? value : null;
  } catch { return null; }
}
export function rememberConversation(userId: string, workspaceId: string, chatId: string) {
  // Store navigation IDs only. Every data request still verifies current membership.
  try { localStorage.setItem(`thechair:last-conversation:${userId}`, JSON.stringify({ workspaceId, chatId })); } catch {}
}
