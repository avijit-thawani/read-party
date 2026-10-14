import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ReadParty: shared Supabase client used only by the sync layer.
// The anon/publishable key is public by design; safe to ship in the bundle.
// Values come from CRA env vars, with a hardcoded fallback so the feature
// works even if the dev server was started before .env existed.
const SUPABASE_URL =
  process.env.REACT_APP_SUPABASE_URL ||
  "https://dybkwbhxozwvdxfhdtfz.supabase.co";

const SUPABASE_ANON_KEY =
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5Ymt3Ymh4b3p3dmR4ZmhkdGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NDk2OTQsImV4cCI6MjA5ODIyNTY5NH0.-XMuK4KskVF3sRP9kfjXqjplLx1CZ1QsvZtHy4rnKPA";

let client: SupabaseClient | null = null;

export const getSupabase = (): SupabaseClient => {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
};
