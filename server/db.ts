// Minimal Supabase access over PostgREST (no SDK needed server-side).
// The dashboard uses @supabase/supabase-js for Realtime; the server only needs plain REST.

function base(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  return { url: `${url}/rest/v1`, key };
}

async function req<T>(method: string, path: string, body?: unknown, prefer?: string): Promise<T> {
  const { url, key } = base();
  const res = await fetch(`${url}/${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** e.g. select("contracts", "status=eq.approved&order=version.desc") */
export const select = <T>(table: string, query = "") => req<T[]>("GET", `${table}?${query}`);
export const insert = <T>(table: string, rows: unknown) =>
  req<T[]>("POST", table, rows, "return=representation");
export const upsert = <T>(table: string, rows: unknown) =>
  req<T[]>("POST", table, rows, "return=representation,resolution=merge-duplicates");
export const update = <T>(table: string, query: string, patch: unknown) =>
  req<T[]>("PATCH", `${table}?${query}`, patch, "return=representation");
