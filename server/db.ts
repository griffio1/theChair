import { currentWorkspace } from "./workspace-context";
// Minimal Supabase access over PostgREST (no SDK needed server-side).
// The dashboard uses @supabase/supabase-js for Realtime; the server only needs plain REST.

function base(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  return { url: `${url}/rest/v1`, key };
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  prefer?: string,
): Promise<T> {
  const { url, key } = base();
  const res = await fetch(`${url}/${path}`, {
    method,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(
      `Supabase ${method} ${path} -> ${res.status}: ${await res.text()}`,
    );
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const scoped = new Set([
  "contracts",
  "messages",
  "conflicts",
  "events",
  "claims",
  "extraction_cache",
]);
function queryFor(table: string, query: string) {
  if (!scoped.has(table)) return query;
  const params = new URLSearchParams(query);
  // Never trust a caller-supplied tenant filter, including duplicates.
  params.set("workspace_id", `eq.${currentWorkspace()}`);
  return params.toString();
}
function rowsFor(table: string, rows: unknown): unknown {
  if (!scoped.has(table)) return rows;
  const id = currentWorkspace();
  const wrap = (row: any) => ({ ...row, workspace_id: id });
  return Array.isArray(rows) ? rows.map(wrap) : wrap(rows);
}
export const select = <T>(table: string, query = "") =>
  req<T[]>("GET", `${table}?${queryFor(table, query)}`);
export const insert = <T>(table: string, rows: unknown) =>
  req<T[]>("POST", table, rowsFor(table, rows), "return=representation");
export const upsert = <T>(table: string, rows: unknown) =>
  req<T[]>(
    "POST",
    table,
    rowsFor(table, rows),
    "return=representation,resolution=merge-duplicates",
  );
export const update = <T>(table: string, query: string, patch: unknown) =>
  req<T[]>(
    "PATCH",
    `${table}?${queryFor(table, query)}`,
    rowsFor(table, patch),
    "return=representation",
  );
