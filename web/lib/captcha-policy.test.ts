import test from "node:test";
import assert from "node:assert/strict";
import { captchaProof, captchaSubmissionError, CAPTCHA_LIFETIME_MS, CAPTCHA_REQUIRED } from "./captcha-policy";

test("without a site key every auth flow works, including signup", () => {
  for (const action of ["signup","signin","recovery"] as const) {
    assert.equal(captchaSubmissionError(action,"",null),"");
    assert.equal(captchaSubmissionError(action,"  ",null),"");
  }
});

test("every configured auth flow requires a fresh token, including in development", () => {
  const issuedAt = 1_000;
  const proof = captchaProof("example",issuedAt);
  for (const action of ["signup","signin","recovery"] as const) {
    assert.equal(captchaSubmissionError(action,"site-key",null,issuedAt),CAPTCHA_REQUIRED);
    assert.equal(captchaSubmissionError(action,"site-key",proof,issuedAt),"");
    assert.equal(captchaSubmissionError(action,"site-key",proof,issuedAt + CAPTCHA_LIFETIME_MS),CAPTCHA_REQUIRED);
  }
});

test("empty or oversized provider responses never become usable tokens", () => {
  assert.equal(captchaProof(""),null);
  assert.equal(captchaProof("a".repeat(2049)),null);
});
