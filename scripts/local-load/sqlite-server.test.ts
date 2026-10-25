import { afterAll, beforeAll, expect, test } from "vitest";
import { server } from "./sqlite-server.mjs";

let base = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("SQLite server did not bind");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function request(path: string, method: string, payload: unknown) {
  const response = await fetch(`${base}${path}`, { method,
    headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  return { status: response.status, body: await response.json() };
}

test("stores an atomic message pair and reads both contents back", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  expect(await request("/sessions", "POST", { id })).toEqual({ status: 200, body: { streak: 0 } });
  const pair = { sessionId: id, turnId: id, customerText: "Where is W002?", reply: "Your order #W002 is shipped." };
  expect((await request("/messages", "POST", pair)).status).toBe(201);
  expect((await request("/messages", "POST", pair)).status).toBe(200);
  expect((await request("/messages", "POST", { ...pair, reply: "different" })).status).toBe(409);
  expect(await request("/messages/readback", "POST", { ids: [id] })).toEqual({ status: 200,
    body: [{ id, customerText: pair.customerText, reply: pair.reply }] });
  expect(await fetch(`${base}/stats`).then((response) => response.json())).toEqual({ sessions: 1, customers: 1, assistants: 1 });
});

test("rejects malformed readback IDs and incomplete message writes", async () => {
  expect((await request("/messages/readback", "POST", { ids: ["bad"] })).status).toBe(400);
  expect((await request("/messages", "POST", { sessionId: "bad" })).status).toBe(400);
  expect(await fetch(`${base}/stats`).then((response) => response.json())).toEqual({ sessions: 1, customers: 1, assistants: 1 });
});
