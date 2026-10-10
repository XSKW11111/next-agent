import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSession, sessionIdSchema, unmatchedOrderStreakSchema, type Session, type SessionId } from "@/domain/session";
import { turnIdSchema } from "@/domain/turn";
import type { MessageRole, MessageStore, SequenceUpdate, TurnMessage } from "@/service/turn/message-store";
import type { OrderStreakStore, StreakRead, StreakWrite } from "@/service/order/lookup-order";

const sessionRowSchema = z.object({
  id: z.string(),
  timezone: z.string(),
  unmatched_order_count: z.number().int(),
  next_message_sequence: z.coerce.number().int().positive(),
});

const messageRowSchema = z.object({
  session_id: z.string(),
  turn_id: z.string(),
  role: z.enum(["customer", "assistant"]),
  content: z.string(),
  sequence: z.coerce.number().int().positive(),
});

type QueryError = { readonly code?: string } | null;

type QueryResult = {
  readonly data: unknown;
  readonly error: QueryError;
};

type Filter = PromiseLike<QueryResult> & {
  eq(column: string, value: unknown): Filter;
  select(columns: string): Filter;
  maybeSingle(): Promise<QueryResult>;
};

type Table = {
  insert(row: Record<string, unknown>): Promise<QueryResult>;
  select(columns: string): Filter;
  update(row: Record<string, unknown>): Filter;
};

export function supabaseSessions(client: SupabaseClient): {
  save(session: Session): Promise<void>;
  find(id: SessionId): Promise<Session | undefined>;
} {
  return {
    async save(session) {
      const { error } = await table(client, "sessions").insert({
        id: session.id,
        source: "web",
        timezone: timezoneName(session),
        next_message_sequence: 1,
        unmatched_order_count: session.unmatchedOrderStreak,
      });
      if (error) fail("session save failed", error.code);
    },
    async find(id) {
      const { data, error } = await table(client, "sessions")
        .select("id, timezone, unmatched_order_count, next_message_sequence")
        .eq("id", id)
        .maybeSingle();
      if (error) fail("session read failed", error.code);
      if (data === null) return undefined;
      return sessionFromRow(data);
    },
  };
}

export function supabaseMessages(
  client: SupabaseClient,
): MessageStore & {
  messagesForSession(sessionId: SessionId): Promise<readonly TurnMessage[]>;
} {
  return {
    async messagesForSession(sessionId) {
      return readMessages(client, sessionId);
    },
    async messagesForTurn(sessionId, turnId) {
      const messages = await readMessages(client, sessionId);
      return messages.filter((message) => message.turnId === turnId);
    },
    async readNextSequence(sessionId) {
      const row = await sessionSequence(client, sessionId);
      return row.next_message_sequence;
    },
    async conditionalUpdate(sessionId, expected) {
      const { data, error } = await table(client, "sessions")
        .update({ next_message_sequence: expected + 1 })
        .eq("id", sessionId)
        .eq("next_message_sequence", expected)
        .select("next_message_sequence");
      if (error) fail("message sequence update failed", error.code);
      return sequenceUpdate(data, expected);
    },
    async insert(message) {
      const { error } = await table(client, "messages").insert({
        session_id: message.sessionId,
        sequence: message.sequence,
        role: message.role,
        content: message.content,
        turn_id: message.turnId,
        turn_index: message.sequence,
      });
      if (error) fail("message save failed", error.code);
    },
  };
}

export function supabaseStreaks(client: SupabaseClient): OrderStreakStore {
  return {
    async read(sessionId): Promise<StreakRead> {
      const { data, error } = await table(client, "sessions")
        .select("unmatched_order_count")
        .eq("id", sessionId)
        .maybeSingle();
      if (error || data === null) return { kind: "unavailable" };
      const streak = unmatchedOrderStreakSchema.safeParse(rowField(data, "unmatched_order_count"));
      if (!streak.success) return { kind: "unavailable" };
      return { kind: "ready", streak: streak.data };
    },
    async write(sessionId, streak): Promise<StreakWrite> {
      const { data, error } = await table(client, "sessions")
        .update({ unmatched_order_count: streak })
        .eq("id", sessionId)
        .select("id");
      if (error || !hasRow(data)) return { kind: "unavailable" };
      return { kind: "ready" };
    },
  };
}

async function readMessages(client: SupabaseClient, sessionId: SessionId): Promise<readonly TurnMessage[]> {
  const { data, error } = await table(client, "messages")
    .select("session_id, turn_id, role, content, sequence")
    .eq("session_id", sessionId);
  if (error) fail("message read failed", error.code);
  if (!Array.isArray(data)) return [];
  return data.map(messageFromRow);
}

async function sessionSequence(client: SupabaseClient, sessionId: SessionId) {
  const { data, error } = await table(client, "sessions")
    .select("next_message_sequence")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || data === null) fail("session read failed", error?.code);
  const row = sessionRowSchema.pick({ next_message_sequence: true }).safeParse(data);
  if (!row.success) fail("session row is invalid");
  return row.data;
}

function sessionFromRow(data: unknown): Session {
  const row = sessionRowSchema.safeParse(data);
  if (!row.success) fail("session row is invalid");
  const session = parseSession({
    id: row.data.id,
    localTimezone: timezoneFromName(row.data.timezone),
    unmatchedOrderStreak: row.data.unmatched_order_count,
  });
  if (!session.ok) fail("session row is invalid");
  return session.value;
}

function messageFromRow(data: unknown): TurnMessage {
  const row = messageRowSchema.safeParse(data);
  if (!row.success) fail("message row is invalid");
  const sessionId = sessionIdSchema.safeParse(row.data.session_id);
  const turnId = turnIdSchema.safeParse(row.data.turn_id);
  if (!sessionId.success || !turnId.success) fail("message row is invalid");
  return {
    sessionId: sessionId.data,
    turnId: turnId.data,
    role: row.data.role satisfies MessageRole,
    content: row.data.content,
    sequence: row.data.sequence,
  };
}

function sequenceUpdate(data: unknown, expected: number): SequenceUpdate {
  if (!hasRow(data)) return { kind: "unchanged" };
  return { kind: "updated", sequence: expected };
}

function timezoneName(session: Session): string {
  switch (session.localTimezone.kind) {
    case "resolved":
      return session.localTimezone.name;
    case "unresolved":
      return "";
    default: {
      const unreachable: never = session.localTimezone;
      return unreachable;
    }
  }
}

function timezoneFromName(name: string): Session["localTimezone"] {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { kind: "unresolved" };
  return { kind: "resolved", name: trimmed };
}

function hasRow(data: unknown): boolean {
  return Array.isArray(data) && data.length > 0;
}

function rowField(data: unknown, key: string): unknown {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;
  return record[key];
}

function table(client: SupabaseClient, name: string): Table {
  return client.from(name) as unknown as Table;
}

function fail(step: string, code?: string): never {
  throw new Error(code === undefined || code.length === 0 ? step : `${step} (${code})`);
}
