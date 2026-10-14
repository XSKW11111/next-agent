import { currentChatRuntime } from "../../chat/runtime";

export async function GET(): Promise<Response> {
  const runtime = currentChatRuntime();
  const turns = await runtime.observability.list();
  return Response.json({ turns });
}
