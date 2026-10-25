type ExpectedMessagePair = { readonly customerText: string; readonly reply: string };

export function countWrongReadbackRows(
  ids: readonly string[], records: readonly unknown[], expectations: ReadonlyMap<string, ExpectedMessagePair>,
): number {
  if (records.length !== ids.length) throw new Error("SQLite readback count mismatch");
  let wrong = 0;
  for (const [index, row] of records.entries()) {
    const id = ids[index];
    const expected = id === undefined ? undefined : expectations.get(id);
    if (id === undefined || expected === undefined || typeof row !== "object" || row === null ||
        !("id" in row) || row.id !== id ||
        !("customerText" in row) || row.customerText !== expected.customerText ||
        !("reply" in row) || row.reply !== expected.reply) wrong++;
  }
  return wrong;
}
