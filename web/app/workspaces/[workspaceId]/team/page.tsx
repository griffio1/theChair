import { redirect } from "next/navigation";
import { workspaceHref } from "../../../../lib/workspace-navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  redirect(workspaceHref(workspaceId));
}
