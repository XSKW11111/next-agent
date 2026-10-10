import { z } from "zod";
import { parseSession, type LocalTimezone } from "../../../../domain/session";
import { currentChatRuntime, type ChatRuntime } from "../runtime";

const createSessionBodySchema = z.strictObject({
  timezone: z.string().optional(),
});

export async function POST(
  request: Request,
  _context: unknown,
  runtime: ChatRuntime = currentChatRuntime(),
): Promise<Response> {
  const body = await readBody(request);
  if (!body.ok) return invalid();
  const parsed = createSessionBodySchema.safeParse(body.value);
  if (!parsed.success) return invalid();

  const session = parseSession({
    id: runtime.newSessionId(),
    localTimezone: timezoneFromName(parsed.data.timezone),
    unmatchedOrderStreak: 0,
  });
  if (!session.ok) throw new Error("session is invalid");

  await runtime.sessions.save(session.value);
  return Response.json({ id: session.value.id });
}

function timezoneFromName(name: string | undefined): LocalTimezone {
  const trimmed = name?.trim() ?? "";
  if (trimmed.length === 0) return { kind: "unresolved" };
  return { kind: "resolved", name: trimmed };
}

async function readBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await request.text();
  if (text.trim() === "") return { ok: true, value: {} };
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function invalid(): Response {
  return Response.json({ code: "invalid" }, { status: 400 });
}
