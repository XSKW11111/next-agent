import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { parse } from "../../src/domain/parse";
import { sessionIdSchema } from "../../src/domain/session";
import { runSimulatedTurn } from "./agent-turn";
import { scenarioForIntent } from "./scenarios";
import { createTurnTrace } from "./turn-trace";
import { redisCommand } from "./redis-client";

vi.mock("./redis-client", () => ({ redisCommand: vi.fn(async (_host: string, _port: number, command: string) =>
  command === "GET" ? null : "OK") }));

afterEach(() => vi.unstubAllGlobals());

for (const intent of ["order_status", "product_search", "promotion_claim", "human_handoff"] as const) {
  test(`runs ${intent} through the real support graph and stores its reply`, async () => {
    const parsed = parse(sessionIdSchema, randomUUID());
    if (!parsed.ok) throw new Error("fixture UUID did not parse");
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith("/sessions")) return Response.json({ streak: 0 });
      if (url.endsWith("/streak")) return Response.json({ ok: true });
      if (url.endsWith("/messages")) {
        writes.push(JSON.parse(String(options.body)));
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected service ${url}`);
    }));
    const trace = createTurnTrace(parsed.value, intent);
    const result = await runSimulatedTurn(parsed.value, intent, trace);
    const scenario = scenarioForIntent(intent);
    expect(result.intent).toBe(intent);
    expect(result.tool).toBe(scenario.tool);
    expect(result.resultKind).toBe(scenario.resultKind);
    expect(result.reply).toBe(scenario.reply);
    expect(result.cacheOutcome).toBe(intent === "order_status" ? "miss" : "not_used");
    expect(writes).toEqual([{ sessionId: parsed.value, turnId: parsed.value,
      customerText: scenario.customerText, reply: scenario.reply }]);
    const spans = trace.snapshot("ok").spans.map((span) => span.name);
    expect(spans).toEqual(intent === "order_status"
      ? ["sqlite.sessions", "model.complete", "sqlite.sessions", "redis.get", "redis.set", "sqlite.streak", "model.complete", "sqlite.messages"]
      : ["sqlite.sessions", "model.complete", "model.complete", "sqlite.messages"]);
    if (intent !== "order_status") expect(vi.mocked(redisCommand)).not.toHaveBeenCalled();
    vi.mocked(redisCommand).mockClear();
  });
}
