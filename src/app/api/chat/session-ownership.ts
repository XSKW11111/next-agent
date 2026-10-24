import { createHash, randomBytes } from "node:crypto";

const cookiePrefix = "next-agent-owner-";
const tokenPattern = /^[0-9a-f]{64}$/;

export function ownerHash(request: Request, sessionId: string): string | undefined {
  const cookieName = `${cookiePrefix}${sessionId}`;
  const cookie = request.headers.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  const token = cookie?.slice(cookieName.length + 1);
  if (token === undefined || !tokenPattern.test(token)) return undefined;
  return createHash("sha256").update(token).digest("hex");
}

export function ownerForNewSession(request: Request, sessionId: string): { hash: string; cookies: readonly string[] } {
  const existing = ownerHash(request, sessionId);
  if (existing !== undefined) return { hash: existing, cookies: [] };
  const token = randomBytes(32).toString("hex");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const value = `${cookiePrefix}${sessionId}=${token}`;
  return {
    hash: createHash("sha256").update(token).digest("hex"),
    cookies: [
      `${value}; Path=/chat/${sessionId}; Max-Age=604800; HttpOnly; SameSite=Lax${secure}`,
      `${value}; Path=/api/chat/sessions/${sessionId}; Max-Age=604800; HttpOnly; SameSite=Lax${secure}`,
    ],
  };
}
