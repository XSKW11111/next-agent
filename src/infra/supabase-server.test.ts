import { expect, test } from "vitest";
import type { AgentConfig } from "./agent-config";
import { supabaseServerClient } from "./supabase-server";

const config: AgentConfig = {
  openRouterApiKey: "test-openrouter-token",
  model: "openai/gpt-4o",
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "test-service-role",
  productMatchThreshold: 0.3,
  maxProductCandidates: 5,
  maxToolRounds: 6,
  contextWindowTokens: 128000,
  contextHardTokens: 120000,
  debugToolDetails: false,
};

test("a fake url and key construct a server client that does not persist a session", () => {
  const client = supabaseServerClient(config);

  expect(Reflect.get(client, "supabaseUrl")).toBe("https://example.supabase.co");
  expect(Reflect.get(client, "supabaseKey")).toBe("test-service-role");
  expect(Reflect.get(client.auth, "persistSession")).toBe(false);
  expect(Reflect.get(client.auth, "autoRefreshToken")).toBe(false);
});
