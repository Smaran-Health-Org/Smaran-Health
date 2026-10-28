import { redirect } from "next/navigation";
import type { SessionContext } from "@/types";
import { isAccessUsable } from "./capabilities";
import { ACCESS_REVOKED_PATH } from "./route-access";

export { ACCESS_REVOKED_PATH };

/**
 * Page-level guard. Returns the session so callers can keep using it.
 *
 * Every authenticated page already calls `getSessionContext()`; this is the one
 * extra line that turns a valid session into a usable one.
 */
export function requireUsableAccess(session: SessionContext): SessionContext {
  if (!isAccessUsable(session.accessState)) redirect(ACCESS_REVOKED_PATH);
  return session;
}
