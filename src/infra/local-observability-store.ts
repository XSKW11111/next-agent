import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  TurnObservabilityRecord,
  TurnObservabilitySummary,
} from "../domain/turn-observability";

const defaultRoot = path.join(process.cwd(), ".data", "observability");

export type LocalObservabilityStore = {
  readonly save: (record: TurnObservabilityRecord) => Promise<void>;
  readonly list: () => Promise<readonly TurnObservabilitySummary[]>;
  readonly get: (id: string) => Promise<TurnObservabilityRecord | undefined>;
};

export function localObservabilityStore(root: string = defaultRoot): LocalObservabilityStore {
  return {
    async save(record) {
      await mkdir(root, { recursive: true });
      const file = path.join(root, `${safeId(record.id)}.json`);
      await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    },
    async list() {
      await mkdir(root, { recursive: true });
      const names = await readdir(root);
      const rows: TurnObservabilitySummary[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const raw = await readFile(path.join(root, name), "utf8");
        const record = JSON.parse(raw) as TurnObservabilityRecord;
        rows.push({
          id: record.id,
          sessionId: record.sessionId,
          turnId: record.turnId,
          savedAt: record.savedAt,
          currentSentence: record.currentSentence,
          reply: record.reply,
          serverLatencyMs: record.serverLatencyMs,
          hasTrace: record.trace !== null,
          sink: record.sink,
        });
      }
      return rows.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
    },
    async get(id) {
      try {
        const raw = await readFile(path.join(root, `${safeId(id)}.json`), "utf8");
        return JSON.parse(raw) as TurnObservabilityRecord;
      } catch {
        return undefined;
      }
    },
  };
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}
