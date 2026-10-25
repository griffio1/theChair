import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

test("document policy generates fresh nonces and prevents framing and shared caching",()=>{
  const request=new NextRequest("https://example.com/workspaces",{headers:{"x-nonce":"attacker"}});
  const first=middleware(request),second=middleware(request);
  const policy=first.headers.get("content-security-policy")!;
  assert.match(policy,/nonce-[A-Za-z0-9+/=]+/);
  assert.notEqual(policy,second.headers.get("content-security-policy"));
  assert.ok(!policy.includes("attacker"));
  assert.match(policy,/frame-ancestors 'none'/);
  assert.match(policy,/object-src 'none'/);
  assert.match(policy,/base-uri 'none'/);
  assert.match(policy,/wss:\/\/\*\.supabase.co/);
  assert.equal(first.headers.get("cache-control"),"private, no-store");
  assert.equal(first.headers.get("x-middleware-request-content-security-policy"),policy);
});
