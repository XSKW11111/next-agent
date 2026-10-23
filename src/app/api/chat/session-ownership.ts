import { createHash, randomBytes } from "node:crypto";

const cookieName = "next-agent-owner";
const tokenPattern = /^[0-9a-f]{64}$/;

export function ownerHash(request: Request): string | undefined {
  const cookie = request.headers.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  const token = cookie?.slice(cookieName.length + 1);
  if (token === undefined || !tokenPattern.test(token)) return undefined;
  return createHash("sha256").update(token).digest("hex");
}

export function ownerForNewSession(request: Request): { hash: string; cookie?: string } {
  const existing = ownerHash(request);
  if (existing !== undefined) return { hash: existing };
  const token = randomBytes(32).toString("hex");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return {
    hash: createHash("sha256").update(token).digest("hex"),
    cookie: `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  };
}
