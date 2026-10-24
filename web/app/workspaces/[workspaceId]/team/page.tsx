import TeamAccess from "../../../../components/team-access";
export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <TeamAccess workspaceId={workspaceId} />;
}
