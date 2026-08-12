import { NextResponse } from "next/server";
import type { ApiError } from "@/types";

export function apiError(message: string, code: string, status: number, details?: unknown) {
  const body: ApiError = { error: message, code };
  if (details !== undefined) body.details = details;
  return NextResponse.json(body, { status });
}

export function badRequest(message: string, details?: unknown) {
  return apiError(message, "bad_request", 400, details);
}

export function unauthorized(message = "Authentication required") {
  return apiError(message, "unauthorized", 401);
}

export function forbidden(message = "Access denied") {
  return apiError(message, "forbidden", 403);
}

export function notFound(message = "Resource not found") {
  return apiError(message, "not_found", 404);
}

export function internalError(message = "Internal server error") {
  return apiError(message, "internal_error", 500);
}
