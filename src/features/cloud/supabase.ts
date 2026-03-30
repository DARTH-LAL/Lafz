import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedServerClient: SupabaseClient | null | undefined;

function readSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

  if (!url || !serviceRoleKey) {
    return null;
  }

  return {
    url,
    serviceRoleKey
  };
}

export function isSupabaseConfigured() {
  return readSupabaseConfig() !== null;
}

export function getSupabaseServerClient() {
  if (cachedServerClient !== undefined) {
    return cachedServerClient;
  }

  const config = readSupabaseConfig();

  if (!config) {
    cachedServerClient = null;
    return cachedServerClient;
  }

  cachedServerClient = createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return cachedServerClient;
}
