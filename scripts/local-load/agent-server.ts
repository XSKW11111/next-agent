import { createServer } from "node:http";
import { parse } from "../../src/domain/parse";
import { sessionIdSchema } from "../../src/domain/session";
import { runSimulatedTurn } from "./agent-turn";

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
    const result = await runSimulatedTurn(requestId.value);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "unknown turn error"}\n`);
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "turn failed" }));
  }
});

server.listen(Number(process.env.PORT ?? 3002), "0.0.0.0");
