export function publicSiteOrigin(
  requestUrl: string,
  configured?: string,
): string {
  const origin = new URL(requestUrl);
  if (!configured) return origin.origin;
  const target = new URL(configured);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password
  )
    throw new Error("Configure a public HTTP(S) site URL without credentials.");
  return target.origin;
}

export function shareUrl(path: string, requestUrl: string): string {
  const request = new URL(requestUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(request.hostname);
  const configured =
    process.env.THECHAIR_PUBLIC_URL ||
    (local ? process.env.THECHAIR_API_URL : undefined);
  return new URL(path, publicSiteOrigin(requestUrl, configured)).href;
}
