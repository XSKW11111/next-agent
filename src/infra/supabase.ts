import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AgentConfig } from "@/infra/agent-config";

export function createAgentSupabase(config: AgentConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
