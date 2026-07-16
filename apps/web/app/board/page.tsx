import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Board } from "@/components/board/Board";

// Session check runs server-side in the Node runtime (not Edge middleware)
// so it uses the exact same getServerSession() path already proven to work
// correctly for the API routes, rather than depending on next-auth's JWT
// decoding inside an Edge Function.
export default async function BoardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return <Board />;
}
