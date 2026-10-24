import { createClient } from "@supabase/supabase-js";

// Browser client (anon key) for Realtime. Server code uses /server/db.ts with the service key.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
