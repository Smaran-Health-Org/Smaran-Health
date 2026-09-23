import { createHmac, timingSafeEqual } from "node:crypto";

type WarningProofPayload = {
  v: 1;
  portalAccessSessionId: string;
  canonicalPatientId: string;
  doctorId: string;
  scheduledAt: string;
  futureCount: number;
  expiresAt: number;
};

function encode(payload: WarningProofPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signature(encoded: string, secret: string) {
  return createHmac("sha256", secret).update(encoded, "utf8").digest("base64url");
}

export function createPatientPortalWarningProof(payload: Omit<WarningProofPayload, "v" | "expiresAt">, secret: string, now = Date.now()) {
  const encoded = encode({ ...payload, v: 1, expiresAt: now + 5 * 60 * 1000 });
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyPatientPortalWarningProof(proof: string, expected: Omit<WarningProofPayload, "v" | "futureCount" | "expiresAt">, secret: string, now = Date.now()): number | null {
  const [encoded, suppliedSignature, ...extra] = proof.split(".");
  if (!encoded || !suppliedSignature || extra.length) return null;
  const expectedSignature = signature(encoded, secret);
  const supplied = Buffer.from(suppliedSignature);
  const calculated = Buffer.from(expectedSignature);
  if (supplied.length !== calculated.length || !timingSafeEqual(supplied, calculated)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as WarningProofPayload;
    if (payload.v !== 1 || !Number.isInteger(payload.futureCount) || payload.futureCount < 1 || payload.futureCount > 2
      || !Number.isInteger(payload.expiresAt) || payload.expiresAt <= now
      || payload.portalAccessSessionId !== expected.portalAccessSessionId
      || payload.canonicalPatientId !== expected.canonicalPatientId
      || payload.doctorId !== expected.doctorId
      || payload.scheduledAt !== expected.scheduledAt) return null;
    return payload.futureCount;
  } catch {
    return null;
  }
}
