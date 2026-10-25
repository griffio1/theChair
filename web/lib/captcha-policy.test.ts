import test from "node:test";
import assert from "node:assert/strict";
import { captchaProof, captchaSubmissionError, CAPTCHA_LIFETIME_MS, CAPTCHA_REQUIRED, CAPTCHA_UNAVAILABLE } from "./captcha-policy";

test("production signup fails closed without a configured site key, even with a token", () => {
  assert.equal(captchaSubmissionError("signup","",true,null),CAPTCHA_UNAVAILABLE);
  assert.equal(captchaSubmissionError("signup","  ",true,captchaProof("example")),CAPTCHA_UNAVAILABLE);
});

test("missing configuration leaves existing sign-in and local development usable", () => {
  assert.equal(captchaSubmissionError("signin","",true,null),"");
  assert.equal(captchaSubmissionError("recovery","",true,null),"");
  assert.equal(captchaSubmissionError("signup","",false,null),"");
});

test("every configured auth flow requires a fresh token, including in development", () => {
  const issuedAt = 1_000;
  const proof = captchaProof("example",issuedAt);
  for (const action of ["signup","signin","recovery"] as const) {
    assert.equal(captchaSubmissionError(action,"site-key",true,null,issuedAt),CAPTCHA_REQUIRED);
    assert.equal(captchaSubmissionError(action,"site-key",false,null,issuedAt),CAPTCHA_REQUIRED);
    assert.equal(captchaSubmissionError(action,"site-key",true,proof,issuedAt),"");
    assert.equal(captchaSubmissionError(action,"site-key",true,proof,issuedAt + CAPTCHA_LIFETIME_MS),CAPTCHA_REQUIRED);
  }
});

test("empty or oversized provider responses never become usable tokens", () => {
  assert.equal(captchaProof(""),null);
  assert.equal(captchaProof("a".repeat(2049)),null);
});
