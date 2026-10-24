import { createServer } from "node:http";
import { parse } from "../../src/domain/parse";
import { sessionIdSchema } from "../../src/domain/session";
import { runSimulatedTurn } from "./agent-turn";
import { createTurnTrace, type TurnTrace } from "./turn-trace";

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method !== "POST" || url.pathname !== "/turn") {
    response.writeHead(404).end();
    return;
  }
  let trace: TurnTrace | undefined;
  let traceOutcome: "ok" | "error" = "error";
  try {
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 1024) throw new Error("request too large");
    }
    const input: unknown = JSON.parse(raw);
    const requestId = typeof input === "object" && input !== null && "requestId" in input
      ? parse(sessionIdSchema, input.requestId) : { ok: false as const };
    if (!requestId.ok) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid request ID" }));
      return;
    }
    trace = createTurnTrace(requestId.value);
    const result = await runSimulatedTurn(requestId.value, trace);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
    traceOutcome = "ok";
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ event: "local_load.turn_error", traceId: trace?.snapshot("error").traceId ?? null,
      errorType: error instanceof Error ? error.name : "unknown" })}\n`);
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "turn failed", traceId: trace?.snapshot("error").traceId ?? null }));
  } finally {
    if (trace !== undefined) process.stdout.write(`${JSON.stringify(trace.snapshot(traceOutcome))}\n`);
  }
});

server.listen(Number(process.env.PORT ?? 3002), "0.0.0.0");
