export const RECOVERY_LINK_ERROR = "This link is invalid or expired. Request a new one.";
export const RECOVERY_REQUEST_ERROR = "Couldn’t send the request. Try again in a moment.";
export type RecoveryLink = "none" | "callback" | "invalid";
export type RecoveryUser = { id: string; email?: string };
export type RecoveryState = {
  mode: "loading" | "request" | "sent" | "update" | "complete";
  user: RecoveryUser | null;
  error: string;
};

/** Classifies the link without retaining or returning any credentials. */
export function recoveryLink(search: string, hash: string): RecoveryLink {
  const params = new URLSearchParams(search);
  new URLSearchParams(hash.replace(/^#/, "")).forEach((value, key) => params.set(key, value));
  if (["error", "error_code", "error_description"].some(key => params.has(key))) return "invalid";
  // The shared browser client uses the implicit flow, not PKCE. The SDK ignores
  // a code without a verifier; never mistake its retained session for recovery.
  if (params.has("code")) return "invalid";
  const keys = ["access_token", "refresh_token", "expires_in", "token_type"];
  if (keys.some(key => params.has(key)) || params.has("type") || params.has("token_hash")) {
    return params.get("type") === "recovery" && keys.every(key => !!params.get(key))
      && Number(params.get("expires_in")) > 0 ? "callback" : "invalid";
  }
  return "none";
}

export function initialRecoveryState(link: RecoveryLink, user: RecoveryUser | null, failed = false): RecoveryState {
  if (link === "invalid" || failed || (link === "callback" && !user))
    return {mode:"request",user:null,error:RECOVERY_LINK_ERROR};
  return {mode:user ? "update" : "request",user,error:""};
}

/** Late initialization and routine token refreshes must not undo a completed action. */
export function recoveryAuthEvent(state: RecoveryState, event: string, user: RecoveryUser | null): RecoveryState {
  if (event === "INITIAL_SESSION")
    return state.mode === "loading" ? initialRecoveryState("none",user) : state;
  if (event === "PASSWORD_RECOVERY" && user) return {mode:"update",user,error:""};
  if (event === "SIGNED_OUT")
    return state.mode === "complete" || state.mode === "sent" ? {...state,user:null}
      : {mode:"request",user:null,error:state.mode === "update" ? RECOVERY_LINK_ERROR : ""};
  if (event === "SIGNED_IN" && user && (state.mode === "loading" || (state.user && state.user.id !== user.id)))
    return {mode:"update",user,error:""};
  return state;
}

export function recoveryPasswordError(password: string, confirmation: string): string {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 128) return "Use no more than 128 characters.";
  if (password !== confirmation) return "Passwords don’t match.";
  return "";
}

/** Report delivery outages without revealing account-specific provider responses. */
export function recoveryRequestError(error: {status?: number;code?: string;name?: string} | null): string {
  if (!error) return "";
  if (error.code === "captcha_failed") return "Verification failed. Please try again.";
  if (error.status === 429) return "Too many attempts. Wait a few minutes and try again.";
  if (!error.status || error.status >= 500 || error.name === "AuthRetryableFetchError" || error.code === "request_timeout")
    return RECOVERY_REQUEST_ERROR;
  return "";
}
