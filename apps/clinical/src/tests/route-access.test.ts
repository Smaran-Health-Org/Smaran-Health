import assert from "node:assert/strict";
import test from "node:test";
import { isApiRoute, isPatientPortalRoute, isPublicRoute } from "../lib/auth/route-access";

test("patient portal routes bypass the staff auth gate so patients can use the link", () => {
  assert.equal(isPatientPortalRoute("/patient"), true);
  assert.equal(isPatientPortalRoute("/patient/access/token"), true);
  assert.equal(isPatientPortalRoute("/patient/api/doctors"), true);
  assert.equal(isPublicRoute("/patient"), true);
  assert.equal(isPublicRoute("/patient/access/token"), true);
  assert.equal(isPublicRoute("/patient/api/portal"), true);
});

test("the staff patients directory is never public", () => {
  // A bare "/patient" prefix would match "/patients" and expose staff pages.
  assert.equal(isPatientPortalRoute("/patients"), false);
  assert.equal(isPatientPortalRoute("/patients/abc"), false);
  assert.equal(isPublicRoute("/patients"), false);
  assert.equal(isPublicRoute("/desk/patients"), false);
});

test("staff routes stay protected", () => {
  for (const path of ["/dashboard", "/desk", "/scheduler", "/scheduler/settings", "/doctors", "/consultations/1", "/new-consultation"]) {
    assert.equal(isPublicRoute(path), false, `${path} must not be public`);
  }
});

test("only the intended prefixed routes are public", () => {
  assert.equal(isPublicRoute("/login"), true);
  assert.equal(isPublicRoute("/auth/callback"), true);
  assert.equal(isPublicRoute("/intake/abc"), true);
  assert.equal(isPublicRoute("/api/intake/abc"), true);
  assert.equal(isPublicRoute("/api/internal/document-pipeline"), true);
  // The secret-carrying intake API must not make the staff intake UI public.
  assert.equal(isPublicRoute("/api/patients"), false);
});

test("api namespace is detected for JSON auth responses", () => {
  assert.equal(isApiRoute("/api/patients"), true);
  assert.equal(isApiRoute("/api/scheduler/calendar"), true);
  assert.equal(isApiRoute("/api"), true);
  assert.equal(isApiRoute("/patient/api/doctors"), false);
  assert.equal(isApiRoute("/dashboard"), false);
});
