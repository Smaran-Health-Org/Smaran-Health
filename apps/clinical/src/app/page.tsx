import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/db/session";
import { defaultWorkspacePath } from "@/lib/auth/workspace";

export default async function HomePage() {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  redirect(defaultWorkspacePath(session.role));
}
