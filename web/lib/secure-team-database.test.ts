import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("legacy ledger is accessible only to members of its explicit workspace", async () => {
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
    await db.exec("set role anon");
    for (const table of [
      "contracts",
      "messages",
      "conflicts",
      "events",
      "claims",
      "extraction_cache",
      "chair_agent_credentials",
      "chair_legacy_binding",
    ])
      await assert.rejects(
        db.query(`select * from public.${table}`),
        /permission denied/,
      );
    async function asUser(id: string) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    }
    await asUser(outsider);
    for (const table of [
      "contracts",
      "messages",
      "conflicts",
      "events",
      "claims",
      "chair_legacy_binding",
    ])
      assert.equal(
        (await db.query(`select * from public.${table}`)).rows.length,
        0,
        `outsider cannot read ${table}`,
      );
    for (const id of [owner, member]) {
      await asUser(id);
      for (const table of [
        "contracts",
        "messages",
        "conflicts",
        "events",
        "claims",
        "chair_legacy_binding",
      ])
        assert.equal(
          (await db.query(`select * from public.${table}`)).rows.length,
          1,
          `team member can read ${table}`,
        );
      await assert.rejects(
        db.query("select * from public.chair_agent_credentials"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("delete from public.messages"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("delete from public.chair_legacy_binding"),
        /permission denied/,
      );
    }
    await db.exec("reset role");
    await db.query("delete from public.chair_memberships where user_id=$1", [
      member,
    ]);
    await asUser(member);
    assert.equal(
      (await db.query("select * from public.messages")).rows.length,
      0,
      "removed member loses database access",
    );
    await db.exec("reset role; set role service_role");
    assert.equal(
      (await db.query("select * from public.messages")).rows.length,
      1,
      "authenticated server jobs retain ledger access",
    );
  } finally {
    await db.close();
  }
});
