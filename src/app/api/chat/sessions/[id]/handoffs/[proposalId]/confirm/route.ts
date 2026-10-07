import { postHandoff } from "../../../../../handoff-route";
import { currentChatRuntime, type ChatRuntime } from "../../../../../runtime";

type HandoffContext = {
  params: Promise<{ id: string; proposalId: string }>;
};

export function POST(
  _request: Request,
  context: HandoffContext,
  runtime: ChatRuntime = currentChatRuntime(),
): Promise<Response> {
  return postHandoff(context, runtime, "confirm");
}
