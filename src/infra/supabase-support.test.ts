import { describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSession, sessionIdSchema } from "@/domain/session";
import { turnIdSchema } from "@/domain/turn";
import { supabaseMessages, supabaseSessions } from "@/infra/supabase-support";

describe("supabaseSessions", () => {
  test("stores a web session without a timezone column", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const sessions = supabaseSessions(fakeClient(rows));
    const session = parseSession({
      id: "4f5d0b8a-6c2e-4a1b-9d3f-1a2b3c4d5e6f",
      localTimezone: { kind: "resolved", name: "America/Chicago" },
      unmatchedOrderStreak: 0,
    });
    if (!session.ok) throw new Error("fixture session did not parse");

    await sessions.save(session.value);
    await expect(sessions.find(session.value.id)).resolves.toEqual({
      ...session.value,
      localTimezone: { kind: "unresolved" },
    });
    expect(rows.get(session.value.id)).toEqual({
      id: session.value.id,
      source: "web",
      unmatched_order_count: 0,
      next_message_sequence: 1,
    });
  });
});

describe("supabaseMessages", () => {
  test("stores a customer message as the user role and reads it back", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const messages = supabaseMessages(fakeClient(rows));
    const sessionId = sessionIdSchema.parse("4f5d0b8a-6c2e-4a1b-9d3f-1a2b3c4d5e6f");
    const turnId = turnIdSchema.parse("6b7c8d9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f");

    await messages.insert({
      sessionId,
      turnId,
      role: "customer",
      content: "Where is my order?",
      sequence: 1,
    });

    await expect(messages.messagesForSession(sessionId)).resolves.toEqual([
      {
        sessionId,
        turnId,
        role: "customer",
        content: "Where is my order?",
        sequence: 1,
      },
    ]);
    expect([...rows.values()]).toEqual([
      {
        session_id: sessionId,
        sequence: 1,
        role: "user",
        content: "Where is my order?",
        turn_id: turnId,
        turn_index: 1,
      },
    ]);
  });
});

function fakeClient(rows: Map<string, Record<string, unknown>>): SupabaseClient {
  return {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          if (table !== "sessions" && table !== "messages") {
            return Promise.resolve({ data: null, error: { code: "table" } });
          }
          rows.set(table === "sessions" ? String(row.id) : String(row.turn_id), row);
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
              const data =
                table === "messages"
                  ? [...rows.values()].filter((row) => row.session_id === filters.get("session_id"))
                  : [];
              return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
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
