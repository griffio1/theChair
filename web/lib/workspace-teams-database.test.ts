import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("workspace ledger migration preserves history and isolates independent teams", async () => {
  const db = new PGlite();
  const owner = "10000000-0000-4000-8000-000000000001";
  const member = "10000000-0000-4000-8000-000000000002";
  const outsider = "10000000-0000-4000-8000-000000000003";
  const team = "cb57bef0-6a3d-4967-a0e2-4dc2982f78ff";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated; create publication supabase_realtime;`);
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values ($1,'owner@example.com',now()),($2,'member@example.com',now()),($3,'outsider@example.com',now())",
      [owner, member, outsider],
    );
    await db.exec(
      await readFile(
        new URL("../../supabase/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(new URL("../sql/workspaces.sql", import.meta.url), "utf8"),
    );
    await db.query(
      "insert into public.chair_workspaces(id,name,created_by) values ($1,'Test67',$2)",
      [team, owner],
    );
    await db.query(
      "insert into public.chair_memberships(workspace_id,user_id,display_name,role) values ($1,$2,'Owner','owner'),($1,$3,'Member','member')",
      [team, owner, member],
    );
    await db.exec(`insert into public.messages(author_type,author_name,kind,body) values ('human','Owner','text','private plan');
      insert into public.conflicts(kind,severity,summary,detected_by) values ('field_mismatch','block','private conflict','preflight');
      insert into public.events(type,summary) values ('push','private push');
      insert into public.claims(agent,developer,paths,intent) values ('codex','carter','{}','private intent');
      grant select on contracts,messages,conflicts,events,claims to anon,authenticated;`);
    const sql = await readFile(
      new URL("../sql/secure-team.sql", import.meta.url),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    const migration = await readFile(
      new URL("../sql/workspace-teams.sql", import.meta.url),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    const other = "20000000-0000-4000-8000-000000000002";
    await db.query(
      "insert into chair_workspaces(id,name,created_by) values($1,'Other',$2)",
      [other, outsider],
    );
    await db.query(
      "insert into chair_memberships(workspace_id,user_id,display_name,role) values($1,$2,'Other owner','owner')",
      [other, outsider],
    );
    await db.query(
      "insert into contracts(workspace_id,id,version,name,method,path,status) values($1,'auth-login',1,'Different login','GET','/private','approved')",
      [other],
    );
    await db.query(
      "insert into messages(workspace_id,author_type,author_name,kind,body) values($1,'human','Other','text','other secret')",
      [other],
    );
    await db.query(
      "insert into chair_repository_connections(workspace_id,repository_id,repository,token,webhook_secret,connected_by) values($1,42,'owner/repo','private-token','private-secret',$2)",
      [team, owner],
    );
    await assert.rejects(
      db.query(
        "update chair_repository_connections set repository_id=43 where workspace_id=$1",
        [team],
      ),
      /cannot be reassigned/,
    );
    await assert.rejects(
      db.query(
        "insert into chair_repository_connections(workspace_id,repository_id,repository,token,webhook_secret,connected_by) values($1,42,'owner/repo','token','secret',$2)",
        [other, outsider],
      ),
      /duplicate key/,
    );
    for (const [user, expected] of [
      [owner, team],
      [member, team],
      [outsider, other],
    ]) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user,
      ]);
      await db.exec("set role authenticated");
      for (const table of [
        "contracts",
        "messages",
        "conflicts",
        "events",
        "claims",
      ]) {
        const rows = (
          await db.query<{ workspace_id: string }>(`select * from ${table}`)
        ).rows;
        assert.ok(
          rows.every((r) => r.workspace_id === expected),
          `${table} is isolated`,
        );
      }
      assert.equal(
        (await db.query("select * from contracts")).rows.length,
        1,
        "same contract ID may exist in both teams",
      );
      await assert.rejects(
        db.query("select * from chair_repository_connections"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select * from chair_agent_credentials"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("delete from messages"),
        /permission denied/,
      );
      await db.exec("reset role");
    }
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select * from messages"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query("delete from chair_memberships where user_id=$1", [
      outsider,
    ]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      outsider,
    ]);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select * from messages")).rows.length, 0);
  } finally {
    await db.close();
  }
});
