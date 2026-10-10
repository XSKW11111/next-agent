import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScriptedModel } from "@/service/agent/support-turn";
import type { AgentConfig } from "./agent-config";
import { openRouterModel } from "./open-router-model";
import { supabaseServerClient } from "./supabase-server";

export function liveAgentParts(config: AgentConfig): {
  readonly model: ScriptedModel;
  readonly supabase: SupabaseClient;
  readonly config: AgentConfig;
} {
  return {
    model: openRouterModel(config, fetch),
    supabase: supabaseServerClient(config),
    config,
  };
}
