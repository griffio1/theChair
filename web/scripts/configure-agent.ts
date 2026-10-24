// From repo root, with local env loaded:
// node --env-file=web/.env.local --import tsx web/scripts/configure-agent.ts OWNER_USER_ID LABEL
// Requires server admin credentials. Writes the agent token only to ignored web/.env.local.
import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const [ownerId, label] = process.argv.slice(2);
  if (!/^[0-9a-f-]{36}$/i.test(ownerId ?? "") || !label?.trim())
    throw new Error("Pass the workspace owner's user ID and an agent label.");
  const db = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const binding = await db
    .from("chair_legacy_binding")
    .select("workspace_id")
    .single();
  if (binding.error)
    throw new Error("Run secure-team.sql before configuring the agent.");
  const owner = await db
    .from("chair_memberships")
    .select("role")
    .eq("workspace_id", binding.data.workspace_id)
    .eq("user_id", ownerId)
    .eq("role", "owner")
    .maybeSingle();
  if (owner.error || !owner.data)
    throw new Error(
      "The specified account is not an owner of the team workspace.",
    );
  const token =
    process.env.THECHAIR_AGENT_TOKEN || randomBytes(32).toString("hex");
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error(
      "Existing agent credential is malformed. Remove it from the ignored env file to generate a new one.",
    );
  const result = await db
    .from("chair_agent_credentials")
    .upsert(
      {
        workspace_id: binding.data.workspace_id,
        issued_by: ownerId,
        label: label.trim(),
        token_hash: createHash("sha256").update(token).digest("hex"),
        expires_at: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        revoked_at: null,
      },
      { onConflict: "token_hash" },
    );
  if (result.error) throw new Error("Could not register the agent credential.");
  const path = new URL("../.env.local", import.meta.url);
  let env = await readFile(path, "utf8");
  env = /^THECHAIR_AGENT_TOKEN=.*$/m.test(env)
    ? env.replace(/^THECHAIR_AGENT_TOKEN=.*$/m, `THECHAIR_AGENT_TOKEN=${token}`)
    : `${env.trimEnd()}\nTHECHAIR_AGENT_TOKEN=${token}\n`;
  await writeFile(path, env);
  console.log(
    "Agent credential registered for 30 days and saved in ignored web/.env.local. Its value was not printed.",
  );
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Agent setup failed");
  process.exitCode = 1;
});
