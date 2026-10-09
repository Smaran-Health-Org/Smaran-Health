/**
 * Infers which diarized speaker is the doctor and which is the patient.
 *
 * Why this is a heuristic and not a model call: the output is an attribution of
 * *who said what* in a clinical record. A generative model would produce a
 * fluent answer with no audit trail when it was wrong, and this runs on every
 * transcript at no extra cost. Deterministic cues are explainable, testable, and
 * cheap; the doctor can always override the result.
 *
 * Product boundary (AGENTS.md): this is an inference, never a fact. It is stored
 * as `source: "inferred"` and the doctor's correction is stored as
 * `source: "doctor_confirmed"`. Nothing here decides clinical meaning — it only
 * anchors which side of the conversation a sentence came from, so a human can
 * read the transcript faster.
 *
 * Diarization also returns *speakers*, not *roles*. A third voice is usually an
 * accompanying family member, not a second patient, so extra speakers are left
 * `unknown` rather than forced into one of the two roles.
 *
 * Pure and free of `server-only` imports so the cue tables can be unit tested.
 */

export type DiarizedTurn = {
  speakerId: string;
  transcript: string;
  startTimeSeconds: number | null;
  endTimeSeconds: number | null;
};

export type SpeakerRole = "doctor" | "patient" | "unknown";

export type SpeakerRoleMap = {
  /** Provider speaker id -> role. Ids stay opaque; they are not renumbered. */
  roles: Record<string, SpeakerRole>;
  confidence: "high" | "low";
  /** Short, human-readable justification shown next to the inference. */
  reason: string;
  source: "inferred" | "doctor_confirmed";
};

/**
 * Cues are split by language because consultations here are routinely
 * code-mixed. Marathi and Hindi consultations frequently carry English clinical
 * nouns, so matching only one language would silently lose evidence.
 */
const DOCTOR_CUES: Array<{ weight: number; label: string; pattern: RegExp }> = [
  {
    weight: 3,
    label: "asked questions",
    pattern:
      /\?|\b(what|why|when|where|which|how long|how many|how often|since when|do you|are you|have you|did you|is it|does it|any)\b|\b(kya|kaise|kaisa|kab|kahan|kitne|kitna|kitni|kyun|kyu|kab se)\b/i,
  },
  {
    weight: 2,
    label: "addressed the other person",
    pattern:
      /\b(you|your|yours|yourself|you're)\b|\b(aap|aapka|aapki|aapko|aapne|tum|tumhara|tumhe)\b/i,
  },
  {
    weight: 3,
    label: "gave instructions",
    pattern:
      /\b(take|start|stop|continue|avoid|reduce|increase|add|twice daily|once daily|thrice daily|after food|before food|empty stomach|prescribe|i'll give|i will give|i am giving|follow up|come back|review in|next visit|get it done|get these tests)\b|\b(le lo|lena|kha lena|khana|roz|subah|raat|din mein|aana|dikhana|karwa lena)\b/i,
  },
  {
    weight: 3,
    label: "performed an examination",
    pattern:
      /\b(let me (check|examine|see)|show me|lie down|open your mouth|breathe|press|blood pressure|weigh|check your|examine)\b|\b(dikhaiye|letao|kholiye|bataiye)\b/i,
  },
];

const PATIENT_CUES: Array<{ weight: number; label: string; pattern: RegExp }> = [
  {
    weight: 3,
    label: "reported symptoms in the first person",
    pattern:
      /\b(i have|i am having|i'm having|i feel|i am feeling|i'm feeling|i had|i get|it hurts|my |me )\b|\b(mujhe|mera|meri|mere|main|humko)\b/i,
  },
  {
    weight: 2,
    label: "named symptoms",
    pattern:
      /\b(pain|fever|cough|cold|vomit|vomiting|nausea|dizzy|dizziness|weakness|tired|tiredness|itching|rash|swelling|breathless|headache|burning|discharge|bleeding|constipation|loose motion|appetite|sleep)\b|\b(dard|bukhar|khansi|zukam|chakkar|kamzori|jalan|sujan|ulti|pet dard|sar dard)\b/i,
  },
  {
    weight: 2,
    label: "reported how long it had lasted",
    pattern:
      /\b(since|for \d+|from \d+|\d+ days|\d+ weeks|\d+ months|\d+ years|last week|last month|yesterday)\b|\b(din se|hafte se|mahine se|saal se|kal se)\b/i,
  },
  {
    weight: 1,
    label: "answered briefly",
    pattern: /^(yes|no|haan|ha|nahi|nai|nope|ok|okay|theek|hmm|ji|ji haan|ji nahi|sometimes|kabhi kabhi)[.!,\s]*$/i,
  },
];

type SpeakerScore = {
  speakerId: string;
  doctor: number;
  patient: number;
  doctorHits: string[];
  patientHits: string[];
  turns: number;
};

function scoreSpeaker(speakerId: string, turns: DiarizedTurn[]): SpeakerScore {
  const score: SpeakerScore = {
    speakerId,
    doctor: 0,
    patient: 0,
    doctorHits: [],
    patientHits: [],
    turns: turns.length,
  };

  for (const turn of turns) {
    const text = turn.transcript ?? "";
    if (!text) continue;
    for (const cue of DOCTOR_CUES) {
      if (cue.pattern.test(text)) {
        score.doctor += cue.weight;
        if (!score.doctorHits.includes(cue.label)) score.doctorHits.push(cue.label);
      }
    }
    for (const cue of PATIENT_CUES) {
      if (cue.pattern.test(text)) {
        score.patient += cue.weight;
        if (!score.patientHits.includes(cue.label)) score.patientHits.push(cue.label);
      }
    }
  }

  return score;
}

/**
 * Below this separation the two speakers look alike, so we surface the guess as
 * low confidence rather than presenting a coin flip as an answer.
 */
const CONFIDENT_SEPARATION = 6;

/** A single speaker with no positive signal at all tells us nothing. */
const MIN_SIGNAL = 3;

export function inferSpeakerRoles(turns: DiarizedTurn[]): SpeakerRoleMap {
  const bySpeaker = new Map<string, DiarizedTurn[]>();
  for (const turn of turns) {
    const id = turn.speakerId;
    if (!id) continue;
    const existing = bySpeaker.get(id);
    if (existing) existing.push(turn);
    else bySpeaker.set(id, [turn]);
  }

  const ids = [...bySpeaker.keys()];
  if (ids.length === 0) {
    return { roles: {}, confidence: "low", reason: "No speaker segments were returned.", source: "inferred" };
  }

  const scored = ids.map((id) => scoreSpeaker(id, bySpeaker.get(id) ?? []));

  const roles: Record<string, SpeakerRole> = {};
  for (const id of ids) roles[id] = "unknown";
  const label = (id: string) => `Speaker ${ids.indexOf(id) + 1}`;

  if (ids.length === 1) {
    const only = scored[0];
    const net = only.doctor - only.patient;
    if (Math.abs(net) < MIN_SIGNAL) {
      return {
        roles,
        confidence: "low",
        reason: "Only one speaker was separated, with no clear doctor or patient cue.",
        source: "inferred",
      };
    }
    roles[only.speakerId] = net > 0 ? "doctor" : "patient";
    return {
      roles,
      confidence: "low",
      reason: `Only one speaker was separated, and they ${(net > 0 ? only.doctorHits : only.patientHits).join(" and ") || "gave no clear cue"}.`,
      source: "inferred",
    };
  }

  // Chosen by best evidence for each role rather than by ranking the speakers.
  // A third voice — usually an accompanying family member — then simply fails to
  // qualify and stays unknown, instead of displacing a real participant or
  // blocking the inference outright.
  const doctorPick = [...scored]
    .filter((speaker) => speaker.doctor >= MIN_SIGNAL)
    .sort((a, b) => b.doctor - a.doctor)[0];
  const patientPick = [...scored]
    .filter(
      (speaker) => speaker.speakerId !== doctorPick?.speakerId && speaker.patient >= MIN_SIGNAL
    )
    .sort((a, b) => b.patient - a.patient)[0];

  if (!doctorPick || !patientPick) {
    // Not enough evidence to name either side. Left unknown on purpose: a wrong
    // attribution here would put the doctor's words in the patient's mouth.
    return {
      roles,
      confidence: "low",
      reason:
        "The conversation did not contain enough doctor or patient language to tell the two apart.",
      source: "inferred",
    };
  }

  roles[doctorPick.speakerId] = "doctor";
  roles[patientPick.speakerId] = "patient";

  // How cleanly the two chosen speakers oppose each other, rather than how
  // strongly either matched: a transcript where both sound like the clinician is
  // not a confident answer just because one scored higher.
  const separation =
    doctorPick.doctor - doctorPick.patient + (patientPick.patient - patientPick.doctor);

  const reason = [
    `${label(doctorPick.speakerId)} ${doctorPick.doctorHits.slice(0, 2).join(" and ")}`,
    `${label(patientPick.speakerId)} ${patientPick.patientHits.slice(0, 2).join(" and ")}`,
  ].join("; ");

  return {
    roles,
    confidence: separation >= CONFIDENT_SEPARATION ? "high" : "low",
    reason: `${reason}.`,
    source: "inferred",
  };
}

/**
 * The doctor's correction. Swapping is the overwhelmingly common fix — a
 * mis-assignment is nearly always "these two are the wrong way round" — so it is
 * recorded as a confirmation rather than re-running the heuristic over someone
 * who already knows the answer.
 */
export function swapSpeakerRoles(map: SpeakerRoleMap): SpeakerRoleMap {
  const roles: Record<string, SpeakerRole> = {};
  for (const [id, role] of Object.entries(map.roles)) {
    roles[id] = role === "doctor" ? "patient" : role === "patient" ? "doctor" : "unknown";
  }
  return {
    roles,
    confidence: map.confidence,
    reason: "Corrected by the doctor.",
    source: "doctor_confirmed",
  };
}

/** Display label for a speaker, falling back to position when the role is unknown. */
export function speakerLabel(
  speakerId: string,
  map: SpeakerRoleMap | null,
  orderedSpeakerIds: string[]
): string {
  const role = map?.roles?.[speakerId];
  if (role === "doctor") return "Doctor";
  if (role === "patient") return "Patient";
  const index = orderedSpeakerIds.indexOf(speakerId);
  return index >= 0 ? `Speaker ${index + 1}` : "Speaker";
}

/** Groups consecutive turns from the same speaker so the transcript reads as a dialogue. */
export function groupConsecutiveTurns(
  turns: DiarizedTurn[]
): Array<{ speakerId: string; transcript: string; startTimeSeconds: number | null }> {
  const grouped: Array<{ speakerId: string; transcript: string; startTimeSeconds: number | null }> = [];
  for (const turn of turns) {
    const text = (turn.transcript ?? "").trim();
    if (!text) continue;
    const last = grouped[grouped.length - 1];
    if (last && last.speakerId === turn.speakerId) {
      last.transcript = `${last.transcript} ${text}`.trim();
      continue;
    }
    grouped.push({
      speakerId: turn.speakerId,
      transcript: text,
      startTimeSeconds: turn.startTimeSeconds ?? null,
    });
  }
  return grouped;
}

/** Speaker ids in first-appearance order — stable labels across renders. */
export function orderedSpeakerIds(turns: DiarizedTurn[]): string[] {
  const ids: string[] = [];
  for (const turn of turns) {
    if (turn.speakerId && !ids.includes(turn.speakerId)) ids.push(turn.speakerId);
  }
  return ids;
}

/**
 * Reads the persisted shape defensively. Stored JSONB predates any schema
 * change, so a hand-edited or partially written value must not throw inside a
 * render path.
 */
export function parseDiarizedTurns(value: unknown): DiarizedTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: DiarizedTurn[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const speakerId = typeof record.speakerId === "string" ? record.speakerId : null;
    const transcript = typeof record.transcript === "string" ? record.transcript : "";
    if (!speakerId || !transcript.trim()) continue;
    turns.push({
      speakerId,
      transcript,
      startTimeSeconds:
        typeof record.startTimeSeconds === "number" ? record.startTimeSeconds : null,
      endTimeSeconds:
        typeof record.endTimeSeconds === "number" ? record.endTimeSeconds : null,
    });
  }
  return turns;
}

export function parseSpeakerRoleMap(value: unknown): SpeakerRoleMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawRoles = record.roles;
  if (!rawRoles || typeof rawRoles !== "object" || Array.isArray(rawRoles)) return null;
  const roles: Record<string, SpeakerRole> = {};
  for (const [id, role] of Object.entries(rawRoles as Record<string, unknown>)) {
    if (role === "doctor" || role === "patient" || role === "unknown") roles[id] = role;
  }
  if (Object.keys(roles).length === 0) return null;
  return {
    roles,
    confidence: record.confidence === "high" ? "high" : "low",
    reason: typeof record.reason === "string" ? record.reason : "",
    source: record.source === "doctor_confirmed" ? "doctor_confirmed" : "inferred",
  };
}
