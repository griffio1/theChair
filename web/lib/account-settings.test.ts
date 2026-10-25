import test from "node:test";
import assert from "node:assert/strict";
import {accountError,accountName,profileError,profileFields} from "./account-settings";

test("nickname overrides display name and removing it restores the display name",()=>{
  assert.equal(accountName({displayName:"Carter",nickname:" CJ "}),"CJ");
  assert.equal(accountName({displayName:"Carter",nickname:""}),"Carter");
  assert.equal(accountName({displayName:{role:"owner"},nickname:42},"carter@example.com"),"carter");
  assert.deepEqual(profileFields(null),{displayName:"",nickname:""});
});
test("profile edits require bounded names and reject control characters",()=>{
  assert.equal(profileError("Carter de Streel",""),"");
  assert(profileError("  ","CJ"));
  assert(profileError("Carter","a".repeat(81)));
  assert(profileError("Carter\nOther",""));
});
test("account errors distinguish verification and rate limits without leaking provider details",()=>{
  assert.match(accountError({code:"reauthentication_needed"}),/Verify your email/);
  assert.match(accountError({code:"reauthentication_not_valid"}),/invalid or expired/);
  assert.match(accountError({status:429}),/Wait a few minutes/);
  assert.match(accountError({code:"current_password_invalid"}),/current password/);
  assert.equal(accountError({status:500,code:"database_details"}),"Couldn't save the change. Try again.");
});
