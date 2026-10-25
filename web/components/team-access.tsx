"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { workspaceHref } from "../lib/workspace-navigation";

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
      location.replace(workspaceHref(requested ?? ""));
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
              "Choose a workspace to open team chat.",
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
          throw new Error("We couldn't open this workspace.");
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
          setError(e instanceof Error ? e.message : "We couldn't open this workspace.");
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
  useEffect(() => {
    if (access && access.userId === userId && (!requested || access.workspaceId === requested)) {
      location.replace(workspaceHref(access.workspaceId));
    }
  }, [access, userId, requested]);
  if (
    !access ||
    access.userId !== userId ||
    (requested && access.workspaceId !== requested)
  )
    return (
      <main className="dashboard">
        <h1>Team chat</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Checking access…"}
        </p>
        <a href="/workspaces">Choose a workspace</a>
      </main>
    );
  return <main className="dashboard"><p role="status">Opening workspace…</p></main>;
}
