import { NextResponse, type NextRequest } from "next/server";

// Each document gets its own nonce. No cached document may reuse this policy.
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const development = process.env.NODE_ENV !== "production";
  const connections = new Set(["'self'", "https://*.supabase.co", "wss://*.supabase.co", "https://challenges.cloudflare.com"]);
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      if (["http:", "https:"].includes(url.protocol)) {
        connections.add(url.origin);
        connections.add(url.origin.replace(/^http/, "ws"));
      }
    } catch { /* Configuration is checked by the release check. */ }
  }
  if (development) connections.add("ws://localhost:*");
  const policy = [
    "default-src 'self'",
    `script-src 'self' https://challenges.cloudflare.com 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${[...connections].join(" ")}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [{
    source: "/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|fonts/).*)",
    missing: [
      { type: "header", key: "next-router-prefetch" },
      { type: "header", key: "purpose", value: "prefetch" },
    ],
  }],
};
