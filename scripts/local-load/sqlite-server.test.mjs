import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { server } from "./sqlite-server.mjs";

let base;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

async function request(path, method, payload) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

test("SQLite owns sessions and atomically stores a customer and assistant pair", async () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const turnId = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(await request("/sessions", "POST", { id: sessionId }), { status: 200, body: { streak: 0 } });
  assert.deepEqual(await request("/streak", "PUT", { id: sessionId, streak: 2 }), { status: 200, body: { ok: true } });
  assert.deepEqual(await request("/sessions", "POST", { id: sessionId }), { status: 200, body: { streak: 2 } });
  const pair = { sessionId, turnId, customerText: "Where is W002?", reply: "Your order #W002 is shipped." };
  assert.equal((await request("/messages", "POST", pair)).status, 201);
  assert.equal((await request("/messages", "POST", pair)).status, 200);
  assert.equal((await request("/messages", "POST", { ...pair, reply: "different" })).status, 409);
  const stats = await fetch(`${base}/stats`).then((response) => response.json());
  assert.deepEqual(stats, { sessions: 1, customers: 1, assistants: 1, wrong_replies: 0 });
});

test("invalid message input cannot write a partial pair", async () => {
  assert.equal((await request("/messages", "POST", { sessionId: "bad" })).status, 400);
  const stats = await fetch(`${base}/stats`).then((response) => response.json());
  assert.equal(stats.customers, 1);
  assert.equal(stats.assistants, 1);
});
