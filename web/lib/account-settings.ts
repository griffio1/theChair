type Metadata = Record<string, unknown> | null | undefined;
export function profileFields(metadata: Metadata, email?: string) {
  return {
    displayName: typeof metadata?.displayName === "string" ? metadata.displayName : email?.split("@")[0] ?? "",
    nickname: typeof metadata?.nickname === "string" ? metadata.nickname : "",
  };
}
export function accountName(metadata: Metadata, email?: string) {
  const fields=profileFields(metadata,email);
  return fields.nickname.trim().slice(0,80) || fields.displayName.trim().slice(0,80) || "You";
}
export function profileError(displayName: string,nickname: string) {
  if (!displayName.trim()) return "Enter a display name.";
  if (displayName.trim().length>80 || nickname.trim().length>80) return "Use no more than 80 characters for each name.";
  if (/[\u0000-\u001f\u007f]/.test(displayName+nickname)) return "Use a single line for each name.";
  return "";
}
export function accountError(error: {status?: number;code?: string} | null | undefined) {
  if (error?.status===429 || error?.code=== "over_email_send_rate_limit" || error?.code=== "over_request_rate_limit") return "Too many attempts. Wait a few minutes and try again.";
  switch (error?.code) {
    case "same_password": return "Choose a different password.";
    case "weak_password": return "Use a stronger password.";
    case "current_password_invalid": case "invalid_credentials": return "Your current password is incorrect.";
    case "current_password_required": return "Enter your current password.";
    case "reauthentication_needed": return "Verify your email before changing your password.";
    case "reauthentication_not_valid": case "otp_expired": return "That code is invalid or expired. Request another.";
    case "email_exists": case "email_address_invalid": return "That email can't be used. Try another.";
    case "session_not_found": case "refresh_token_not_found": return "Sign in again to update your account.";
    default: return error?.status===401 ? "Sign in again to update your account." : "Couldn't save the change. Try again.";
  }
}
