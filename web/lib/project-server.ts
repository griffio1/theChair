import {authenticate, readBody, validId, WorkspaceError} from "./workspace-server";
import {imageMetadata} from "./chat-images";

function projectResult(workspace: Record<string, any>, images: Record<string, any>[]) {
  return {project: {workspaceId: workspace.id, name: workspace.name, slug: workspace.slug,
    description: workspace.project_description, hackathonMode: workspace.project_hackathon,
    deadline: workspace.project_deadline, revision: workspace.project_revision,
    updatedAt: workspace.project_updated_at, images: images.map(imageMetadata)}};
}
export function projectInput(body: Record<string, unknown>) {
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80 ||
      typeof body.description !== "string" || body.description.length > 10000 || typeof body.hackathonMode !== "boolean" ||
      !Number.isSafeInteger(body.revision) || Number(body.revision) < 0 ||
      !Array.isArray(body.imageIds) || body.imageIds.length > 4 || new Set(body.imageIds).size !== body.imageIds.length ||
      body.imageIds.some(id => typeof id !== "string"))
    throw new WorkspaceError(400, "Check your project details. Use up to four images.");
  let deadline: string | null = null;
  if (body.hackathonMode) {
    if (typeof body.deadline !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.deadline) || !Number.isFinite(Date.parse(body.deadline)))
      throw new WorkspaceError(400, "Choose a deadline for your hackathon.");
    deadline = new Date(body.deadline).toISOString();
  }
  return {p_name: body.name.trim(), p_description: body.description, p_hackathon: body.hackathonMode,
    p_deadline: deadline, p_images: body.imageIds.map(id => validId(id as string)), p_revision: body.revision};
}
export async function projectRequest(req: Request, workspaceId: string) {
  validId(workspaceId);
  const {db} = await authenticate(req);
  if (req.method === "POST") {
    const result = await db.rpc("chair_save_project", {p_workspace: workspaceId, ...projectInput(await readBody(req))});
    if (result.error?.code === "PT409" || result.error?.code === "40001") throw new WorkspaceError(409, "Someone updated this project. Reload it before saving.");
    if (result.error?.code === "42501") throw new WorkspaceError(403, "Only owners can edit. An image may also need uploading again.");
    if (result.error?.code === "22023") throw new WorkspaceError(400, "Check your project details.");
    if (result.error || !result.data) throw new WorkspaceError(503, "Couldn't save project info. Check that project-info.sql has been run.");
    return projectResult(result.data.workspace, result.data.images);
  }
  const [workspace, images] = await Promise.all([
    db.from("chair_workspaces").select("id,name,slug,project_description,project_hackathon,project_deadline,project_revision,project_updated_at").eq("id",workspaceId).maybeSingle(),
    db.from("chair_project_images").select("id,name,mime_type,width,height,size").eq("workspace_id",workspaceId).eq("attached",true).eq("ready",true).order("position"),
  ]);
  if (workspace.error || images.error) throw new WorkspaceError(503, "Project info needs setup. Run project-info.sql in Supabase.");
  if (!workspace.data) throw new WorkspaceError(404,"Project unavailable.");
  return projectResult(workspace.data, images.data ?? []);
}
