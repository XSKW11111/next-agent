import { describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSession } from "@/domain/session";
import { supabaseSessions } from "@/infra/supabase-support";

describe("supabaseSessions", () => {
  test("stores a web session and reads the timezone back", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const sessions = supabaseSessions(fakeClient(rows));
    const session = parseSession({
      id: "4f5d0b8a-6c2e-4a1b-9d3f-1a2b3c4d5e6f",
      localTimezone: { kind: "resolved", name: "America/Chicago" },
      unmatchedOrderStreak: 0,
    });
    if (!session.ok) throw new Error("fixture session did not parse");

    await sessions.save(session.value);
    await expect(sessions.find(session.value.id)).resolves.toEqual(session.value);
    expect(rows.get(session.value.id)).toMatchObject({
      source: "web",
      timezone: "America/Chicago",
      unmatched_order_count: 0,
      next_message_sequence: 1,
    });
  });
});

function fakeClient(rows: Map<string, Record<string, unknown>>): SupabaseClient {
  return {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          if (table !== "sessions") return Promise.resolve({ data: null, error: { code: "table" } });
          rows.set(String(row.id), row);
          return Promise.resolve({ data: null, error: null });
        },
        select() {
          const filters = new Map<string, unknown>();
          const filter = {
            eq(column: string, value: unknown) {
              filters.set(column, value);
              return filter;
            },
            select() {
              return filter;
            },
            maybeSingle() {
              const row = rows.get(String(filters.get("id")));
              return Promise.resolve({ data: row ?? null, error: null });
            },
            then(onFulfilled: (value: { data: unknown; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
              return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
            },
          };
          return filter;
        },
        update() {
          return this.select();
        },
      };
    },
  } as unknown as SupabaseClient;
}
