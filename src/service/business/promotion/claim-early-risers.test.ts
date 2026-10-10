import { expect, test } from "vitest";
import { parsePromotionResult } from "../../../domain/promotion";
import { parseSession, type Session } from "../../../domain/session";
import {
  claimEarlyRisers,
  mintEarlyRisersCode,
  type EarlyRisersCodeKey,
  type EarlyRisersCodeRecord,
  type EarlyRisersCodeStore,
} from "./claim-early-risers";

const sessionId = "11111111-1111-4111-8111-111111111111";

function session(localTimezone: Session["localTimezone"]): Session {
  const parsed = parseSession({
    id: sessionId,
    localTimezone,
    unmatchedOrderStreak: 0,
  });
  if (!parsed.ok) {
    throw new Error("session fixture");
  }
  return parsed.value;
}

function unusedStore(): EarlyRisersCodeStore {
  return {
    async insertOrReuse() {
      throw new Error("store should stay unused");
    },
  };
}

function fakeStore(): EarlyRisersCodeStore {
  const rows = new Map<string, EarlyRisersCodeRecord>();
  return {
    async insertOrReuse(key: EarlyRisersCodeKey, create: () => EarlyRisersCodeRecord) {
      const id = `${key.sessionId}|${key.validOn}`;
      const existing = rows.get(id);
      if (existing !== undefined) {
        return existing;
      }
      const created = create();
      rows.set(id, created);
      return created;
    },
  };
}

function issueCodes(codes: readonly string[]): () => string {
  let index = 0;
  return () => {
    const code = codes[index];
    if (code === undefined) {
      throw new Error("no code left");
    }
    index += 1;
    return code;
  };
}

test("claimEarlyRisers returns timezone_unresolved and no code when the session has no timezone", async () => {
  const result = await claimEarlyRisers({
    session: session({ kind: "unresolved" }),
    now: new Date("2026-10-08T13:00:00.000Z"),
    store: unusedStore(),
    issueCode() {
      throw new Error("no code");
    },
  });

  expect(parsePromotionResult(result)).toEqual({
    ok: true,
    value: { kind: "promotion_ineligible", reason: "timezone_unresolved" },
  });
});

test("claimEarlyRisers returns outside_window before 08:00 local", async () => {
  const result = await claimEarlyRisers({
    session: session({ kind: "resolved", name: "America/Chicago" }),
    now: new Date("2026-10-08T12:59:00.000Z"),
    store: unusedStore(),
  });

  expect(parsePromotionResult(result)).toEqual({
    ok: true,
    value: {
      kind: "promotion_ineligible",
      reason: "outside_window",
      timezone: "America/Chicago",
      window: "08:00-10:00",
    },
  });
});

test("claimEarlyRisers returns outside_window at 10:00 local", async () => {
  const result = await claimEarlyRisers({
    session: session({ kind: "resolved", name: "America/Chicago" }),
    now: new Date("2026-10-08T15:00:00.000Z"),
    store: unusedStore(),
  });

  expect(parsePromotionResult(result)).toEqual({
    ok: true,
    value: {
      kind: "promotion_ineligible",
      reason: "outside_window",
      timezone: "America/Chicago",
      window: "08:00-10:00",
    },
  });
});

test("claimEarlyRisers issues one code at 08:00 local and repeats it later that day", async () => {
  const store = fakeStore();
  const issueCode = issueCodes(["EARLY-AAAAAAAA", "EARLY-BBBBBBBB"]);
  const early = session({ kind: "resolved", name: "America/Chicago" });
  const input = {
    session: early,
    store,
    issueCode,
  };

  const first = await claimEarlyRisers({
    ...input,
    now: new Date("2026-10-08T13:00:00.000Z"),
  });
  const repeat = await claimEarlyRisers({
    ...input,
    now: new Date("2026-10-08T14:59:00.000Z"),
  });

  const expected = {
    kind: "promotion_eligible" as const,
    campaign: "Early Risers" as const,
    code: "EARLY-AAAAAAAA",
    discountPercent: 10 as const,
    validOn: "2026-10-08",
    expiresAt: "2026-10-09T00:00:00-05:00",
    timezone: "America/Chicago",
  };
  expect(parsePromotionResult(first)).toEqual({ ok: true, value: expected });
  expect(parsePromotionResult(repeat)).toEqual({ ok: true, value: expected });
});

test("claimEarlyRisers issues a different code on the next local day", async () => {
  const store = fakeStore();
  const issueCode = issueCodes(["EARLY-AAAAAAAA", "EARLY-BBBBBBBB"]);
  const early = session({ kind: "resolved", name: "America/Chicago" });

  const first = await claimEarlyRisers({
    session: early,
    now: new Date("2026-10-08T13:00:00.000Z"),
    store,
    issueCode,
  });
  const nextDay = await claimEarlyRisers({
    session: early,
    now: new Date("2026-10-09T13:00:00.000Z"),
    store,
    issueCode,
  });

  expect(parsePromotionResult(first)).toEqual({
    ok: true,
    value: {
      kind: "promotion_eligible",
      campaign: "Early Risers",
      code: "EARLY-AAAAAAAA",
      discountPercent: 10,
      validOn: "2026-10-08",
      expiresAt: "2026-10-09T00:00:00-05:00",
      timezone: "America/Chicago",
    },
  });
  expect(parsePromotionResult(nextDay)).toEqual({
    ok: true,
    value: {
      kind: "promotion_eligible",
      campaign: "Early Risers",
      code: "EARLY-BBBBBBBB",
      discountPercent: 10,
      validOn: "2026-10-09",
      expiresAt: "2026-10-10T00:00:00-05:00",
      timezone: "America/Chicago",
    },
  });
});

test("mintEarlyRisersCode returns EARLY- plus eight characters", () => {
  expect(mintEarlyRisersCode()).toMatch(/^EARLY-[A-F0-9]{8}$/);
});
