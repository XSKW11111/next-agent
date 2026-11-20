export function sendAllowed(decision: { readonly text: string; readonly status: string }): boolean {
  if (decision.text.trim() === "") return false;
  if (decision.status === "submitted" || decision.status === "streaming") return false;
  return true;
}
