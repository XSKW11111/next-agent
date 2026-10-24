import { postHandoff } from "../../../../../handoff-route";
import { currentChatRuntime, type ChatRuntime } from "../../../../../runtime";

type HandoffContext = {
  params: Promise<{ id: string; proposalId: string }>;
};

export function POST(
  request: Request,
  context: HandoffContext,
  runtime: ChatRuntime = currentChatRuntime(),
): Promise<Response> {
  return postHandoff(request, context, runtime, "confirm");
}
