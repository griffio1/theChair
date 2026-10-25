import test from "node:test";
import assert from "node:assert/strict";
import { initialRecoveryState, recoveryAuthEvent, recoveryLink, recoveryPasswordError, recoveryRequestError, RECOVERY_LINK_ERROR, RECOVERY_REQUEST_ERROR } from "./password-recovery-state";

const user = {id:"test-user",email:"user@example.test"};
test("recovery links reject missing credentials, errors and unrelated auth types", () => {
  assert.equal(recoveryLink("",""),"none");
  assert.equal(recoveryLink("","#type=recovery"),"invalid");
  assert.equal(recoveryLink("?code=",""),"invalid");
  assert.equal(recoveryLink("?code=example",""),"invalid");
  assert.equal(recoveryLink("","#access_token=example&refresh_token=example&expires_in=3600&token_type=bearer&type=signup"),"invalid");
  assert.equal(recoveryLink("","#access_token=example&refresh_token=example&expires_in=3600&token_type=bearer&type=recovery"),"callback");
  assert.equal(recoveryLink("?error=expired","#access_token=example&type=recovery"),"invalid");
  assert.equal(recoveryLink("","#error_description=sensitive-provider-details"),"invalid");
});
test("a failed recovery link cannot silently use another existing session", () => {
  assert.deepEqual(initialRecoveryState("invalid",user),{mode:"request",user:null,error:RECOVERY_LINK_ERROR});
  assert.equal(initialRecoveryState("callback",user,true).mode,"request");
  assert.equal(initialRecoveryState("callback",null).error,RECOVERY_LINK_ERROR);
  assert.equal(initialRecoveryState("none",user).mode,"update");
});
test("recovery event wins over a late initial session; sign-out removes the update form", () => {
  const update = recoveryAuthEvent({mode:"loading",user:null,error:""},"PASSWORD_RECOVERY",user);
  assert.equal(update.mode,"update");
  assert.equal(recoveryAuthEvent(update,"INITIAL_SESSION",null),update);
  assert.deepEqual(recoveryAuthEvent(update,"SIGNED_OUT",null),{mode:"request",user:null,error:RECOVERY_LINK_ERROR});
});
test("normal auth refreshes preserve the email confirmation and password success screens", () => {
  const sent = {mode:"sent" as const,user:null,error:""};
  const complete = {mode:"complete" as const,user,error:""};
  assert.equal(recoveryAuthEvent(sent,"TOKEN_REFRESHED",user),sent);
  assert.equal(recoveryAuthEvent(complete,"USER_UPDATED",user),complete);
  assert.equal(recoveryAuthEvent(complete,"SIGNED_IN",user),complete);
  assert.equal(recoveryAuthEvent(complete,"SIGNED_OUT",null).mode,"complete");
});
test("password validation enforces length and exact confirmation without trimming", () => {
  assert.equal(recoveryPasswordError("short","short"),"Use at least 8 characters.");
  assert.equal(recoveryPasswordError("a".repeat(129),"a".repeat(129)),"Use no more than 128 characters.");
  assert.equal(recoveryPasswordError(" a password ","a password"),"Passwords don’t match.");
  assert.equal(recoveryPasswordError(" a password "," a password "),"");
});

test("reset outages request a retry while account-specific outcomes stay indistinguishable", () => {
  assert.equal(recoveryRequestError(null),"");
  assert.equal(recoveryRequestError({status:400,code:"user_not_found"}),"");
  assert.equal(recoveryRequestError({status:400,code:"email_not_confirmed"}),"");
  assert.equal(recoveryRequestError({status:503}),RECOVERY_REQUEST_ERROR);
  assert.equal(recoveryRequestError({status:0,name:"AuthRetryableFetchError"}),RECOVERY_REQUEST_ERROR);
  assert.match(recoveryRequestError({status:429}),/Too many attempts/);
  assert.match(recoveryRequestError({status:400,code:"captcha_failed"}),/Verification failed/);
});
