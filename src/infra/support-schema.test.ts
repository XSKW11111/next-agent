import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

function readMigrations(): string {
  const directory = join(process.cwd(), "supabase", "migrations");
  const names = readdirSync(directory).filter((name) => name.endsWith(".sql"));
  return names.map((name) => readFileSync(join(directory, name), "utf8")).join("\n");
}

test("the migration matches the live tables", () => {
  const sql = readMigrations().replace(/\s+/g, " ").toLowerCase();

  expect(sql).toContain("create table customers");
  expect(sql).toContain("create table products");
  expect(sql).toContain("create table orders");
  expect(sql).toContain("create table order_items");
  expect(sql).toContain("create table promotion_codes");
  expect(sql).toContain("create table sessions");
  expect(sql).toContain("create table messages");
  expect(sql).toContain("create table support_handoffs");
  expect(sql).toContain("create table support_handoff_proposals");
  expect(sql).toContain("email citext");
  expect(sql).toContain("order_number citext");
  expect(sql).toContain("extensions.vector(384)");
  expect(sql).toContain("active_operation_id");
  expect(sql).toContain("next_message_sequence bigint not null default 0");
  expect(sql).toContain("'user'");
  expect(sql).not.toContain("timezone");
  expect(sql).not.toContain("contact_email");
  expect(sql).not.toContain("messages_session_id_turn_id_role_key");
  expect(sql).not.toContain("row level security");
});
