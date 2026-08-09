export type WorkflowState =
  | "patient"
  | "consent"
  | "consent_declined"
  | "manual_review"
  | "recording"
  | "recording_interrupted"
  | "processing"
  | "review"
  | "approved"
  | "rejected"
  | "failed";

export type Confidence = "high" | "medium" | "low";

export type DraftField = {
  id: "summary" | "medicationChanges" | "investigations" | "uncertainItems";
  label: string;
  value: string;
  evidence: string[];
  confidence: Confidence;
  requiresVerification: boolean;
};

export type ApprovedTimelineEvent = {
  id: string;
  date: string;
  title: string;
  detail: string;
  source: string;
  status: "approved";
};

export const workflowStates: Array<{
  id: WorkflowState;
  label: string;
  safetyRule: string;
}> = [
  {
    id: "patient",
    label: "Patient profile",
    safetyRule: "Only this synthetic clinic record is in scope.",
  },
  {
    id: "consent",
    label: "Consent",
    safetyRule: "Recording cannot start without explicit consent.",
  },
  {
    id: "recording",
    label: "Recording",
    safetyRule: "The recording state stays visible and can be stopped.",
  },
  {
    id: "processing",
    label: "Processing",
    safetyRule: "A retryable failure never creates a clinical note.",
  },
  {
    id: "review",
    label: "Draft review",
    safetyRule: "AI output remains editable and unapproved.",
  },
  {
    id: "approved",
    label: "Approved",
    safetyRule: "Only doctor approval can update memory.",
  },
  {
    id: "rejected",
    label: "Rejected",
    safetyRule: "Rejected content is excluded from the timeline.",
  },
  {
    id: "failed",
    label: "Failed",
    safetyRule: "Failure is explicit, safe, and retryable.",
  },
];

export const syntheticPatient = {
  id: "DEMO-PN-1042",
  clinicId: "DEMO-CLINIC-PUNE-01",
  name: "Ananya S.",
  age: 43,
  pronouns: "she/her",
  location: "Pune",
  specialty: "Diabetes / Endocrinology",
  followUpReason:
    "Four-week review of doctor-documented type 2 diabetes follow-up, home sugar log, and medication adherence.",
  consent: {
    status: "granted" as const,
    noticeVersion: "prototype-v0.1",
    language: "English + Marathi",
    method: "Verbal confirmation recorded by doctor",
    scopes: ["Consultation recording", "Clinical note processing"],
    excludedScopes: ["Patient sharing", "Model improvement", "Secondary use"],
  },
};

export const approvedTimeline: ApprovedTimelineEvent[] = [
  {
    id: "approved-2026-07-18",
    date: "18 July 2026",
    title: "Follow-up visit",
    detail:
      "Night cravings were documented as improved. Metformin was continued with no recorded dose change. A fasting sugar log and HbA1c were requested for review.",
    source: "Approved note · Dr Meera Shah",
    status: "approved",
  },
  {
    id: "approved-2026-06-20",
    date: "20 June 2026",
    title: "Medication timing reviewed",
    detail:
      "The doctor documented a change to evening-dose timing because the patient reported difficulty following the earlier schedule.",
    source: "Approved note · Dr Meera Shah",
    status: "approved",
  },
  {
    id: "approved-2026-05-22",
    date: "22 May 2026",
    title: "Initial synthetic visit",
    detail:
      "The doctor documented the presenting history, requested home glucose records, and advised a 30-minute daily walk and a smaller rice portion at dinner.",
    source: "Approved note · Dr Meera Shah",
    status: "approved",
  },
];

export const preVisitMemory = {
  medicationChanges: [
    "20 June: evening-dose timing changed; doctor-stated reason was difficulty following the earlier schedule.",
    "18 July: metformin documented as continued; no dose change was recorded.",
  ],
  investigations: [
    "Fasting sugar log requested on 18 July; no reviewed result appears in approved records.",
    "HbA1c requested on 18 July; result remains pending in approved records.",
  ],
  priorAdvice: [
    "30-minute daily walking routine documented on 22 May.",
    "Smaller rice portion at dinner documented on 22 May.",
  ],
  unresolvedItems: [
    "Review the requested fasting sugar log if the patient provides it.",
    "Medication adherence was marked for review at the next visit.",
  ],
};

export const syntheticTranscript = [
  "Doctor: Aap fasting sugar log laaye hain?",
  "Patient: Haan doctor, mostly 128 to 142. Do din miss hua.",
  "Doctor: Theek hai. Koi dizziness ya low sugar symptoms?",
  "Patient: Nahi. Night cravings bhi pehle se kam hain.",
  "Doctor: I am documenting the readings and adherence. We will review the HbA1c report when available.",
];

export const aiDraft = {
  summary:
    "Patient reported home fasting readings mostly between 128 and 142, with two missed log days. No dizziness or low-sugar symptoms were reported. Night cravings were reported as improved. The doctor documented that HbA1c will be reviewed when available.",
  medicationChanges: "No medication change was explicitly stated in this consultation.",
  investigations: "HbA1c report remains to be reviewed when available.",
  uncertainItems: "The transcript does not state the dates of the two missed log entries.",
};

export const aiDraftFields: DraftField[] = [
  {
    id: "summary",
    label: "Consultation summary",
    value: aiDraft.summary,
    evidence: [syntheticTranscript[1], syntheticTranscript[2], syntheticTranscript[3], syntheticTranscript[4]],
    confidence: "high",
    requiresVerification: false,
  },
  {
    id: "medicationChanges",
    label: "Medication changes",
    value: aiDraft.medicationChanges,
    evidence: ["No medication name, dose, frequency, or change is stated in the transcript."],
    confidence: "high",
    requiresVerification: true,
  },
  {
    id: "investigations",
    label: "Investigations",
    value: aiDraft.investigations,
    evidence: [syntheticTranscript[4]],
    confidence: "high",
    requiresVerification: true,
  },
  {
    id: "uncertainItems",
    label: "Uncertain items",
    value: aiDraft.uncertainItems,
    evidence: [syntheticTranscript[1]],
    confidence: "medium",
    requiresVerification: true,
  },
];
