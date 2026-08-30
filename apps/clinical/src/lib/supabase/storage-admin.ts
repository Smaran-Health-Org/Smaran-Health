import "server-only";
import { createServiceRoleClient } from "./service-role";

/**
 * Narrow server-only client for private Storage operations after a database
 * authorization check. It must never be returned to a browser or used to read
 * clinic data directly.
 */
export function createStorageAdminClient() {
  return createServiceRoleClient();
}
