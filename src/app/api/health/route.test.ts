import { expect, test } from "vitest";
import { GET } from "./route";

test("GET /api/health returns ok", async () => {
  const response = await GET();

  expect(response).toMatchObject({ status: 200 });
  expect(await response.json()).toEqual({ ok: true });
});
