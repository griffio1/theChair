"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import TeamDashboard from "./team-dashboard";

type Access = {
  userId: string;
  workspaceId: string;
  name: string;
  workspaceName: string;
  owner: boolean;
};

export default function TeamAccess({
  workspaceId: requested,
}: {
  workspaceId?: string;
}) {
  const [userId, setUserId] = useState<string | null>();
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      eventReceived = false;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      eventReceived = true;
      if (active) setUserId(session?.user.id ?? null);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (active && !eventReceived) setUserId(data.session?.user.id ?? null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (userId === undefined) return;
    if (!userId) {
      setAccess(null);
      location.replace("/workspaces");
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        let workspaceId = requested;
        if (!workspaceId) {
          const binding = await supabase
            .from("chair_legacy_binding")
            .select("workspace_id")
            .maybeSingle();
          if (binding.error || !binding.data)
            throw new Error(
              "Select your workspace to open its team dashboard.",
            );
          workspaceId = binding.data.workspace_id;
        }
        const [member, workspace] = await Promise.all([
          supabase
            .from("chair_memberships")
            .select("display_name,role")
            .eq("workspace_id", workspaceId)
            .eq("user_id", userId!)
            .single(),
          supabase
            .from("chair_workspaces")
            .select("name")
            .eq("id", workspaceId)
            .single(),
        ]);
        if (member.error || workspace.error)
          throw new Error("Your membership could not be verified.");
        if (active) {
          setAccess({
            userId: userId!,
            workspaceId: workspaceId!,
            name: member.data.display_name,
            workspaceName: workspace.data.name,
            owner: member.data.role === "owner",
          });
          setError("");
        }
      } catch (e) {
        if (active) {
          setAccess(null);
          setError(e instanceof Error ? e.message : "Access unavailable.");
        }
      } finally {
        if (active) timer = setTimeout(check, 10000);
      }
    }
    void check();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [userId, requested]);
  if (
    !access ||
    access.userId !== userId ||
    (requested && access.workspaceId !== requested)
  )
    return (
      <main className="dashboard">
        <h1>Team agreements</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Checking your workspace membership…"}
        </p>
        <a href="/workspaces">Back to your workspaces</a>
      </main>
    );
  return (
    <TeamDashboard
      key={`${userId}:${access.workspaceId}`}
      workspaceId={access.workspaceId}
      userId={access.userId}
      name={access.name}
      workspaceName={access.workspaceName}
      canApprove={access.owner}
    />
  );
}
