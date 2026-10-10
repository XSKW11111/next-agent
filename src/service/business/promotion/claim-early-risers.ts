import { randomBytes } from "node:crypto";
import type { PromotionResult } from "../../../domain/promotion";
import type { Session, SessionId } from "../../../domain/session";

const earlyRisersWindow = "08:00-10:00" as const;

export type EarlyRisersCodeRecord = {
  readonly sessionId: SessionId;
  readonly code: string;
  readonly validOn: string;
  readonly expiresAt: string;
  readonly timezone: string;
};

export type EarlyRisersCodeKey = {
  readonly sessionId: SessionId;
  readonly validOn: string;
};

export type EarlyRisersCodeStore = {
  insertOrReuse(
    key: EarlyRisersCodeKey,
    create: () => EarlyRisersCodeRecord,
  ): Promise<EarlyRisersCodeRecord>;
};

export type ClaimEarlyRisersInput = {
  readonly session: Session;
  readonly now: Date;
  readonly store: EarlyRisersCodeStore;
  readonly issueCode?: () => string;
};

type CivilDate = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
};

type CivilTime = CivilDate & {
  readonly hour: number;
  readonly minute: number;
};

export function mintEarlyRisersCode(): string {
  return `EARLY-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function claimEarlyRisers(input: ClaimEarlyRisersInput): Promise<PromotionResult> {
  const timezone = input.session.localTimezone;
  switch (timezone.kind) {
    case "unresolved":
      return { kind: "promotion_ineligible", reason: "timezone_unresolved" };
    case "resolved":
      return claimResolved(input, timezone.name);
    default: {
      const exhaustive: never = timezone;
      return exhaustive;
    }
  }
}

async function claimResolved(input: ClaimEarlyRisersInput, timeZone: string): Promise<PromotionResult> {
  if (Number.isNaN(input.now.getTime())) {
    throw new TypeError("claimEarlyRisers requires a valid instant");
  }

  let local: CivilTime;
  try {
    local = localCivilTime(input.now, timeZone);
  } catch (error) {
    if (error instanceof RangeError) {
      return { kind: "promotion_ineligible", reason: "timezone_unresolved" };
    }
    throw error;
  }

  if (local.hour < 8 || local.hour >= 10) {
    return {
      kind: "promotion_ineligible",
      reason: "outside_window",
      timezone: timeZone,
      window: earlyRisersWindow,
    };
  }

  const validOn = isoDate(local.year, local.month, local.day);
  const issueCode = input.issueCode ?? mintEarlyRisersCode;
  const stored = await input.store.insertOrReuse({ sessionId: input.session.id, validOn }, () => ({
    sessionId: input.session.id,
    code: issueCode(),
    validOn,
    expiresAt: expiresAt(timeZone, local),
    timezone: timeZone,
  }));

  return {
    kind: "promotion_eligible",
    campaign: "Early Risers",
    code: stored.code,
    discountPercent: 10,
    validOn: stored.validOn,
    expiresAt: stored.expiresAt,
    timezone: stored.timezone,
  };
}

function localCivilTime(instant: Date, timeZone: string): CivilTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return {
    year: Number(part(parts, "year")),
    month: Number(part(parts, "month")),
    day: Number(part(parts, "day")),
    hour: Number(part(parts, "hour")),
    minute: Number(part(parts, "minute")),
  };
}

function expiresAt(timeZone: string, local: CivilTime): string {
  const next = nextCivilDay(local.year, local.month, local.day);
  const midnight = instantAtLocal(timeZone, next.year, next.month, next.day, 0, 0);
  return `${isoDate(next.year, next.month, next.day)}T00:00:00${offsetLabel(midnight, timeZone)}`;
}

function instantAtLocal(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = asUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    utc = asUtc - offsetMinutes(offsetLabel(new Date(utc), timeZone)) * 60_000;
  }
  return new Date(utc);
}

function offsetLabel(instant: Date, timeZone: string): string {
  const raw = part(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    }).formatToParts(instant),
    "timeZoneName",
  );
  if (raw === "GMT") {
    return "+00:00";
  }
  const match = /^GMT([+-])(\d{1,2}):(\d{2})$/.exec(raw);
  if (match === null) {
    throw new Error(`unrecognized offset ${raw}`);
  }
  const sign = match[1];
  const hours = match[2];
  const minutes = match[3];
  if (sign === undefined || hours === undefined || minutes === undefined) {
    throw new Error(`unrecognized offset ${raw}`);
  }
  return `${sign}${hours.padStart(2, "0")}:${minutes}`;
}

function offsetMinutes(label: string): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(label);
  if (match === null) {
    throw new Error(`unrecognized offset ${label}`);
  }
  const sign = match[1];
  const hours = match[2];
  const minutes = match[3];
  if (sign === undefined || hours === undefined || minutes === undefined) {
    throw new Error(`unrecognized offset ${label}`);
  }
  const direction = sign === "+" ? 1 : -1;
  return direction * (Number(hours) * 60 + Number(minutes));
}

function nextCivilDay(year: number, month: number, day: number): CivilDate {
  const shifted = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const found = parts.find((item) => item.type === type);
  if (found === undefined) {
    throw new Error(`missing local time part ${type}`);
  }
  return found.value;
}
