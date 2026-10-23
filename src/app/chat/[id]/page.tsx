import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionIdSchema } from "@/domain/session";
import { currentChatRuntime } from "@/app/api/chat/runtime";
import { ownerHash } from "@/app/api/chat/session-ownership";
import { ChatPanel } from "@/app/chat-panel";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = sessionIdSchema.safeParse(id);
  const cookieHeader = (await cookies()).toString();
  const owner = ownerHash(new Request("http://localhost", { headers: { cookie: cookieHeader } }), id);
  if (!parsed.success || owner === undefined ||
      (await currentChatRuntime().sessions.findOwned(parsed.data, owner)) === undefined) {
    redirect("/");
  }
  return <ChatPanel sessionId={parsed.data} />;
}
