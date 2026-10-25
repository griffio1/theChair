import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { approvalDatabase } from "./approval-publishing-fixture";

test("approval transactions isolate workspaces, fence leases, recover and finalize once", async () => {
  const db = await approvalDatabase();
  const a = randomUUID(), b = randomUUID(), lease = randomUUID(), replacement = randomUUID();
  const base = "a".repeat(40), sha = "b".repeat(40), key = "contract:login@2";
  const query = async (sql: string, values: unknown[] = []) => (await db.query<{ result: any }>(sql, values)).rows[0]?.result;
  const take = (workspace = a, id = "login", version = 2, token = lease) => query("select chair_take_approval($1,'contract',$2,$3,'Owner',$4) result", [workspace, id, version, token]);
  const stage = (token = lease, candidate: unknown = { branch: "main", baseSha: base, sha }) => query("select chair_stage_approval($1,$2,$3,$4) result", [a, key, token, candidate]);
  const finish = (token = lease, commit = sha) => query("select chair_finish_approval($1,$2,$3,$4) result", [a, key, token, commit]);
  try {
    await db.query("insert into chair_workspaces values($1),($2)", [a, b]);
    await db.query(`insert into contracts(workspace_id,id,version,name,method,path,status)
      select w,'login',v,'Login','POST','/login',case when v=1 then 'approved' else 'proposed' end
      from unnest($1::uuid[])w cross join generate_series(1,3)v`, [[a, b]]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(take(), /permission denied/);
      await assert.rejects(db.query("select * from chair_approval_jobs"), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    const job = await take();
    assert.equal(job.contract.version, 2); assert.equal(job.contract.status, "approved");
    assert.equal(job.contract.workspace_id, undefined); assert.equal(job.contract.created_at, undefined);
    await assert.rejects(take(a, "login", 2, replacement), /running/);
    await assert.rejects(take(a, "login", 3), /Finish the pending/);
    assert.equal((await take(b)).workspace_id, b, "other workspaces can publish independently");
    await assert.rejects(stage(replacement), /lease expired/);
    await assert.rejects(finish(), /not confirmed/);
    await stage();
    await db.query("select chair_release_approval($1,$2,$3)", [a, key, replacement]);
    await assert.rejects(take(a, "login", 2, replacement), /running/, "wrong worker cannot release");
    await db.query("update chair_approval_jobs set lease_until=now()-interval '1 second' where workspace_id=$1", [a]);
    const resumed = await take(a, "login", 2, replacement);
    assert.equal(resumed.candidate_sha, sha, "crash recovery preserves the candidate");
    await assert.rejects(stage(), /lease expired/);
    await assert.rejects(finish(), /lease expired/);
    await assert.rejects(db.query("select chair_cancel_approval($1,$2)", [a, key]), /Review the active or saved/);
    await assert.rejects(finish(replacement, "c".repeat(40)), /not confirmed/);
    const done = await finish(replacement);
    assert.equal(done.status, "complete"); assert.equal(done.commit_sha, sha);
    assert.equal((await take()).commit_sha, sha, "same request replays its original result");
    await finish(replacement);
    await db.exec("reset role");
    assert.equal(await query("select count(*)::int result from events where workspace_id=$1", [a]), 1);
    assert.equal(await query("select count(*)::int result from messages where workspace_id=$1", [a]), 1);
    assert.equal(await query("select status result from contracts where workspace_id=$1 and version=1", [a]), "superseded");
    assert.equal(await query("select status result from contracts where workspace_id=$1 and version=2", [a]), "approved");
    assert.equal(await query("select status result from contracts where workspace_id=$1 and version=1", [b]), "approved");
    await assert.rejects(take(a, "login", 1), /newer agreement/);

    // A failed final transaction must not partially change the ledger.
    const third = await take(a, "login", 3);
    await db.query("select chair_stage_approval($1,$2,$3,$4)", [a, third.operation_key, lease, { branch: "main", baseSha: sha, sha: "c".repeat(40) }]);
    await db.exec("alter table events add constraint fail_event check(type<>'approval') not valid");
    await assert.rejects(db.query("select chair_finish_approval($1,$2,$3,$4)", [a, third.operation_key, lease, "c".repeat(40)]), /fail_event/);
    assert.equal(await query("select status result from contracts where workspace_id=$1 and version=2", [a]), "approved");
    assert.equal(await query("select status result from contracts where workspace_id=$1 and version=3", [a]), "proposed");
    await db.exec("alter table events drop constraint fail_event");
    await db.query("select chair_release_approval($1,$2,$3)", [b, key, lease]);
    await db.query("select chair_cancel_approval($1,$2)", [b, key]);
    assert.equal((await take(b, "login", 3)).target_version, 3, "operator can abandon a never-published job");
  } finally { await db.close(); }
});

test("approvals refuse newer ledger versions and close agreement-free issues without GitHub", async () => {
  const db = await approvalDatabase(), w = randomUUID(), issue = randomUUID(), lease = randomUUID();
  try {
    await db.query("insert into chair_workspaces values($1)", [w]);
    await db.query("insert into conflicts(id,workspace_id,kind,severity,summary,detected_by) values($1,$2,'overlap','warn','Overlap','preflight')", [issue, w]);
    const job = (await db.query<{ result: any }>("select chair_take_approval($1,'conflict',$2,null,'Owner',$3) result", [w, issue, lease])).rows[0].result;
    assert.equal(job.contract, null);
    await db.query("select chair_finish_approval($1,$2,$3,null)", [w, job.operation_key, lease]);
    assert.equal((await db.query<{ status: string }>("select status from conflicts where id=$1", [issue])).rows[0].status, "approved");
    await db.query("insert into contracts(workspace_id,id,version,name,method,path,status) values($1,'login',1,'Login','POST','/login','proposed')", [w]);
    await db.query("select chair_take_approval($1,'contract','login',1,'Owner',$2)", [w, lease]);
    await db.query("insert into contracts(workspace_id,id,version,name,method,path,status) values($1,'login',2,'Login','POST','/login','approved')", [w]);
    await assert.rejects(db.query("select chair_stage_approval($1,'contract:login@1',$2,$3)", [w, lease, { branch: "main", baseSha: "a".repeat(40), sha: "b".repeat(40) }]), /newer agreement/);
    await db.query("select chair_release_approval($1,'contract:login@1',$2)", [w, lease]);
    await assert.rejects(db.query("select chair_stage_approval($1,'contract:login@1',null,$2)", [w, { branch: "main", baseSha: "a".repeat(40), sha: "b".repeat(40) }]), /lease expired/);
  } finally { await db.close(); }
});
