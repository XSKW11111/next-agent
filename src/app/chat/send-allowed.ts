export type SendGate = {
  readonly failed: boolean;
  readonly restoreHistory: boolean;
  readonly historyReady: boolean;
  readonly status: string;
};

export function sendAllowed(gate: SendGate): boolean {
  if (gate.failed) return false;
  if (gate.status === "submitted" || gate.status === "streaming") return false;
  if (gate.restoreHistory && !gate.historyReady) return false;
  return true;
}
