import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

function readMigrations(): string | undefined {
  const directory = join(process.cwd(), "supabase", "migrations");
  if (!existsSync(directory)) return undefined;
  const names = readdirSync(directory).filter((name) => name.endsWith(".sql"));
  if (names.length === 0) return undefined;
  return names.map((name) => readFileSync(join(directory, name), "utf8")).join("\n");
}

const migrations = readMigrations();

test.skipIf(migrations === undefined)("the support migration creates the session, message, proposal, and case tables", () => {
  if (migrations === undefined) return;
  const sql = migrations.replace(/\s+/g, " ").toLowerCase();

  expect(sql).not.toBe("");
  expect(sql).toContain("create table sessions");
  expect(sql).toContain("create table messages");
  expect(sql).toContain("create table support_handoff_proposals");
  expect(sql).toContain("create table support_handoffs");
  expect(sql).toContain("unmatched_order_count");
  expect(sql).toContain(
    "create unique index messages_session_id_turn_id_role_key on messages (session_id, turn_id, role) where turn_id is not null",
  );
  expect(sql).not.toContain("active_operation_id");
  expect(sql).toContain("alter table sessions enable row level security");
  expect(sql).toContain("alter table messages enable row level security");
  expect(sql).toContain("alter table support_handoffs enable row level security");
  expect(sql).toContain(
    "alter table support_handoff_proposals enable row level security",
  );
});
