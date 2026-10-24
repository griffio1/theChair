import { AsyncLocalStorage } from "node:async_hooks";

const scope = new AsyncLocalStorage<string>();
export function inWorkspace<T>(workspaceId: string, action: () => T): T {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(workspaceId))
    throw new Error("A verified workspace is required");
  return scope.run(workspaceId, action);
}
export function currentWorkspace(): string {
  const id = scope.getStore();
  if (!id) throw new Error("A verified workspace is required");
  return id;
}
