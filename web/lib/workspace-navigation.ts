export type WorkspaceView = "home" | "team" | "chat" | "people" | "contracts" | "conflicts" | "connections" | "account";
const views = new Set<WorkspaceView>(["home", "team", "chat", "people", "contracts", "conflicts", "connections", "account"]);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function readWorkspaceLocation(search: string) {
  const params = new URLSearchParams(search);
  const workspaceId = params.get("workspace") ?? "";
  const chatId = params.get("chat") ?? "";
  const requested = params.get("view") as WorkspaceView;
  const view = views.has(requested) ? requested : "team";
  return {
    workspaceId: uuid.test(workspaceId) ? workspaceId : "",
    chatId: view === "chat" && uuid.test(chatId) ? chatId : "",
    view,
  };
}

export function workspaceHref(workspaceId: string, view: WorkspaceView = "team", chatId = "") {
  const params = new URLSearchParams();
  if (uuid.test(workspaceId)) params.set("workspace", workspaceId);
  params.set("view", view);
  if (view === "chat" && uuid.test(chatId)) params.set("chat", chatId);
  return `/workspaces?${params}`;
}
