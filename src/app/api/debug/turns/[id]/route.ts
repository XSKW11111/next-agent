import { currentChatRuntime } from "../../../chat/runtime";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (id.trim() === "") {
    return Response.json({ code: "invalid" }, { status: 400 });
  }
  const record = await currentChatRuntime().observability.get(id);
  if (record === undefined) {
    return Response.json({ code: "missing" }, { status: 404 });
  }
  return Response.json(record);
}
