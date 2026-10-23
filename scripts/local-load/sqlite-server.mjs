import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(process.env.SQLITE_PATH ?? ":memory:");
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    unmatched_order_streak INTEGER NOT NULL DEFAULT 0 CHECK (unmatched_order_streak BETWEEN 0 AND 2)
  );
  CREATE TABLE IF NOT EXISTS messages (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    turn_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('customer', 'assistant')),
    content TEXT NOT NULL,
    PRIMARY KEY (session_id, turn_id, role)
  );
`);

const insertSession = database.prepare("INSERT OR IGNORE INTO sessions (id) VALUES (?)");
const readStreak = database.prepare("SELECT unmatched_order_streak AS streak FROM sessions WHERE id = ?");
const updateStreak = database.prepare("UPDATE sessions SET unmatched_order_streak = ? WHERE id = ?");
const insertMessage = database.prepare("INSERT INTO messages (session_id, turn_id, role, content) VALUES (?, ?, ?, ?)");
const readMessage = database.prepare("SELECT content FROM messages WHERE session_id = ? AND turn_id = ? AND role = ?");
const counts = database.prepare(`
  SELECT (SELECT COUNT(*) FROM sessions) AS sessions,
         (SELECT COUNT(*) FROM messages WHERE role = 'customer') AS customers,
         (SELECT COUNT(*) FROM messages WHERE role = 'assistant') AS assistants,
         (SELECT COUNT(*) FROM messages WHERE role = 'assistant' AND content != 'Your order #W002 is shipped.') AS wrong_replies
`);

function validId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function body(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error("request too large");
  }
  return JSON.parse(raw);
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

export const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });
    if (request.method === "GET" && url.pathname === "/stats") return json(response, 200, counts.get());
    if (request.method === "POST" && url.pathname === "/sessions") {
      const input = await body(request);
      if (!record(input) || !validId(input.id)) return json(response, 400, { error: "invalid session id" });
      insertSession.run(input.id);
      return json(response, 200, { streak: readStreak.get(input.id).streak });
    }
    if (request.method === "PUT" && url.pathname === "/streak") {
      const input = await body(request);
      if (!record(input) || !validId(input.id) || ![0, 1, 2].includes(input.streak)) return json(response, 400, { error: "invalid streak" });
      return json(response, updateStreak.run(input.streak, input.id).changes === 1 ? 200 : 404, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/messages") {
      const input = await body(request);
      if (!record(input) || !validId(input.sessionId) || !validId(input.turnId) || typeof input.customerText !== "string" ||
          typeof input.reply !== "string" || input.customerText.length === 0 || input.reply.length === 0) {
        return json(response, 400, { error: "invalid messages" });
      }
      database.exec("BEGIN IMMEDIATE");
      try {
        const existingCustomer = readMessage.get(input.sessionId, input.turnId, "customer");
        const existingAssistant = readMessage.get(input.sessionId, input.turnId, "assistant");
        if (existingCustomer || existingAssistant) {
          database.exec("ROLLBACK");
          if (existingCustomer?.content === input.customerText && existingAssistant?.content === input.reply) {
            return json(response, 200, { ok: true });
          }
          return json(response, 409, { error: "turn content conflicts with stored pair" });
        }
        insertMessage.run(input.sessionId, input.turnId, "customer", input.customerText);
        insertMessage.run(input.sessionId, input.turnId, "assistant", input.reply);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return json(response, 201, { ok: true });
    }
    return json(response, 404, { error: "not found" });
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 500;
    json(response, status, { error: status === 400 ? "invalid JSON" : "database request failed" });
  }
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  server.listen(Number(process.env.PORT ?? 3001), "0.0.0.0");
}
