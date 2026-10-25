import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Use the real ledger schema, then apply its workspace keys before testing the migration.
export async function approvalDatabase() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create publication supabase_realtime;");
  await db.exec(await readFile(new URL("../../supabase/schema.sql", import.meta.url), "utf8"));
  await db.exec(`delete from contracts;
    create table chair_workspaces(id uuid primary key);
    alter table contracts drop constraint contracts_pkey;
    alter table contracts add column workspace_id uuid not null references chair_workspaces(id);
    alter table contracts add primary key(workspace_id,id,version);
    alter table conflicts add column workspace_id uuid not null references chair_workspaces(id);
    alter table events add column workspace_id uuid not null references chair_workspaces(id);
    alter table messages add column workspace_id uuid not null references chair_workspaces(id);`);
  const sql = await readFile(new URL("../sql/approval-publishing.sql", import.meta.url), "utf8");
  await db.exec(sql);
  await db.exec(sql);
  return db;
}
