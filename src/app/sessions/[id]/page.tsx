import { notFound } from "next/navigation";
import { parse } from "../../../domain/parse";
import { sessionIdSchema } from "../../../domain/session";
import { ChatPanel } from "../../chat-panel";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const parsed = parse(sessionIdSchema, id);
  if (!parsed.ok) notFound();
  return <ChatPanel key={parsed.value} sessionId={parsed.value} />;
}
