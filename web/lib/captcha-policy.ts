export type CaptchaAction = "signup" | "signin" | "recovery";
export type CaptchaProof = { token: string; expiresAt: number } | null;

export const CAPTCHA_REQUIRED = "Complete the verification below.";
// Cloudflare tokens last five minutes. Leave time for the request to reach Supabase.
export const CAPTCHA_LIFETIME_MS = 290_000;

export function captchaProof(token: string, now = Date.now()): CaptchaProof {
  return token && token.length <= 2048 ? {token,expiresAt:now + CAPTCHA_LIFETIME_MS} : null;
}

/** Verification is optional: with no site key every flow works without it. When a key is set,
 * this is a UX guard only; Supabase must also enforce CAPTCHA using its private provider secret. */
export function captchaSubmissionError(
  action: CaptchaAction, siteKey: string, proof: CaptchaProof, now = Date.now(),
): string {
  if (siteKey.trim() && (!proof?.token || proof.expiresAt <= now)) return CAPTCHA_REQUIRED;
  return "";
}
