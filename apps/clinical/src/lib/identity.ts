/** Raw patient identity values remain the source values. These helpers only
 * produce clinic-side duplicate matching signals. */
export const PATIENT_NAME_SIMILARITY_THRESHOLD = 0.82;

export function normalizePatientPhone(value: string | null | undefined): string | null {
  const normalized = (value ?? "").replace(/\D/g, "");
  return normalized || null;
}

export function normalizePatientName(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || null;
}

export function patientPhoneMatchKeys(
  value: string | null | undefined
): string[] {
  const normalized = normalizePatientPhone(value);
  if (!normalized) return [];

  const keys = new Set([normalized]);
  if (/^[6-9]\d{9}$/.test(normalized)) {
    keys.add(`91${normalized}`);
  } else if (/^0[6-9]\d{9}$/.test(normalized)) {
    const nationalNumber = normalized.slice(1);
    keys.add(nationalNumber);
    keys.add(`91${nationalNumber}`);
  } else if (/^91[6-9]\d{9}$/.test(normalized)) {
    keys.add(normalized.slice(2));
  }

  return [...keys];
}

function levenshteinDistance(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length] ?? 0;
}

function sortedNameTokens(value: string): string {
  return value.split(" ").filter(Boolean).sort().join(" ");
}

export function patientNameSimilarity(
  left: string | null | undefined,
  right: string | null | undefined
): number {
  const a = normalizePatientName(left);
  const b = normalizePatientName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (sortedNameTokens(a) === sortedNameTokens(b)) return 0.99;

  const longest = Math.max(Array.from(a).length, Array.from(b).length);
  if (longest === 0) return 0;
  return 1 - levenshteinDistance(a, b) / longest;
}

export function isSimilarPatientName(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  return patientNameSimilarity(left, right) >= PATIENT_NAME_SIMILARITY_THRESHOLD;
}
