import type { SessionContext } from "@/types";

export type Workspace = "clinical" | "desk";

export function defaultWorkspacePath(role: SessionContext["role"]): "/dashboard" | "/desk" {
  return role === "doctor" ? "/dashboard" : "/desk";
}

export function isSafeInternalPath(value: string | null | undefined): value is string {
  return Boolean(
    value &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !value.includes("\0")
  );
}

export function isClinicalWorkspacePath(pathname: string): boolean {
  return ["/dashboard", "/patients", "/consultations", "/new-consultation"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function authorizedLandingPath(
  role: SessionContext["role"],
  requestedPath?: string | null
): string {
  if (!isSafeInternalPath(requestedPath)) return defaultWorkspacePath(role);
  if (role !== "doctor" && isClinicalWorkspacePath(requestedPath)) return "/desk";
  return requestedPath;
}

export function canAccessWorkspace(
  role: SessionContext["role"],
  workspace: Workspace
): boolean {
  return workspace === "desk" || role === "doctor";
}
