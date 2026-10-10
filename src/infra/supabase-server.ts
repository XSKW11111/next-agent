import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AgentConfig } from "./agent-config";

export function supabaseServerClient(config: AgentConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
