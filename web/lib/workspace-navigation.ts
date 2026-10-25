export type WorkspaceView = "home" | "project" | "team" | "chat" | "people" | "contracts" | "conflicts" | "connections" | "account";
const views = new Set<WorkspaceView>(["home", "project", "team", "chat", "people", "contracts", "conflicts", "connections", "account"]);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const routes: Partial<Record<WorkspaceView,string>> = {project:"",team:"teamchat",chat:"chats",people:"people",contracts:"agreements",conflicts:"issues",connections:"connections"};

export function readWorkspaceLocation(search: string, pathname = "/workspaces") {
  const params = new URLSearchParams(search);
  const workspaceId = params.get("workspace") ?? "";
  const chatId = params.get("chat") ?? "";
  const requested = params.get("view") as WorkspaceView;
  const view = views.has(requested) ? requested : workspaceId ? "team" : "home";
  const parts=pathname.split("/").filter(Boolean);
  if(parts[0]==="workspaces" && parts.length>1){
    let slug="";
    try {slug=decodeURIComponent(parts[1]);} catch { /* Invalid links never select another project. */ }
    const segment=parts[2] ?? "";
    const match=segment==="team" ? "team" : Object.entries(routes).find(([,path])=>path===segment)?.[0] as WorkspaceView | undefined;
    const valid=slugPattern.test(slug) && !!match && (match==="chat" ? parts.length===4 && uuid.test(parts[3]) : parts.length<=3);
    return {workspaceId:valid && uuid.test(slug)?slug:"",workspaceSlug:valid ? (uuid.test(slug)?"":slug) : "__unavailable__",view:match ?? "project",chatId:valid && match==="chat"?parts[3]:""};
  }
  return {
    workspaceId: uuid.test(workspaceId) ? workspaceId : "",
    workspaceSlug: "",
    chatId: view === "chat" && uuid.test(chatId) ? chatId : "",
    view,
  };
}

export function workspaceHref(workspaceId: string, view: WorkspaceView = "team", chatId = "", slug = "") {
  if(view==="home")return "/workspaces";
  if(view==="account")return "/workspaces?view=account";
  if(slugPattern.test(slug)) {
    const suffix=routes[view];
    return `/workspaces/${slug}${suffix?`/${suffix}`:""}${view==="chat" && uuid.test(chatId)?`/${chatId}`:""}`;
  }
  const params = new URLSearchParams();
  if (uuid.test(workspaceId)) params.set("workspace", workspaceId);
  params.set("view", view);
  if (view === "chat" && uuid.test(chatId)) params.set("chat", chatId);
  return `/workspaces?${params}`;
}
