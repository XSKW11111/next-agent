import { postHandoff } from "../../../../../handoff-route";
import type { ChatRuntime } from "../../../../../runtime";

type HandoffContext = {
  params: Promise<{ id: string; proposalId: string }>;
};

export function POST(
  _request: Request,
  context: HandoffContext,
  runtime: ChatRuntime,
): Promise<Response> {
  return postHandoff(context, runtime, "confirm");
}
